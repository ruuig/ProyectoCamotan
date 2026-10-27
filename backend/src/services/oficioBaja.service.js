const prisma = require('../config/db');
const { registrarBaja, ETIQUETA_CAUSA } = require('./movimientos.service');

/**
 * Bajas de inventario: lo vencido o dañado sale de la bodega en un solo paso.
 * Cada baja queda registrada con su lote, cantidad, causa, quién y cuándo.
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

/** Correlativo de la baja: BAJA-AAAA-NNNN, legible y ordenable. */
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

/** Da de baja una cantidad de un lote: se descuenta del inventario en ese momento. */
async function darDeBaja(establecimientoId, { loteId, cantidad, causa, usuarioId }, ahora = new Date()) {
  const lote = await prisma.lote.findFirst({
    where: { id: loteId, insumo: { establecimientoId } },
    include: { insumo: true },
  });

  if (!lote) throw fallo(404, 'no_encontrado', 'Lote no encontrado');

  // La baja sale de la bodega: lo que este en farmacia se devuelve antes.
  const enBodega = lote.cantidadActual - lote.cantidadFarmacia;
  if (enBodega < cantidad) {
    throw fallo(
      400,
      'cantidad_excede_existencia',
      lote.cantidadFarmacia > 0
        ? `En bodega hay ${enBodega} de este lote y ${lote.cantidadFarmacia} en farmacia. Farmacia debe devolverlo a bodega antes de darlo de baja`
        : `El lote solo tiene ${enBodega} y se quieren dar de baja ${cantidad}`,
    );
  }

  const correlativo = await siguienteCorrelativo(establecimientoId, ahora);

  return prisma.$transaction(async (tx) => {
    await registrarBaja(tx, { loteId, cantidad, causa, usuarioId, motivo: `Baja ${correlativo}`, ahora });
    return tx.oficioBaja.create({
      data: {
        establecimientoId,
        correlativo,
        loteId,
        cantidad,
        causa,
        precioUnitario: lote.costoUnitario,
        estado: 'aplicado',
        solicitadoPor: usuarioId,
        solicitadoEn: ahora,
        aplicadoEn: ahora,
      },
    });
  });
}

/** Las bajas hechas, la más reciente primero. */
async function listar(establecimientoId) {
  const bajas = await prisma.oficioBaja.findMany({
    where: { establecimientoId, estado: 'aplicado' },
    include: {
      lote: { select: { numeroLote: true, fechaVence: true, insumo: { select: { nombreGenerico: true } } } },
      solicitante: { select: { nombre: true } },
    },
    orderBy: [{ aplicadoEn: 'desc' }],
    take: 200,
  });

  return bajas.map((b) => ({
    id: b.id,
    cantidad: b.cantidad,
    causa: b.causa,
    causaEtiqueta: ETIQUETA_CAUSA[b.causa] ?? b.causa,
    insumo: b.lote.insumo.nombreGenerico,
    numeroLote: b.lote.numeroLote,
    fechaVence: b.lote.fechaVence,
    hechaPor: b.solicitante.nombre,
    hechaEn: b.aplicadoEn,
  }));
}

/**
 * Lotes que ya se pueden dar de baja: vencidos o en cuarentena con
 * existencia en bodega.
 */
async function candidatos(establecimientoId, ahora = new Date()) {
  const lotes = await prisma.lote.findMany({
    where: {
      insumo: { establecimientoId, activo: true },
      cantidadActual: { gt: 0 },
      numeroLote: { not: 'SIN-LOTE' },
      OR: [{ fechaVence: { lte: ahora } }, { estado: { in: ['cuarentena', 'retirado'] } }],
    },
    include: {
      insumo: { select: { nombreGenerico: true, unidadEntrega: true } },
    },
    orderBy: { fechaVence: 'asc' },
  });

  return lotes
    .filter((l) => l.cantidadActual > l.cantidadFarmacia)
    .map((l) => ({
      loteId: l.id,
      numeroLote: l.numeroLote,
      insumo: l.insumo.nombreGenerico,
      unidadEntrega: l.insumo.unidadEntrega,
      cantidadActual: l.cantidadActual - l.cantidadFarmacia,
      // Si una parte sigue en farmacia, tiene que volver a bodega para darla de baja.
      enFarmacia: l.cantidadFarmacia,
      fechaVence: l.fechaVence,
      estado: l.estado,
      costoUnitario: l.costoUnitario === null ? null : Number(l.costoUnitario),
      causaSugerida: new Date(l.fechaVence) <= new Date(ahora) ? 'producto_vencido' : 'producto_danado',
    }));
}

module.exports = {
  PREFIJO,
  siguienteCorrelativo,
  darDeBaja,
  listar,
  candidatos,
};
