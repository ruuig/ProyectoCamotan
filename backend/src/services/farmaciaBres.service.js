/**
 * BRES de la farmacia (post-consulta).
 *
 * Post-consulta lleva su propia existencia: recibe de la bodega por
 * requisición, entrega a los pacientes y cuenta su estante. Su BRES se arma
 * solo con los movimientos que ocurrieron en la farmacia, con las mismas
 * columnas y fórmulas del BRES del centro, para imprimirlo en el formulario:
 *
 *   B saldo anterior   = lo que había en farmacia al empezar el mes.
 *   C entradas         = lo que llegó de la bodega.
 *   D entregado        = lo entregado a pacientes, menos las entregas anuladas.
 *   E no entregado     = lo recetado que no había.
 *   G reajustes        = conteos del estante, correcciones y devoluciones a bodega.
 *   H saldo siguiente  = B + C - D + G (lo que hay en el estante).
 *   J promedio         = demanda (D + E) de los últimos meses.
 */
const prisma = require('../config/db');
const { configuracion, limitesDePeriodo } = require('./abastecimiento.service');
const { filaBres, ultimosPeriodos, periodoAnterior } = require('./bodega.service');
const { parametrosBres } = require('./bodegaDatos.service');
const { COLUMNAS } = require('./bres.service');

const vacia = () => ({ B: 0, C: 0, D: 0, E: 0, G: 0 });

async function bresFarmacia(establecimientoId, periodo) {
  const config = await configuracion(establecimientoId);
  const p = parametrosBres(config);
  const { desde, hasta } = limitesDePeriodo(periodo);
  // Meses del promedio: los anteriores al del BRES, como en el del centro.
  const meses = ultimosPeriodos(periodoAnterior(periodo), p.mesesPromedio);
  const inicioHistoria = limitesDePeriodo(meses[0]).desde;
  const delInsumo = { lote: { insumo: { establecimientoId } } };

  const [antes, movimientos, faltantes, insumos] = await Promise.all([
    prisma.movimientoInsumo.findMany({
      where: { ...delInsumo, ubicacion: 'farmacia', registradoEn: { lt: desde } },
      select: { cantidad: true, lote: { select: { insumoId: true } } },
    }),
    prisma.movimientoInsumo.findMany({
      where: { ...delInsumo, ubicacion: 'farmacia', registradoEn: { gte: inicioHistoria, lt: hasta } },
      select: { tipo: true, cantidad: true, registradoEn: true, lote: { select: { insumoId: true } } },
    }),
    prisma.demandaNoAtendida.findMany({
      where: { establecimientoId, registradaEn: { gte: inicioHistoria, lt: hasta } },
      select: { insumoId: true, cantidad: true, registradaEn: true },
    }),
    prisma.insumo.findMany({ where: { establecimientoId }, orderBy: [{ nombreGenerico: 'asc' }, { concentracion: 'asc' }] }),
  ]);

  const mes = new Map(); // insumo -> cifras del mes del BRES
  const demandaHistoria = new Map(); // insumo -> demanda de los meses del promedio
  const delMes = (id) => { if (!mes.has(id)) mes.set(id, vacia()); return mes.get(id); };
  const sumarHistoria = (id, n) => demandaHistoria.set(id, (demandaHistoria.get(id) ?? 0) + n);

  for (const m of antes) delMes(m.lote.insumoId).B += m.cantidad;
  for (const m of movimientos) {
    const id = m.lote.insumoId;
    const enMes = m.registradoEn >= desde;
    if (m.tipo === 'entrega' || m.tipo === 'devolucion') {
      // La devolución de una entrega anulada regresa al estante: resta de lo entregado.
      if (enMes) delMes(id).D -= m.cantidad;
      else sumarHistoria(id, -m.cantidad);
    } else if (enMes) {
      if (m.tipo === 'paso_farmacia' && m.cantidad > 0) delMes(id).C += m.cantidad;
      else delMes(id).G += m.cantidad;
    }
  }
  for (const f of faltantes) {
    if (f.registradaEn >= desde) delMes(f.insumoId).E += f.cantidad;
    else sumarHistoria(f.insumoId, f.cantidad);
  }

  const renglones = [];
  for (const i of insumos) {
    const c = mes.get(i.id) ?? vacia();
    const historia = demandaHistoria.get(i.id) ?? 0;
    if (!c.B && !c.C && !c.D && !c.E && !c.G && !historia) continue;
    const H = c.B + c.C - c.D + c.G;
    const b = filaBres({ B: c.B, C: c.C, D: c.D, E: c.E, G: c.G, I: H, saldos: [], promedios: [historia / p.mesesPromedio], config: p });
    renglones.push({
      insumoId: i.id,
      codigoInterno: i.codigoInterno,
      nombre: i.nombreGenerico,
      formaFarmaceutica: i.formaFarmaceutica,
      concentracion: i.concentracion,
      unidadEntrega: i.unidadEntrega,
      categoria: i.categoria,
      saldoInicial: b.B,
      entradas: b.C,
      entregado: b.D,
      noEntregado: b.E,
      demandaReal: b.F,
      reajustes: b.G,
      saldoFinal: b.H,
      existenciaBodega: b.I,
      pmdr: b.J,
      med: b.K,
      cantidadMaxima: b.L,
      cantidadSolicitar: Math.max(0, b.M),
    });
  }

  return {
    periodo,
    servicio: 'Farmacia (post-consulta)',
    columnas: COLUMNAS,
    renglones,
    // La farmacia informa por el sistema: no hay servicios ni recepciones que revisar.
    descuadres: [],
    observacionesRecepcion: [],
    serviciosSinInforme: 0,
    configuracion: p,
    firmas: {
      encargadoBodega: null,
      coordinadorMunicipal: config.coordinadorMunicipal,
      cargoCoordinador: config.cargoCoordinador,
    },
  };
}

module.exports = { bresFarmacia };
