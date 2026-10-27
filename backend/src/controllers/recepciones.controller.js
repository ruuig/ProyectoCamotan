/**
 * Recepcion en bodega: lo que llega con un documento (despacho de la DDRISS,
 * acta de donacion, prestamo) y varios productos.
 *
 * La entrada es la cantidad del documento, para que el kardex y el BRES
 * cuadren con lo que dice la DDRISS. Si llego menos, la diferencia queda
 * "por reclamar": cuenta en el saldo, pero no se entrega hasta que llegue.
 * Si algo no llego en buen estado, el lote entra en cuarentena.
 */

const prisma = require('../config/db');
const { registrarIngreso, problemaConLoteExistente } = require('../services/movimientos.service');
const { validarFechasLote } = require('../services/bodega.service');

const PROCEDENCIA = { despacho: 'Despacho', donacion: 'Donación', traslado: 'Traslado de otro servicio', prestamo: 'Préstamo' };

/** "2026-10" o "2026-10-15": el mes y año sirven hasta el ultimo dia del mes. */
function vencimiento(texto) {
  if (/^\d{4}-\d{2}$/.test(texto)) {
    const [a, m] = texto.split('-').map(Number);
    return new Date(Date.UTC(a, m, 0, 12));
  }
  return new Date(`${texto}T12:00:00Z`);
}

async function crear(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const b = req.body;

  const ids = [...new Set(b.renglones.map((r) => r.insumoId))];
  const insumos = await prisma.insumo.findMany({ where: { id: { in: ids }, establecimientoId } });
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const vistos = new Set();
  for (const [i, r] of b.renglones.entries()) {
    const insumo = porId.get(r.insumoId);
    const n = `Renglón ${i + 1}`;
    if (!insumo) return next({ status: 404, codigo: 'insumo_no_encontrado', mensaje: `${n}: el producto no existe` });
    if (r.cantidadRecibida > r.cantidadDocumento) {
      return next({ status: 400, codigo: 'mas_que_el_documento', mensaje: `${n}: llegó más de lo que dice el documento. Anote el documento correcto` });
    }
    const fechas = validarFechasLote({ fechaVence: vencimiento(r.vence) });
    if (fechas.errores.length) return next({ status: 400, codigo: 'fechas_invalidas', mensaje: `${n} (${insumo.nombreGenerico}): ${fechas.errores[0]}` });
    const clave = `${r.insumoId}|${r.numeroLote}`;
    if (vistos.has(clave)) {
      return next({ status: 409, codigo: 'lote_duplicado', mensaje: `${n}: el lote ${r.numeroLote} de ${insumo.nombreGenerico} está dos veces en el documento` });
    }
    const existente = await prisma.lote.findFirst({ where: { insumoId: r.insumoId, numeroLote: r.numeroLote } });
    const problema = existente && problemaConLoteExistente(existente, vencimiento(r.vence));
    if (problema) return next({ status: 409, codigo: 'lote_distinto', mensaje: `${n} (${insumo.nombreGenerico}): ${problema}` });
    vistos.add(clave);
  }

  const recepcion = await prisma.$transaction(async (tx) => {
    const creada = await tx.recepcion.create({
      data: {
        establecimientoId,
        numeroDocumento: b.numeroDocumento || null,
        procedencia: b.procedencia,
        remitente: b.remitente,
        acta: b.acta || null,
        fecha: new Date(`${b.fecha}T00:00:00Z`),
        observaciones: b.observaciones || null,
        registradaPor: req.usuario.id,
      },
    });
    for (const r of b.renglones) {
      const faltan = r.cantidadDocumento - r.cantidadRecibida;
      const { lote } = await registrarIngreso(tx, {
        insumoId: r.insumoId,
        numeroLote: r.numeroLote,
        fechaVence: vencimiento(r.vence),
        cantidad: r.cantidadDocumento,
        cantidadDocumento: r.cantidadDocumento,
        costoUnitario: r.costoUnitario ?? null,
        origen: b.procedencia,
        actaDonacion: b.procedencia === 'donacion' ? (b.acta || null) : null,
        verificacion: r.conforme === false ? { etiquetado: false } : {},
        observacionRecepcion: [faltan > 0 ? `Llegaron ${r.cantidadRecibida} de ${r.cantidadDocumento}` : null, r.observacion || null].filter(Boolean).join('. ') || null,
        usuarioId: req.usuario.id,
        motivo: `Recepción ${b.numeroDocumento ? `documento ${b.numeroDocumento}` : ''} de ${b.remitente}`.replace('  ', ' '),
        recepcionId: creada.id,
      });
      if (faltan > 0) await tx.lote.update({ where: { id: lote.id }, data: { cantidadPorReponer: faltan } });
    }
    return creada;
  });

  const faltantes = b.renglones.filter((r) => r.cantidadRecibida < r.cantidadDocumento).length;
  await req.bitacora({
    accion: 'crear',
    entidad: 'recepcion',
    entidadId: recepcion.id,
    detalle: `Recepción ${recepcion.numeroDocumento ?? 'sin número'} de ${recepcion.remitente}: ${b.renglones.length} producto(s)${faltantes ? `, ${faltantes} con faltante` : ''}`,
  });
  res.status(201).json({ recepcion: await detalle(recepcion.id, establecimientoId), faltantes });
}

