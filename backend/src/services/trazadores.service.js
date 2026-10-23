/**
 * Informe de trazadores de la bodega (el «informe quincenal» de la DDRISS),
 * una vez al mes: de cada renglón del formato, el promedio mensual de demanda
 * real (columna J del BRES) y la existencia física en bodega (columna I).
 *
 * El mes que ya tiene BRES guardado sale de ahí; el que no (el mes en curso)
 * se calcula en el momento, con lo que hay hoy en bodega. Los meses anteriores
 * guardados dicen cómo va cada producto: para cuántos meses alcanzaba.
 */
const prisma = require('../config/db');
const bres = require('./bres.service');
const { periodoAnterior } = require('./bodega.service');
const { FORMATOS } = require('../data/trazadores');

const MESES_HISTORIA = 6;
const num = (v) => (v === null || v === undefined ? null : Number(v));

function fallo(status, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { status, codigo, mensaje });
}

/** J e I de cada insumo en un mes: del BRES guardado o calculado. */
async function cifrasDelMes(establecimientoId, periodo, { calcularSiFalta }) {
  const guardado = await prisma.bres.findUnique({
    where: { establecimientoId_periodo: { establecimientoId, periodo } },
    select: { estado: true, renglones: { select: { insumoId: true, pmdr: true, existenciaBodega: true } } },
  });
  if (guardado) {
    return { fuente: guardado.estado === 'cerrado' ? 'cerrado' : 'borrador', porInsumo: new Map(guardado.renglones.map((r) => [r.insumoId, { J: num(r.pmdr), I: r.existenciaBodega }])) };
  }
  if (!calcularSiFalta) return null;
  const vista = await bres.calcular(establecimientoId, periodo);
  return { fuente: 'en_curso', porInsumo: new Map(vista.renglones.map((r) => [r.insumoId, { J: num(r.pmdr), I: r.existenciaBodega }])) };
}

/** Suma las cifras de los productos del renglón; sin producto, el renglón va vacío. */
function sumar(ids, porInsumo) {
  if (!ids.length || !porInsumo) return { J: null, I: null };
  let J = 0;
  let I = 0;
  let alguno = false;
  for (const id of ids) {
    const c = porInsumo.get(id);
    if (!c) continue;
    alguno = true;
    J += c.J ?? 0;
    I += c.I ?? 0;
  }
  return alguno ? { J, I } : { J: 0, I: 0 };
}
const mesesDe = ({ J, I }) => (J > 0 && I !== null ? I / J : null);

async function trazador(establecimientoId, formato, periodo) {
  const def = FORMATOS[formato];
  if (!def) throw fallo(404, 'formato_desconocido', 'Ese formato no existe');

  const nombres = [...new Set(Object.values(def.secciones).flatMap((s) => s.renglones.flatMap((r) => r.catalogo)))];
  const insumos = await prisma.insumo.findMany({ where: { establecimientoId, nombreGenerico: { in: nombres } }, select: { id: true, nombreGenerico: true } });
  const idsDe = new Map();
  for (const i of insumos) idsDe.set(i.nombreGenerico, [...(idsDe.get(i.nombreGenerico) ?? []), i.id]);

  const anteriores = [];
  for (let p = periodoAnterior(periodo), n = 0; n < MESES_HISTORIA; n += 1, p = periodoAnterior(p)) anteriores.unshift(p);
  const [actual, ...historia] = await Promise.all([
    cifrasDelMes(establecimientoId, periodo, { calcularSiFalta: true }),
    ...anteriores.map((p) => cifrasDelMes(establecimientoId, p, { calcularSiFalta: false })),
  ]);
  const conHistoria = anteriores.map((p, i) => ({ periodo: p, cifras: historia[i] })).filter((h) => h.cifras);

  let numero = 0;
  const secciones = def.secciones.map((s) => ({
    titulo: s.titulo,
    columna: s.columna ?? null,
    renglones: s.renglones.map((r, i) => {
      const ids = r.catalogo.flatMap((n) => idsDe.get(n) ?? []);
      const cifras = sumar(ids, actual.porInsumo);
      numero += 1;
      return {
        no: i + 1,
        clave: numero,
        texto: r.texto,
        maneja: ids.length > 0,
        productos: r.catalogo,
        pmdr: ids.length ? cifras.J : null,
        existencia: ids.length ? cifras.I : null,
        meses: ids.length ? mesesDe(cifras) : null,
        historia: ids.length ? conHistoria.map((h) => ({ periodo: h.periodo, meses: mesesDe(sumar(ids, h.cifras.porInsumo)) })) : [],
      };
    }),
  }));

  return {
    formato,
    titulo: def.titulo,
    periodo,
    fuente: actual.fuente,
    mesesHistoria: conHistoria.map((h) => h.periodo),
    secciones,
  };
}

module.exports = { trazador, FORMATOS_TRAZADOR: Object.fromEntries(Object.entries(FORMATOS).map(([k, f]) => [k, f.titulo])) };
