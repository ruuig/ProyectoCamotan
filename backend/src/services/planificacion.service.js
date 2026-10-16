const prisma = require('../config/db');
const { limitesDePeriodo } = require('./abastecimiento.service');

/**
 * Planificación familiar del mes, como la pide el informe mensual del SIGSA
 * (fuente: Registro diario de post-consulta, SIGSA 4): usuarias por método y
 * por tipo, y lo entregado.
 *
 *  - Nueva: primera vez que recibe un método en el servicio.
 *  - Reconsulta: ya había recibido antes.
 *  - Activa: tiene un año o más en el programa y volvió por su dotación.
 */

const METODOS = [
  { clave: 'inyectable', texto: 'Inyectable', unidad: 'inyecciones', es: /depo|medroxi|noristerat|norist|mesigyna/i },
  { clave: 'pildora', texto: 'Píldora', unidad: 'ciclos', es: /levonog.*etinil|etinilestradiol|blister|p[ií]ldora|microgynon/i },
  { clave: 'condon', texto: 'Condón', unidad: 'condones', es: /cond[oó]n/i },
  { clave: 'implante', texto: 'Implante', unidad: 'implantes', es: /jadelle|implante/i },
  { clave: 'diu', texto: 'DIU', unidad: 'dispositivos', es: /\bdiu\b|t de cobre|intrauterino/i },
  { clave: 'natural', texto: 'Collar (método natural)', unidad: 'collares', es: /collar/i },
];

/** Método de planificación de un insumo, o null si no es un método (jeringa, lubricante…). */
function metodoDe(nombre) {
  return METODOS.find((m) => m.es.test(nombre ?? ''))?.clave ?? null;
}

const UN_ANIO = 365 * 86400000;

/**
 * Tipo de usuaria con sus entregas de métodos (fechas), para el mes que
 * empieza en `desde`.
 */
function tipoDeUsuaria(fechasPrevias, primeraDelMes, desde) {
  const previas = fechasPrevias.filter((f) => f < desde);
  if (!previas.length) return 'nueva';
  const primera = Math.min(...previas.map((f) => f.getTime()));
  return primeraDelMes.getTime() - primera >= UN_ANIO ? 'activa' : 'reconsulta';
}

async function planificacionDelMes(establecimientoId, periodo) {
  const { desde, hasta } = limitesDePeriodo(periodo);
  const entregas = await prisma.dispensacion.findMany({
    where: {
      anulada: false,
      registradaEn: { lt: hasta },
      prescripcion: { insumo: { establecimientoId, categoria: 'planificacion_familiar' }, atencion: { establecimientoId } },
    },
    select: {
      cantidad: true,
      registradaEn: true,
      aplicadaEnServicio: true,
      prescripcion: { select: { insumo: { select: { nombreGenerico: true } }, atencion: { select: { pacienteId: true } } } },
    },
    orderBy: { registradaEn: 'asc' },
  });

  // Historial de cada paciente: todas sus fechas de entrega de un método.
  const historial = new Map();
  const delMes = [];
  for (const e of entregas) {
    const metodo = metodoDe(e.prescripcion.insumo.nombreGenerico);
    if (!metodo) continue;
    const pacienteId = e.prescripcion.atencion.pacienteId;
    const fecha = new Date(e.registradaEn);
    if (!historial.has(pacienteId)) historial.set(pacienteId, []);
    historial.get(pacienteId).push(fecha);
    if (fecha >= desde) delMes.push({ pacienteId, metodo, cantidad: e.cantidad, fecha, aplicada: e.aplicadaEnServicio });
  }

  const filas = METODOS.map((m) => ({ clave: m.clave, texto: m.texto, unidad: m.unidad, nueva: 0, reconsulta: 0, activa: 0, usuarias: 0, entregado: 0, aplicado: 0 }));
  const porMetodo = new Map(filas.map((f) => [f.clave, f]));
  const contadas = new Set();
  for (const d of delMes) {
    const f = porMetodo.get(d.metodo);
    f.entregado += d.cantidad;
    if (d.aplicada) f.aplicado += d.cantidad;
    const clave = `${d.pacienteId}:${d.metodo}`;
    if (contadas.has(clave)) continue;
    contadas.add(clave);
    const primeraDelMes = delMes.filter((x) => x.pacienteId === d.pacienteId).map((x) => x.fecha).sort((a, b) => a - b)[0];
    f[tipoDeUsuaria(historial.get(d.pacienteId), primeraDelMes, desde)] += 1;
    f.usuarias += 1;
  }

  return {
    periodo,
    metodos: filas,
    total: {
      usuarias: new Set(delMes.map((d) => d.pacienteId)).size,
      nueva: filas.reduce((t, f) => t + f.nueva, 0),
      reconsulta: filas.reduce((t, f) => t + f.reconsulta, 0),
      activa: filas.reduce((t, f) => t + f.activa, 0),
    },
  };
}

module.exports = { METODOS, metodoDe, tipoDeUsuaria, planificacionDelMes };
