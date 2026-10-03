const prisma = require('../config/db');
const { registrarBaja, ETIQUETA_CAUSA } = require('./movimientos.service');

/**
 * Oficio de baja.
 *
 * El procedimiento del MSPAS no permite sacar producto del inventario sin
 * respaldo: hace falta un oficio con cantidad, lote, numero de tarjeta de
 * control, precio y vencimiento, y la baja se inicia con auditoria.
 *
 * Por eso aqui la baja ocurre en tres pasos separados: se solicita, el
 * director la autoriza, y solo entonces se aplica al inventario. Quien
 * solicita no puede aplicarla.
 */

const PREFIJO = 'BAJA';
const DIGITOS = 4;

function fallo(status, codigo, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  error.codigo = codigo;
  error.mensaje = mensaje;
  return error;
}

/** Correlativo del oficio: BAJA-AAAA-NNNN, legible y ordenable. */
async function siguienteCorrelativo(establecimientoId, ahora = new Date()) {
  const anio = ahora.getUTCFullYear();
  const ultimo = await prisma.oficioBaja.findFirst({
    where: { establecimientoId, correlativo: { startsWith: `${PREFIJO}-${anio}-` } },
    orderBy: { correlativo: 'desc' },
    select: { correlativo: true },
  });

  const numero = ultimo ? Number(ultimo.correlativo.split('-')[2]) + 1 : 1;
  return `${PREFIJO}-${anio}-${String(numero).padStart(DIGITOS, '0')}`;
}

/**
 * Solicita la baja. No toca el inventario todavia: el lote sigue ahi hasta
 * que alguien autorice.
 */
async function solicitar(establecimientoId, { loteId, cantidad, causa, detalle, numeroTarjeta, precioUnitario, usuarioId }, ahora = new Date()) {
  const lote = await prisma.lote.findFirst({
    where: { id: loteId, insumo: { establecimientoId } },
    include: { insumo: true },
  });

  if (!lote) throw fallo(404, 'no_encontrado', 'Lote no encontrado');

  if (lote.cantidadActual < cantidad) {
    throw fallo(
      400,
      'cantidad_excede_existencia',
      `El lote solo tiene ${lote.cantidadActual} y se quieren dar de baja ${cantidad}`,
    );
  }

  // Un oficio pendiente sobre el mismo lote bloquearia el saldo dos veces.
  const pendiente = await prisma.oficioBaja.findFirst({
    where: { loteId, estado: { in: ['borrador', 'autorizado'] } },
  });
  if (pendiente) {
    throw fallo(
      409,
      'oficio_pendiente',
      `El lote ya tiene el oficio ${pendiente.correlativo} en trámite`,
    );
  }

  const correlativo = await siguienteCorrelativo(establecimientoId, ahora);

  return prisma.oficioBaja.create({
    data: {
      establecimientoId,
      correlativo,
      loteId,
      cantidad,
      causa,
      detalle,
      numeroTarjeta,
      // Si no se indica, se usa el costo con que se recibio el lote.
      precioUnitario: precioUnitario ?? lote.costoUnitario,
      solicitadoPor: usuarioId,
    },
  });
}

/** El director autoriza. Sigue sin tocarse el inventario. */
async function autorizar(oficioId, establecimientoId, { directorId }) {
  const oficio = await prisma.oficioBaja.findFirst({
    where: { id: oficioId, establecimientoId },
  });

  if (!oficio) throw fallo(404, 'no_encontrado', 'Oficio no encontrado');
  if (oficio.estado !== 'borrador') {
    throw fallo(409, 'estado_invalido', `El oficio ya está en estado "${oficio.estado}"`);
  }

  return prisma.oficioBaja.update({
    where: { id: oficioId },
    data: { estado: 'autorizado', autorizadoPor: directorId, autorizadoEn: new Date() },
  });
}

/**
 * Aplica la baja al inventario. Solo con el oficio ya autorizado: es el
 * unico camino por el que sale producto sin ser consumo.
 */
async function aplicar(oficioId, establecimientoId, { usuarioId }, ahora = new Date()) {
  const oficio = await prisma.oficioBaja.findFirst({
    where: { id: oficioId, establecimientoId },
    include: { lote: { include: { insumo: true } } },
  });

  if (!oficio) throw fallo(404, 'no_encontrado', 'Oficio no encontrado');
  if (oficio.estado === 'aplicado') {
    throw fallo(409, 'ya_aplicado', 'Esa baja ya se aplicó al inventario');
  }
  if (oficio.estado !== 'autorizado') {
    throw fallo(
      409,
      'sin_autorizacion',
      'La baja necesita la autorización del director antes de aplicarse',
    );
  }

  return prisma.$transaction(async (tx) => {
    await registrarBaja(tx, {
      loteId: oficio.loteId,
      cantidad: oficio.cantidad,
      causa: oficio.causa,
      usuarioId,
      motivo: `Oficio ${oficio.correlativo}`,
      ahora,
    });

    return tx.oficioBaja.update({
      where: { id: oficioId },
      data: { estado: 'aplicado', aplicadoEn: ahora },
    });
  });
}

