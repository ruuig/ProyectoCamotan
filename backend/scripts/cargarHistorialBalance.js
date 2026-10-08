/**
 * Carga el historial del balance (reportes de cada servicio y totales B a M
 * de cada mes) tal como lo muestra el Excel del centro.
 *
 *   python scripts/leerBalanceExcel.py <BALANCE.xlsx> <INVENTARIOS CIERRE.xlsx> <excel.json>
 *   node scripts/cargarHistorialBalance.js <excel.json>              (solo revisa)
 *   node scripts/cargarHistorialBalance.js <excel.json> --aplicar    (escribe)
 *   node scripts/verificarBalance.js <excel.json>                    (comprueba)
 *
 * Solo reemplaza lo que vino del Excel: los reportes marcados como
 * importados y los BRES importados de esos meses. No toca lotes, movimientos,
 * traslados ni los reportes capturados en el sistema.
 *
 * Cada renglon del Excel se reconoce por su nombre o sus alias (una misma
 * fila cambia de insumo entre meses). Los insumos que solo existen en meses
 * viejos se crean inactivos, para que esos meses se vean completos sin que
 * aparezcan en el trabajo de hoy. Los valores se guardan sin limpiar: los
 * promedios con sus decimales, la cantidad a solicitar negativa cuando sobra
 * y los saldos que no cuadran, porque asi esta en el balance.
 */

if (require.main === module) require('dotenv').config();
const fs = require('node:fs');
const prisma = require('../src/config/db');
const { emparejarServicio, categoriaDe } = require('../src/services/importacionBodega.service');
const { normalizarAlias, CATEGORIAS_NO_PRESCRIBIBLES } = require('../src/services/bodega.service');


// Alias que la primera importacion asigno mal: son otro insumo.
const ALIAS_EQUIVOCADOS = [
  'PLANIFICACION FAMILIAR', // titulo de seccion, no un insumo
  'Gorros quirúrgicos descartables, unidad', // no son mascarillas
  'Guantes de nitrilo talla S, pares', // talla S, no M
];

// Fin del mes en hora de Guatemala (UTC-6), un minuto antes del corte.
function finDelMes(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(Date.UTC(anio, mes, 1) + 6 * 3600000 - 60000);
}

const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const entero = (v) => (esNumero(v) ? Math.round(v) : 0);
const decimal = (v) => (esNumero(v) ? Math.round(v * 1000) / 1000 : null);

const LETRA = { mesAnterior: 'mes anterior', saldoPorDemanda: 'saldo x demanda' };

/** Por que una cifra del renglon no es la que se ve en el Excel. */
function notasDe(r) {
  const notas = [];
  if (r.reconstruidos.length) {
    notas.push(`En el Excel ${r.reconstruidos.map((k) => LETRA[k] ?? k).join(', ')} salen #REF! (vínculo roto al inventario de cierre); se calcularon con el cierre`);
  }
  const errores = Object.entries(r.totales).filter(([, v]) => typeof v === 'string' && !v.startsWith('#DIV'));
  if (errores.length) {
    notas.push(`En el Excel ${errores.map(([k, v]) => `${LETRA[k] ?? k} muestra «${v}»`).join(', ')}: aquí va 0`);
  }
  return notas.length ? notas.join('. ') : null;
}

/**
 * Revisa y, con aplicar, carga los meses leidos del Excel. Devuelve lo que
 * encontro; si hay algo que impide cargar (un servicio sin ubicacion o un
 * insumo dos veces en un mes), no escribe nada.
 */
