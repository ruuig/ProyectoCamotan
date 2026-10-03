const prisma = require('../config/db');
const {
  fechaProbableParto,
  describirEpisodio,
  debeVencerse,
  SEMANAS_MAXIMAS,
} = require('../services/embarazo.service');

async function buscarPaciente(req) {
  return prisma.paciente.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
  });
}

/**
 * Abre un episodio de embarazo.
 *
 * Se abre desde preconsulta cuando se sospecha o se confirma. Mientras este
 * activo, la paciente recibe el peso de prioridad por embarazo en la cola.
 */
async function abrir(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  if (paciente.sexo !== 'F') {
    return next({
      status: 400,
      codigo: 'sexo_invalido',
      mensaje: 'Solo se registra embarazo en pacientes de sexo femenino',
    });
  }

  const activo = await prisma.episodioEmbarazo.findFirst({
    where: { pacienteId: paciente.id, estado: 'activo' },
  });

  if (activo) {
    return next({
      status: 409,
      codigo: 'embarazo_activo',
      mensaje: 'Esta paciente ya tiene un embarazo activo. Ciérrelo antes de abrir otro',
    });
  }

  const { fechaUltimaRegla, semanasAlRegistrar } = req.body;

  const episodio = await prisma.episodioEmbarazo.create({
    data: {
      pacienteId: paciente.id,
      fechaUltimaRegla: fechaUltimaRegla ?? null,
      semanasAlRegistrar: semanasAlRegistrar ?? null,
      fechaProbableParto: fechaProbableParto(fechaUltimaRegla),
    },
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'episodio_embarazo',
    entidadId: episodio.id,
    detalle: `Embarazo abierto para el paciente ${paciente.expediente}`,
  });

  res.status(201).json({ embarazo: describirEpisodio(episodio) });
}

/**
 * Cierra el episodio: parto, perdida o lo que corresponda.
 */
async function cerrar(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const activo = await prisma.episodioEmbarazo.findFirst({
    where: { pacienteId: paciente.id, estado: 'activo' },
  });

  if (!activo) {
    return next({
      status: 404,
      codigo: 'sin_embarazo_activo',
      mensaje: 'Esta paciente no tiene un embarazo activo',
    });
  }

  const cerrado = await prisma.episodioEmbarazo.update({
    where: { id: activo.id },
    data: { estado: 'finalizado', cerradoEn: new Date(), motivoCierre: req.body.motivo },
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'episodio_embarazo',
    entidadId: cerrado.id,
    detalle: `Embarazo cerrado. Motivo: ${req.body.motivo}`,
  });

  res.json({ embarazo: describirEpisodio(cerrado) });
}

/**
 * Historial de embarazos del paciente.
 */
async function listar(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const episodios = await prisma.episodioEmbarazo.findMany({
    where: { pacienteId: paciente.id },
    orderBy: { abiertoEn: 'desc' },
  });

  res.json({ embarazos: episodios.map((e) => describirEpisodio(e)) });
}

/**
 * Cierra solos los episodios que pasaron las 42 semanas.
 *
 * A esa altura o ya hubo parto y no se registro, o la paciente dejo de
 * asistir. En ninguno de los dos casos corresponde seguir dando prioridad.
 */
async function vencerEpisodios(ahora = new Date()) {
  const activos = await prisma.episodioEmbarazo.findMany({ where: { estado: 'activo' } });
  const vencidos = activos.filter((e) => debeVencerse(e, ahora));

  if (vencidos.length === 0) return { vencidos: 0 };

  await prisma.episodioEmbarazo.updateMany({
    where: { id: { in: vencidos.map((e) => e.id) } },
    data: {
      estado: 'finalizado',
      cerradoEn: ahora,
      motivoCierre: `Vencido solo al superar las ${SEMANAS_MAXIMAS} semanas`,
    },
  });

  return { vencidos: vencidos.length };
}

module.exports = { abrir, cerrar, listar, vencerEpisodios };
