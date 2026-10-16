/**
 * Traslado de la bodega a un servicio. Es el despacho de una requisicion y
 * tambien lo usa el traslado directo. Cada renglon sale de un lote: a un
 * servicio el lote sale del centro; a la farmacia pasa de la bodega a ella.
 */

const { numeroTraslado } = require('./bodega.service');
const { esServicioQueInforma } = require('./bodegaDatos.service');
const { descontarDeLote, pasarEntreUbicaciones } = require('./movimientos.service');

/** null si se puede trasladar ahi; si no, el error para la respuesta. */
function errorDestino(ubicacion) {
  const valido = ubicacion?.tipo === 'centro_salud' || ubicacion?.tipo === 'unidad_interna' || (ubicacion && esServicioQueInforma(ubicacion));
  if (!ubicacion || !ubicacion.activo || !valido) {
    return { status: 400, codigo: 'destino_invalido', mensaje: 'Se entrega a la farmacia, a las unidades del centro, a puestos de salud y a centros comunitarios activos' };
  }
  return null;
}

/** Revisa que cada lote exista y no este vencido. */
function errorLotes(renglones, porId, ahora = new Date()) {
  for (const r of renglones) {
    const lote = porId.get(r.loteId);
    if (!lote) return { status: 404, codigo: 'lote_no_encontrado', mensaje: 'Uno de los lotes no existe' };
    if (new Date(lote.fechaVence) < ahora) {
      return { status: 409, codigo: 'lote_vencido', mensaje: `El lote ${lote.numeroLote} está vencido: no se puede trasladar` };
    }
  }
  return null;
}

/** Crea el traslado y sus movimientos dentro de la transaccion tx. */
async function registrarTraslado(tx, { establecimientoId, ubicacion, usuarioId, recibidoPor, observacion = null, renglones, requisicion = null }) {
  const aFarmacia = ubicacion.tipo === 'centro_salud';
  const anio = new Date(Date.now() - 6 * 3600000).getUTCFullYear();
  // El siguiente al mayor del año, no "cuantos hay + 1": si alguno faltara,
  // contar repetiria un numero ya usado.
  const ultimo = await tx.traslado.findFirst({
    where: { establecimientoId, numero: { startsWith: `TRA-${anio}-` } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });
  const correlativo = ultimo ? Number(ultimo.numero.split('-').pop()) + 1 : 1;
  const creado = await tx.traslado.create({
    data: {
      establecimientoId,
      numero: numeroTraslado(anio, correlativo),
      ubicacionId: ubicacion.id,
      entregadoPor: usuarioId,
      recibidoPor,
      observacion,
      requisicionId: requisicion?.id ?? null,
    },
  });
  const documento = requisicion?.numero ? `${creado.numero}, requisición ${requisicion.numero}` : creado.numero;
  for (const r of renglones) {
    if (aFarmacia) {
      await pasarEntreUbicaciones(tx, {
        loteId: r.loteId,
        cantidad: r.cantidad,
        desde: 'bodega',
        usuarioId,
        trasladoId: creado.id,
        motivo: `Entrega a farmacia ${documento}`,
      });
    } else {
      await descontarDeLote(tx, {
        loteId: r.loteId,
        cantidad: r.cantidad,
        usuarioId,
        // Las unidades del centro lo usan ahi mismo: no informan cada mes.
        tipo: ubicacion.tipo === 'unidad_interna' ? 'consumo_interno' : 'traslado',
        servicio: ubicacion.nombre,
        trasladoId: creado.id,
        motivo: `Traslado ${documento}`,
      });
    }
  }
  return creado;
}

module.exports = { errorDestino, errorLotes, registrarTraslado };
