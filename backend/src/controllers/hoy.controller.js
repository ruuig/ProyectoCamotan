/**
 * "Hoy" en bodega: lo pendiente, cada cosa con su accion. Solo lo que pide
 * hacer algo; si no hay nada pendiente, no aparece.
 */

const prisma = require('../config/db');
const datos = require('../services/bodegaDatos.service');
const { periodoDe } = require('../services/logistica.service');

const periodoAnterior = (p) => {
  const [a, m] = p.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};

async function hoy(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const ahora = new Date();
  const periodo = periodoDe(ahora);
  const anterior = periodoAnterior(periodo);
  const en3Meses = new Date(ahora.getTime() + 91 * 86400000);
  const lote = { insumo: { establecimientoId }, cantidadActual: { gt: 0 } };
  const kardexDesde = req.query.kardexDesde ? new Date(`${req.query.kardexDesde}T06:00:00Z`) : null;

  const [sinNumero, faltantes, porVencer, vencidos, ubicaciones, informes, bresAnterior, kardex] = await Promise.all([
    prisma.requisicion.count({ where: { establecimientoId, numero: null, estado: { not: 'anulada' } } }),
    prisma.lote.findMany({ where: { insumo: { establecimientoId }, cantidadPorReponer: { gt: 0 } }, select: { insumoId: true, cantidadPorReponer: true } }),
    prisma.lote.count({ where: { ...lote, estado: 'disponible', fechaVence: { gte: ahora, lt: en3Meses } } }),
    prisma.lote.count({ where: { ...lote, fechaVence: { lt: ahora }, estado: { notIn: ['dado_de_baja', 'retirado'] } } }),
    datos.ubicaciones(establecimientoId),
    prisma.informeServicio.count({ where: { periodo, ubicacion: { establecimientoId } } }),
    prisma.bres.findFirst({ where: { establecimientoId, periodo: anterior }, select: { estado: true } }),
    kardexDesde
      ? prisma.movimientoInsumo.count({ where: { ubicacion: 'bodega', registradoEn: { gte: kardexDesde }, lote: { insumo: { establecimientoId } } } })
      : null,
  ]);
  const servicios = ubicaciones.filter(datos.esServicioQueInforma).length;

  const pendientes = [];
  if (bresAnterior?.estado !== 'cerrado') pendientes.push({ clave: 'cierre', cantidad: 1, periodo: anterior, a: '/inventario/bres' });
  if (sinNumero) pendientes.push({ clave: 'sin_numero', cantidad: sinNumero, a: '/inventario/requisiciones?ver=sin_numero' });
  if (faltantes.length) {
    pendientes.push({
      clave: 'faltantes',
      cantidad: new Set(faltantes.map((f) => f.insumoId)).size,
      unidades: faltantes.reduce((s, f) => s + f.cantidadPorReponer, 0),
      a: '/inventario/recibir?ver=faltantes',
    });
  }
  if (servicios - informes > 0) pendientes.push({ clave: 'informes', cantidad: servicios - informes, de: servicios, periodo, a: '/inventario/informes' });
  if (vencidos) pendientes.push({ clave: 'vencidos', cantidad: vencidos, a: '/inventario/semaforo' });
  if (porVencer) pendientes.push({ clave: 'por_vencer', cantidad: porVencer, a: '/inventario/semaforo' });
  if (kardex) pendientes.push({ clave: 'kardex', cantidad: kardex, desde: req.query.kardexDesde, a: `/inventario/kardex?desde=${req.query.kardexDesde}` });

  res.json({
    periodo,
    anterior,
    pendientes,
    // Todas las cifras, aunque esten en cero, para la franja de resumen.
    resumen: {
      informes: { listos: informes, de: servicios },
      faltantes: { productos: new Set(faltantes.map((f) => f.insumoId)).size, unidades: faltantes.reduce((s, f) => s + f.cantidadPorReponer, 0) },
      sinNumero,
      vencidos,
      porVencer,
      kardex,
      cierreAnterior: bresAnterior?.estado ?? 'sin_generar',
    },
  });
}

module.exports = { hoy };
