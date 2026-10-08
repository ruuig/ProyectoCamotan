const farmacia = require('../services/farmacia.service');

/** Existencia de la farmacia por insumo y por lote. */
async function existencias(req, res) {
  res.json({ insumos: await farmacia.existencias(req.usuario.establecimientoId) });
}

/** Resumen del dia (por defecto, hoy). */
async function dia(req, res) {
  const fecha = req.query.fecha ?? farmacia.hoyGuatemala();
  res.json(await farmacia.resumenDelDia(req.usuario.establecimientoId, fecha));
}

/** Cierre del dia con el conteo de lo que hay en el estante. */
async function cerrarDia(req, res) {
  const { cierre, ajustes } = await farmacia.cerrarDia(req.usuario.establecimientoId, req.body, req.usuario.id);
  await req.bitacora({
    accion: 'crear',
    entidad: 'cierre_farmacia',
    entidadId: cierre.id,
    detalle: `Cierre del día en farmacia: ${req.body.conteos.length} insumo(s) contado(s), ${ajustes.length} ajuste(s)`
      + (ajustes.length ? `: ${ajustes.map((a) => `${a.insumo} lote ${a.numeroLote} ${a.cantidad > 0 ? '+' : ''}${a.cantidad}`).join(', ')}` : ''),
  });
  res.status(201).json({ cierreId: cierre.id, ajustes });
}

/** Devolucion de la farmacia a la bodega. */
async function devolver(req, res) {
  const hechos = await farmacia.devolverABodega(req.usuario.establecimientoId, req.body, req.usuario.id);
  await req.bitacora({
    accion: 'crear',
    entidad: 'movimiento_insumo',
    detalle: `Devolución de farmacia a bodega (${req.body.motivo}): ${hechos.map((h) => `lote ${h.numeroLote} x${h.cantidad}`).join(', ')}`,
  });
  res.status(201).json({ devueltos: hechos });
}

module.exports = { existencias, dia, cerrarDia, devolver };