/** Anula un oficio que no se va a ejecutar. */
async function anular(oficioId, establecimientoId) {
  const oficio = await prisma.oficioBaja.findFirst({ where: { id: oficioId, establecimientoId } });
  if (!oficio) throw fallo(404, 'no_encontrado', 'Oficio no encontrado');
  if (oficio.estado === 'aplicado') {
    throw fallo(409, 'ya_aplicado', 'Una baja ya aplicada no se puede anular; use un reajuste');
  }

  return prisma.oficioBaja.update({ where: { id: oficioId }, data: { estado: 'anulado' } });
}

/** El oficio con todo lo que lleva el documento impreso. */
async function obtener(oficioId, establecimientoId) {
  const oficio = await prisma.oficioBaja.findFirst({
    where: { id: oficioId, establecimientoId },
    include: {
      lote: { include: { insumo: true } },
      solicitante: { select: { nombre: true } },
      autorizador: { select: { nombre: true } },
    },
  });

  if (!oficio) return null;

  const precio = oficio.precioUnitario === null ? null : Number(oficio.precioUnitario);

  return {
    ...oficio,
    causaEtiqueta: ETIQUETA_CAUSA[oficio.causa] ?? oficio.causa,
    precioUnitario: precio,
    // Lo que se pierde: el dato con el que se sustenta la baja ante auditoría.
    valorTotal: precio === null ? null : Number((precio * oficio.cantidad).toFixed(2)),
  };
}

/** Los oficios del establecimiento, lo pendiente primero. */
async function listar(establecimientoId) {
  const oficios = await prisma.oficioBaja.findMany({
    where: { establecimientoId },
    include: {
      lote: { select: { numeroLote: true, fechaVence: true, insumo: { select: { nombreGenerico: true } } } },
      solicitante: { select: { nombre: true } },
      autorizador: { select: { nombre: true } },
    },
    orderBy: [{ solicitadoEn: 'desc' }],
  });

  const ORDEN = { borrador: 0, autorizado: 1, aplicado: 2, anulado: 3 };
  return oficios
    .map((o) => ({
      id: o.id,
      correlativo: o.correlativo,
      estado: o.estado,
      cantidad: o.cantidad,
      causa: o.causa,
      causaEtiqueta: ETIQUETA_CAUSA[o.causa] ?? o.causa,
      insumo: o.lote.insumo.nombreGenerico,
      numeroLote: o.lote.numeroLote,
      fechaVence: o.lote.fechaVence,
      solicitadoPor: o.solicitante.nombre,
      solicitadoEn: o.solicitadoEn,
      autorizadoPor: o.autorizador?.nombre ?? null,
      aplicadoEn: o.aplicadoEn,
    }))
    .sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]);
}

/**
 * Lotes que ya se pueden dar de baja: vencidos o en cuarentena con
 * existencia, sin oficio en tramite.
 */
async function candidatos(establecimientoId, ahora = new Date()) {
  const lotes = await prisma.lote.findMany({
    where: {
      insumo: { establecimientoId, activo: true },
      cantidadActual: { gt: 0 },
      OR: [{ fechaVence: { lte: ahora } }, { estado: { in: ['cuarentena', 'retirado'] } }],
    },
    include: {
      insumo: { select: { nombreGenerico: true, unidadEntrega: true } },
      oficiosBaja: { where: { estado: { in: ['borrador', 'autorizado'] } }, select: { correlativo: true } },
    },
    orderBy: { fechaVence: 'asc' },
  });

  return lotes
    .filter((l) => l.oficiosBaja.length === 0)
    .map((l) => ({
      loteId: l.id,
      numeroLote: l.numeroLote,
      insumo: l.insumo.nombreGenerico,
      unidadEntrega: l.insumo.unidadEntrega,
      cantidadActual: l.cantidadActual,
      fechaVence: l.fechaVence,
      estado: l.estado,
      costoUnitario: l.costoUnitario === null ? null : Number(l.costoUnitario),
      causaSugerida: new Date(l.fechaVence) <= new Date(ahora) ? 'producto_vencido' : 'producto_danado',
    }));
}

module.exports = {
  PREFIJO,
  siguienteCorrelativo,
  solicitar,
  autorizar,
  aplicar,
  anular,
  obtener,
  listar,
  candidatos,
};
