/**
 * Repara los BRES importados cuyos totales venian rotos en el Excel del
 * balance (#REF! en el bloque de totales, de septiembre 2025 a abril 2026).
 *
 * Reglas, comprobadas contra los meses que si estaban completos:
 *   C (entradas)            = entradas del inventario de cierre de la bodega
 *   I (existencia bodega)   = saldo actual del inventario de cierre
 *   H (saldo del municipio) = I + saldo siguiente de todos los servicios
 *                             (post-consulta incluido)
 *   B (saldo anterior)      = H del mes anterior
 *   G (reajustes)           = H - (B + C - D), lo que queda para cuadrar
 *   K = H / J, L = J x maximo, M = L - I (como el Excel, negativo si sobra), minimo J x 2
 * D, E, F y J se dejan como venian: esos si estaban completos.
 *
 *   node scripts/repararBresHistorico.js            (solo compara)
 *   node scripts/repararBresHistorico.js --aplicar  (escribe)
 */

require('dotenv').config();
const prisma = require('../src/config/db');

const APLICAR = process.argv.includes('--aplicar');
const COMPROBAR = ['2025-06', '2025-07', '2025-08', '2026-05', '2026-06', '2026-09'];

function previo(p) {
  const [a, m] = p.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

async function datosDelMes(eid, periodo) {
  const [hist, informes] = await Promise.all([
    prisma.inventarioCierreHistorico.findMany({ where: { establecimientoId: eid, periodo } }),
    prisma.informeServicioRenglon.findMany({ where: { informe: { periodo, ubicacion: { establecimientoId: eid } } }, select: { insumoId: true, saldoSiguiente: true } }),
  ]);
  const cierre = new Map(hist.map((h) => [h.insumoId, h]));
  const servicios = new Map();
  for (const r of informes) servicios.set(r.insumoId, (servicios.get(r.insumoId) ?? 0) + r.saldoSiguiente);
  return { cierre, servicios };
}

async function main() {
  const est = await prisma.establecimiento.findFirst();
  const eid = est.id;
  const config = await prisma.configuracionLogistica.findUnique({ where: { establecimientoId: eid } });
  const maximo = Number(config.nivelMaximoMeses);
  const minimo = Number(config.nivelMinimoMeses);

  // 1. Comprobar las reglas en meses completos.
  console.log('Comprobación en meses completos (renglones que coinciden):');
  for (const periodo of COMPROBAR) {
    const bres = await prisma.bres.findUnique({ where: { establecimientoId_periodo: { establecimientoId: eid, periodo } }, include: { renglones: true } });
    if (!bres) continue;
    const { cierre, servicios } = await datosDelMes(eid, periodo);
    let i = 0; let c = 0; let h = 0; let n = 0;
    for (const r of bres.renglones) {
      const ci = cierre.get(r.insumoId);
      if (!ci) continue;
      n += 1;
      if (ci.saldoActual === r.existenciaBodega) i += 1;
      if (ci.entradas === r.entradas) c += 1;
      if (ci.saldoActual + (servicios.get(r.insumoId) ?? 0) === r.saldoFinal) h += 1;
    }
    console.log(`  ${periodo}: I ${i}/${n}  C ${c}/${n}  H ${h}/${n}`);
  }

  // 2. Meses rotos: H en cero en todos los renglones.
  const todos = await prisma.bres.findMany({ where: { establecimientoId: eid }, include: { renglones: true }, orderBy: { periodo: 'asc' } });
  const rotos = todos.filter((b) => b.renglones.length && b.renglones.every((r) => r.saldoFinal === 0 || r.saldoInicial === 0) && b.renglones.some((r) => r.entregado > 0));
  console.log('Meses a reparar:', rotos.map((b) => b.periodo).join(', ') || 'ninguno');

  const cambios = [];
  let Hprevio = new Map(todos.find((b) => b.periodo === previo(rotos[0]?.periodo ?? ''))?.renglones.map((r) => [r.insumoId, r.saldoFinal]) ?? []);
  for (const b of rotos) {
    const { cierre, servicios } = await datosDelMes(eid, b.periodo);
    const Hmes = new Map();
    for (const r of b.renglones) {
      const ci = cierre.get(r.insumoId);
      const I = ci ? ci.saldoActual : r.existenciaBodega;
      const C = ci ? ci.entradas : r.entradas;
      const H = I + (servicios.get(r.insumoId) ?? 0);
      const B = Hprevio.get(r.insumoId) ?? r.saldoInicial;
      const D = r.entregado;
      const J = Number(r.pmdr) || 0;
      const L = Math.ceil(J * maximo);
      // Como en el Excel del centro: L - I aunque salga negativo (sobra).
      const M = L - I;
      Hmes.set(r.insumoId, H);
      cambios.push({
        id: r.id,
        periodo: b.periodo,
        data: {
          saldoInicial: B, entradas: C, existenciaBodega: I, saldoFinal: H, reajustes: H - (B + C - D),
          med: J > 0 ? Math.round((H / J) * 100) / 100 : null, cantidadMaxima: L, cantidadSolicitar: M, cantidadMinima: Math.round(J * minimo),
        },
      });
    }
    Hprevio = Hmes;
    const conH = [...Hmes.values()].filter((v) => v > 0).length;
    console.log(`  ${b.periodo}: ${b.renglones.length} renglones, ${conH} con saldo, ${cambios.filter((x) => x.periodo === b.periodo && x.data.cantidadSolicitar > 0).length} con pedido`);
  }

  if (!APLICAR) {
    console.log('Revisión sin cambios.');
    return;
  }
  const admin = await prisma.usuario.findFirst({ where: { establecimientoId: eid, rol: 'admin' } });
  await prisma.$transaction(async (tx) => {
    for (const c of cambios) await tx.bresRenglon.update({ where: { id: c.id }, data: c.data });
    await tx.bitacora.create({
      data: { usuarioId: admin.id, accion: 'actualizar', entidad: 'bres', detalle: `BRES importados reparados con el inventario de cierre y los informes: ${rotos.map((b) => b.periodo).join(', ')}` },
    });
  }, { timeout: 600000 });
  console.log(`Reparados ${cambios.length} renglones.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