async function cargarHistorial({ meses, eid, aplicar = false, log = console.log }) {
  const [insumos, alias, ubicaciones, admin, config] = await Promise.all([
    prisma.insumo.findMany({ where: { establecimientoId: eid } }),
    prisma.insumoAlias.findMany({ where: { insumo: { establecimientoId: eid } } }),
    prisma.ubicacion.findMany({ where: { establecimientoId: eid } }),
    prisma.usuario.findFirst({ where: { establecimientoId: eid, rol: 'admin' } }),
    prisma.configuracionLogistica.findUnique({ where: { establecimientoId: eid } }),
  ]);

  const equivocados = new Set(ALIAS_EQUIVOCADOS.map(normalizarAlias));
  const insumoDe = new Map();
  for (const a of alias) if (!equivocados.has(a.aliasNormalizado)) insumoDe.set(a.aliasNormalizado, a.insumoId);
  for (const i of insumos) insumoDe.set(normalizarAlias(i.nombreGenerico), i.id);

  // --- Insumos que no estan en el catalogo -----------------------------------
  const nuevos = new Map(); // nombre normalizado -> { nombre, seccion }
  for (const m of meses) {
    for (const r of m.renglones) {
      const n = normalizarAlias(r.nombre);
      if (!insumoDe.has(n) && !nuevos.has(n)) nuevos.set(n, { nombre: r.nombre, seccion: r.seccion, desde: m.periodo });
    }
  }

  // --- Servicios ---------------------------------------------------------------
  const servicioDe = new Map();
  for (const m of meses) {
    for (const s of m.servicios) {
      if (!servicioDe.has(s)) servicioDe.set(s, emparejarServicio(s, ubicaciones));
    }
  }
  const sinServicio = [...servicioDe].filter(([, u]) => !u).map(([s]) => s);

  // --- Un insumo no puede salir dos veces en el mismo mes ----------------------
  const repetidos = [];
  for (const m of meses) {
    const vistos = new Map();
    for (const r of m.renglones) {
      const n = normalizarAlias(r.nombre);
      const id = insumoDe.get(n) ?? `nuevo:${n}`;
      if (vistos.has(id)) repetidos.push(`${m.periodo}: filas ${vistos.get(id)} y ${r.fila} (${r.nombre})`);
      vistos.set(id, r.fila);
    }
  }

  log(`Meses: ${meses.length} (${meses[0].periodo} a ${meses.at(-1).periodo})`);
  log(`Alias equivocados que se quitan: ${alias.filter((a) => equivocados.has(a.aliasNormalizado)).map((a) => a.alias).join(' | ') || 'ninguno'}`);
  log(`Insumos que solo estan en meses viejos (se crean inactivos): ${nuevos.size}`);
  for (const x of nuevos.values()) log(`   ${x.nombre}  [desde ${x.desde}]`);
  log(`Servicios sin ubicacion: ${sinServicio.join(', ') || 'ninguno'}`);
  log(`Insumos repetidos en un mismo mes: ${repetidos.length}`);
  for (const x of repetidos) log(`   ${x}`);
  const resultado = { nuevos: [...nuevos.values()].map((x) => x.nombre), sinServicio, repetidos, cargado: false };
  if (sinServicio.length || repetidos.length) {
    log('Hay que resolver lo anterior antes de cargar.');
    return resultado;
  }
  if (!aplicar) {
    log('Revisión sin cambios. Para escribir: --aplicar');
    return resultado;
  }

  await prisma.$transaction(async (tx) => {
    // Alias equivocados fuera.
    await tx.insumoAlias.deleteMany({ where: { insumo: { establecimientoId: eid }, aliasNormalizado: { in: [...equivocados] } } });

    // Insumos de meses viejos, inactivos.
    let correlativo = await tx.insumo.count({ where: { establecimientoId: eid, codigoInterno: { startsWith: 'HIS-' } } });
    for (const [n, x] of nuevos) {
      const { categoria } = categoriaDe(x.seccion, x.nombre);
      correlativo += 1;
      const creado = await tx.insumo.create({
        data: {
          establecimientoId: eid,
          codigoInterno: `HIS-${String(correlativo).padStart(4, '0')}`,
          nombreGenerico: x.nombre,
          categoria,
          presentacion: 'unidad',
          unidadMedida: 'unidad',
          unidadEntrega: 'unidad',
          prescribible: !CATEGORIAS_NO_PRESCRIBIBLES.includes(categoria),
          activo: false,
        },
      });
      insumoDe.set(n, creado.id);
    }

    for (const m of meses) {
      // Lo importado de este mes se rehace; lo capturado en el sistema se queda.
      await tx.reporteServicio.deleteMany({ where: { periodo: m.periodo, importado: true, ubicacion: { establecimientoId: eid } } });
      await tx.bres.deleteMany({ where: { establecimientoId: eid, periodo: m.periodo, observaciones: { startsWith: 'Importado' } } });

      // Reportes de cada servicio, con sus seis cifras.
      for (const [nombreServicio, ubicacion] of servicioDe) {
        const renglones = [];
        for (const r of m.renglones) {
          const s = r.servicios.find((x) => x.servicio === nombreServicio);
          if (!s) continue;
          const valores = [s.saldoAnterior, s.entradas, s.entregado, s.noEntregado, s.saldoSiguiente, s.promedio];
          if (valores.every((v) => !esNumero(v) || v === 0)) continue;
          renglones.push({
            insumoId: insumoDe.get(normalizarAlias(r.nombre)),
            saldoAnterior: entero(s.saldoAnterior),
            entradas: entero(s.entradas),
            entregado: entero(s.entregado),
            noEntregado: entero(s.noEntregado),
            saldoSiguiente: entero(s.saldoSiguiente),
            promedioAnotado: decimal(s.promedio),
          });
        }
        if (!renglones.length) continue;
        const existente = await tx.reporteServicio.findUnique({ where: { ubicacionId_periodo: { ubicacionId: ubicacion.id, periodo: m.periodo } } });
        if (existente) continue; // capturado en el sistema: manda lo capturado
        const rep = await tx.reporteServicio.create({
          data: { ubicacionId: ubicacion.id, periodo: m.periodo, capturadoPor: admin.id, revisado: true, importado: true, observacion: `Importado de ${m.hoja}` },
        });
        await tx.reporteServicioRenglon.createMany({ data: renglones.map((x) => ({ ...x, reporteId: rep.id })) });
      }

      // Totales del mes, como BRES cerrado.
      const bres = await tx.bres.create({
        data: {
          establecimientoId: eid,
          periodo: m.periodo,
          estado: 'cerrado',
          generadoPor: admin.id,
          cerradoEn: finDelMes(m.periodo),
          observaciones: `Importado del balance ${m.hoja}`,
        },
      });
      await tx.bresRenglon.createMany({
        data: m.renglones.map((r) => {
          const t = r.totales;
          const J = esNumero(t.J) ? t.J : 0;
          return {
            bresId: bres.id,
            insumoId: insumoDe.get(normalizarAlias(r.nombre)),
            saldoInicial: entero(t.B),
            entradas: entero(t.C),
            reajustes: 0,
            entregado: entero(t.D),
            noEntregado: entero(t.E),
            demandaReal: entero(t.F),
            saldoFinal: entero(t.H),
            existenciaBodega: entero(t.I),
            pmdr: decimal(t.J) ?? 0,
            med: esNumero(t.K) ? Math.round(t.K * 1e6) / 1e6 : null,
            cantidadMaxima: decimal(t.L),
            cantidadSolicitar: decimal(t.M),
            cantidadMinima: Math.ceil(J * Number(config?.nivelMinimoMeses ?? 2)),
            saldoPorDemanda: entero(t.saldoPorDemanda),
            existenciaMesAnterior: esNumero(t.mesAnterior) ? Math.round(t.mesAnterior) : null,
            mesesHistoria: 0,
            observaciones: notasDe(r),
          };
        }),
      });
    }

    await tx.bitacora.create({
      data: {
        usuarioId: admin.id,
        accion: 'actualizar',
        entidad: 'reporte_servicio',
        detalle: `Historial del balance recargado del Excel: ${meses.length} meses (${meses[0].periodo} a ${meses.at(-1).periodo}), ${nuevos.size} insumos de meses viejos`,
      },
    });
  }, { timeout: 900000, maxWait: 30000 });
  log('Historial cargado.');
  return { ...resultado, cargado: true };
}

module.exports = { cargarHistorial, ALIAS_EQUIVOCADOS };

if (require.main === module) {
  const [, , rutaExcel, bandera] = process.argv;
  (async () => {
    const establecimiento = await prisma.establecimiento.findFirst();
    const meses = JSON.parse(fs.readFileSync(rutaExcel, 'utf8'));
    const r = await cargarHistorial({ meses, eid: establecimiento.id, aplicar: bandera === '--aplicar' });
    if (r.sinServicio.length || r.repetidos.length) process.exitCode = 1;
  })()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