async function detalle(id, establecimientoId) {
  const r = await prisma.recepcion.findFirst({
    where: { id, establecimientoId },
    include: {
      usuario: { select: { nombre: true } },
      lotes: { orderBy: { id: 'asc' }, include: { insumo: { select: { nombreGenerico: true, concentracion: true, unidadEntrega: true } } } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    numeroDocumento: r.numeroDocumento,
    procedencia: r.procedencia,
    procedenciaTexto: PROCEDENCIA[r.procedencia],
    remitente: r.remitente,
    acta: r.acta,
    fecha: r.fecha,
    observaciones: r.observaciones,
    registradaPor: r.usuario.nombre,
    registradaEn: r.registradaEn,
    renglones: r.lotes.map((l) => ({
      loteId: l.id,
      insumo: [l.insumo.nombreGenerico, l.insumo.concentracion].filter(Boolean).join(' '),
      unidad: l.insumo.unidadEntrega,
      numeroLote: l.numeroLote,
      fechaVence: l.fechaVence,
      cantidadDocumento: l.cantidadDocumento ?? l.cantidadInicial,
      porReponer: l.cantidadPorReponer,
      costoUnitario: l.costoUnitario,
      estado: l.estado,
    })),
  };
}

async function listar(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const lista = await prisma.recepcion.findMany({
    where: { establecimientoId },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    take: 100,
    include: { lotes: { select: { cantidadInicial: true, cantidadPorReponer: true } } },
  });
  res.json({
    recepciones: lista.map((r) => ({
      id: r.id,
      numeroDocumento: r.numeroDocumento,
      procedenciaTexto: PROCEDENCIA[r.procedencia],
      remitente: r.remitente,
      fecha: r.fecha,
      productos: r.lotes.length,
      unidades: r.lotes.reduce((s, l) => s + l.cantidadInicial, 0),
      porReponer: r.lotes.reduce((s, l) => s + l.cantidadPorReponer, 0),
    })),
  });
}

async function obtener(req, res, next) {
  const r = await detalle(Number(req.params.id), req.usuario.establecimientoId);
  if (!r) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Recepción no encontrada' });
  res.json({ recepcion: r });
}

/** Lo que dice el documento y todavia no llega: hay que reclamarlo. */
async function faltantes(req, res) {
  const lotes = await prisma.lote.findMany({
    where: { cantidadPorReponer: { gt: 0 }, insumo: { establecimientoId: req.usuario.establecimientoId } },
    orderBy: { recibidoEn: 'asc' },
    include: {
      insumo: { select: { nombreGenerico: true, concentracion: true, unidadEntrega: true } },
      recepcion: { select: { id: true, numeroDocumento: true, remitente: true, fecha: true } },
    },
  });
  res.json({
    faltantes: lotes.map((l) => ({
      loteId: l.id,
      insumo: [l.insumo.nombreGenerico, l.insumo.concentracion].filter(Boolean).join(' '),
      unidad: l.insumo.unidadEntrega,
      numeroLote: l.numeroLote,
      porReponer: l.cantidadPorReponer,
      documento: l.recepcion?.numeroDocumento ?? null,
      remitente: l.recepcion?.remitente ?? null,
      fecha: l.recepcion?.fecha ?? l.recibidoEn,
    })),
  });
}

/** Llego lo que faltaba (todo o una parte): ya se puede entregar. */
async function reponer(req, res, next) {
  const lote = await prisma.lote.findFirst({
    where: { id: Number(req.params.id), insumo: { establecimientoId: req.usuario.establecimientoId } },
    include: { insumo: { select: { nombreGenerico: true } } },
  });
  if (!lote) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Lote no encontrado' });
  if (req.body.cantidad > lote.cantidadPorReponer) {
    return next({ status: 400, codigo: 'mas_de_lo_que_falta', mensaje: `Solo faltaban ${lote.cantidadPorReponer}` });
  }
  const actualizado = await prisma.lote.update({
    where: { id: lote.id },
    data: { cantidadPorReponer: { decrement: req.body.cantidad } },
  });
  await req.bitacora({
    accion: 'actualizar',
    entidad: 'lote',
    entidadId: lote.id,
    detalle: `Llegaron ${req.body.cantidad} que faltaban de ${lote.insumo.nombreGenerico} lote ${lote.numeroLote}`,
  });
  res.json({ lote: { id: actualizado.id, porReponer: actualizado.cantidadPorReponer } });
}

module.exports = { crear, listar, obtener, faltantes, reponer, vencimiento };
