/**
 * Arranque de la existencia propia de la farmacia (post-consulta).
 *
 *   node scripts/separarFarmacia.js              (solo revisa)
 *   node scripts/separarFarmacia.js --aplicar    (escribe)
 *
 * En la carga inicial la existencia de post-consulta se sumo a la de la
 * bodega. Este script la pasa a la farmacia: por cada insumo, el saldo
 * siguiente de post-consulta del ultimo mes importado del balance, tomado de
 * los lotes por PEPE (el que vence primero), con fecha de la carga inicial.
 *
 * Cada paso son dos movimientos (sale de bodega, entra a farmacia), asi que
 * el total del centro no cambia. Si desde entonces ya se entrego algo desde
 * la farmacia, ese lote se cubre primero para que su saldo en farmacia nunca
 * quede negativo. Se corre una sola vez: si ya hay pasos a farmacia, no hace nada.
 */

require('dotenv').config();
const prisma = require('../src/config/db');
const { verificarSaldos } = require('../src/services/abastecimiento.service');

const APLICAR = process.argv[2] === '--aplicar';

async function main() {
  const establecimiento = await prisma.establecimiento.findFirst();
  const eid = establecimiento.id;

  const yaHecho = await prisma.movimientoInsumo.count({ where: { tipo: 'paso_farmacia', lote: { insumo: { establecimientoId: eid } } } });
  if (yaHecho) {
    console.log(`La farmacia ya tiene su existencia (${yaHecho} movimientos entre bodega y farmacia). No se hace nada.`);
    return;
  }

  const centro = await prisma.ubicacion.findFirst({ where: { establecimientoId: eid, tipo: 'centro_salud' } });
  const informe = await prisma.informeServicio.findFirst({
    where: { ubicacionId: centro.id, importado: true },
    orderBy: { periodo: 'desc' },
    include: { renglones: true },
  });
  if (!informe) throw new Error('No hay un mes importado de post-consulta');
  const primerIngreso = await prisma.movimientoInsumo.findFirst({
    where: { tipo: 'ingreso', lote: { insumo: { establecimientoId: eid } } },
    orderBy: { registradoEn: 'asc' },
  });
  // Treinta segundos despues de la carga inicial: el lote ya existe, aun no
  // hay entregas y sigue siendo el cierre del mes (la carga es un minuto antes
  // del corte).
  const fecha = new Date(primerIngreso.registradoEn.getTime() + 30000);
  const admin = await prisma.usuario.findFirst({ where: { establecimientoId: eid, rol: 'admin' } });

  const objetivo = new Map(informe.renglones.filter((r) => r.saldoSiguiente > 0).map((r) => [r.insumoId, r.saldoSiguiente]));
  const lotes = await prisma.lote.findMany({
    where: { insumo: { establecimientoId: eid } },
    include: { movimientos: { select: { cantidad: true, ubicacion: true, registradoEn: true } }, insumo: { select: { nombreGenerico: true } } },
  });
  const porInsumo = new Map();
  for (const l of lotes) {
    if (!porInsumo.has(l.insumoId)) porInsumo.set(l.insumoId, []);
    porInsumo.get(l.insumoId).push(l);
  }

  const pasos = [];
  const avisos = [];
  for (const insumoId of new Set([...objetivo.keys(), ...lotes.filter((l) => l.movimientos.some((m) => m.ubicacion === 'farmacia')).map((l) => l.insumoId)])) {
    const deInsumo = porInsumo.get(insumoId) ?? [];
    let falta = objetivo.get(insumoId) ?? 0;
    const tomado = new Map();
    // Lo que ya salio de la farmacia de un lote tuvo que estar ahi.
    for (const l of deInsumo) {
      const neto = l.movimientos.filter((m) => m.ubicacion === 'farmacia').reduce((s, m) => s + m.cantidad, 0);
      if (neto < 0) {
        tomado.set(l.id, -neto);
        falta -= -neto;
      }
    }
    // El resto por PEPE: primero los disponibles que vencen antes.
    const enOrden = [...deInsumo].sort((a, b) => (a.estado === 'disponible' ? 0 : 1) - (b.estado === 'disponible' ? 0 : 1)
      || new Date(a.fechaVence) - new Date(b.fechaVence));
    for (const l of enOrden) {
      if (falta <= 0) break;
      const enFecha = l.movimientos.filter((m) => m.registradoEn <= fecha).reduce((s, m) => s + m.cantidad, 0);
      const libre = Math.min(enFecha, l.cantidadActual) - (tomado.get(l.id) ?? 0);
      const tomar = Math.min(libre, falta);
      if (tomar > 0) {
        tomado.set(l.id, (tomado.get(l.id) ?? 0) + tomar);
        falta -= tomar;
      }
    }
    if (falta > 0) avisos.push(`${deInsumo[0]?.insumo.nombreGenerico ?? insumoId}: faltaron ${falta} para completar el saldo de post-consulta`);
    for (const [loteId, cantidad] of tomado) {
      const l = deInsumo.find((x) => x.id === loteId);
      const enFecha = l.movimientos.filter((m) => m.registradoEn <= fecha).reduce((s, m) => s + m.cantidad, 0);
      const neto = l.movimientos.filter((m) => m.ubicacion === 'farmacia').reduce((s, m) => s + m.cantidad, 0);
      pasos.push({ lote: l, cantidad, enFecha, farmaciaFinal: cantidad + neto });
    }
  }

  const unidades = pasos.reduce((s, p) => s + p.cantidad, 0);
  console.log(`Mes de post-consulta: ${informe.periodo}. Fecha del paso: ${fecha.toISOString()}`);
  console.log(`Insumos con saldo en post-consulta: ${objetivo.size}; unidades: ${[...objetivo.values()].reduce((s, v) => s + v, 0)}`);
  console.log(`Pasos a farmacia: ${pasos.length} lotes, ${unidades} unidades`);
  for (const a of avisos) console.log(`  ${a}`);
  if (!APLICAR) {
    console.log('Revisión sin cambios. Para escribir: --aplicar');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const p of pasos) {
      await tx.movimientoInsumo.createMany({
        data: [
          { loteId: p.lote.id, tipo: 'paso_farmacia', ubicacion: 'bodega', cantidad: -p.cantidad, saldoResultante: p.enFecha - p.cantidad, usuarioId: admin.id, motivo: `Existencia de post-consulta al cierre de ${informe.periodo}`, registradoEn: fecha },
          { loteId: p.lote.id, tipo: 'paso_farmacia', ubicacion: 'farmacia', cantidad: p.cantidad, saldoResultante: p.cantidad, usuarioId: admin.id, motivo: `Existencia de post-consulta al cierre de ${informe.periodo}`, registradoEn: fecha },
        ],
      });
      await tx.lote.update({ where: { id: p.lote.id }, data: { cantidadFarmacia: p.farmaciaFinal } });
    }
    await tx.bitacora.create({
      data: { usuarioId: admin.id, accion: 'crear', entidad: 'lote', detalle: `Farmacia con existencia propia: ${unidades} unidades de post-consulta (${informe.periodo}) en ${pasos.length} lotes` },
    });
  }, { timeout: 600000 });

  const v = await verificarSaldos(eid);
  console.log(`Aplicado. Lotes revisados: ${v.revisados}; cuadran todos: ${v.cuadranTodos ? 'sí' : `no (${v.descuadrados.length})`}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
