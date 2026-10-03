const prisma = require('../config/db');
const { PANELES } = require('../services/paneles.service');
const { ejecutar: evaluarAlertas } = require('../jobs/evaluarAlertas');
const { seriesDelEstablecimiento } = require('../services/series.service');

async function panel(req, res, next) {
  const { rol } = req.params;

  const construir = PANELES[rol];
  if (!construir) {
    return next({ status: 404, codigo: 'panel_desconocido', mensaje: `No existe panel para el rol ${rol}` });
  }

  // Nadie ve el panel de otro rol, salvo el administrador.
  if (req.usuario.rol !== 'admin' && req.usuario.rol !== rol) {
    return next({
      status: 403,
      codigo: 'sin_permiso',
      mensaje: 'No tiene permiso para ver el panel de otro rol',
    });
  }

  // Solo el panel de direccion usa periodo; los demas lo ignoran.
  res.json(await construir(req.usuario.establecimientoId, new Date(), req.query.periodo));
}

// Series de tiempo para las graficas de los paneles.
async function series(req, res) {
  res.json(await seriesDelEstablecimiento(req.usuario.establecimientoId));
}

async function alertas(req, res) {
  const { tipo, severidad, estado } = req.query;

  const registros = await prisma.alerta.findMany({
    where: {
      establecimientoId: req.usuario.establecimientoId,
      // Por omision se listan las abiertas: lo resuelto ya no pide nada.
      ...(estado ? { estado } : { estado: { not: 'resuelta' } }),
      ...(tipo ? { tipo } : {}),
      ...(severidad ? { severidad } : {}),
    },
    orderBy: [{ severidad: 'asc' }, { generadaEn: 'desc' }],
    include: { usuario: { select: { nombre: true } } },
    take: 100,
  });

  res.json({ alertas: registros });
}

/**
 * Registra que alguien ya actuo sobre una alerta.
 *
 * No la oculta: la causa sigue viva y la tarjeta debe seguir a la vista, pero
 * ahora dice quien pidio el despacho y cuando. Resolverla es cosa del proceso
 * que las genera, cuando la condicion desaparezca.
 */
async function registrarGestion(req, res, next) {
  const alerta = await prisma.alerta.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
  });

  if (!alerta) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Alerta no encontrada' });
  }

  if (alerta.estado === 'resuelta') {
    return next({
      status: 409,
      codigo: 'alerta_resuelta',
      mensaje: 'Esa alerta ya se resolvio: su causa desaparecio',
    });
  }

  const actualizada = await prisma.alerta.update({
    where: { id: alerta.id },
    data: {
      estado: 'en_gestion',
      estadoPor: req.usuario.id,
      estadoEn: new Date(),
      accion: req.body.accion,
    },
    include: { usuario: { select: { nombre: true } } },
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'alerta',
    entidadId: alerta.id,
    detalle: `Alerta puesta en gestion: ${req.body.accion}`,
  });

  res.json({ alerta: actualizada });
}

// Permite forzar la evaluacion sin esperar a la hora en punto. Util al
// revisar el sistema y despues de cargar datos.
async function recalcular(req, res) {
  const resumen = await evaluarAlertas();

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'alerta',
    detalle: 'Evaluacion de alertas ejecutada manualmente',
  });

  res.json({ resumen });
}

module.exports = { panel, series, alertas, registrarGestion, recalcular };
