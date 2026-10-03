const prisma = require('../config/db');
const { obtenerCola, resumenDelDia, INCLUIR_PACIENTE } = require('../services/cola.service');
const { puntajeDeAtencion, MAX_AUSENCIAS, mismaJornada } = require('../services/priorizacion.service');
const { alertasDeAtencion } = require('../services/alertasClinicas.service');
const { asignarClinicaLibre } = require('../jobs/recalcularCola');
const { buscarClinicaLibre, sincronizarDisponibilidad } = require('../services/clinicas.service');

async function cola(req, res) {
  const datos = await obtenerCola(req.usuario.establecimientoId);
  res.json(datos);
}

async function resumenDia(req, res) {
  res.json(await resumenDelDia(req.usuario.establecimientoId));
}

// Transiciones permitidas. Cualquier otra se rechaza.
const TRANSICIONES = {
  en_espera: ['en_atencion', 'ausente'],
  en_atencion: ['ausente', 'en_espera'],
  ausente: ['en_espera'],
  atendido: [],
};

async function cambiarEstado(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { estado: destino, motivo } = req.body;
  const ahora = new Date();

  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId },
    include: { clinica: true },
  });

  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  if (!TRANSICIONES[atencion.estado]?.includes(destino)) {
    return next({
      status: 409,
      codigo: 'transicion_invalida',
      mensaje: `No se puede pasar de ${atencion.estado} a ${destino}`,
    });
  }

  let datos = {};
  let mensaje = null;

  if (destino === 'en_atencion') {
    // Se busca una clinica libre de verdad, no una marcada como disponible.
    const clinica = await buscarClinicaLibre(establecimientoId);

    if (!clinica) {
      return next({
        status: 409,
        codigo: 'sin_clinica',
        mensaje: 'No hay clínica disponible en este momento',
      });
    }

    datos = {
      estado: 'en_atencion',
      clinicaId: clinica.id,
      puntaje: puntajeDeAtencion(
        await prisma.atencion.findUnique({ where: { id: atencion.id }, include: INCLUIR_PACIENTE }),
        ahora,
      ),
      llamadaEn: atencion.llamadaEn ?? ahora,
      iniciadaEn: ahora,
    };
  }

  if (destino === 'ausente') {
    // Las ausencias se cuentan por jornada. Si la atencion viene de un dia
    // anterior, el contador arranca de nuevo.
    const base = mismaJornada(atencion.registradaEn, ahora) ? atencion.ausencias : 0;
    const ausencias = base + 1;

    datos = { estado: 'ausente', ausencias, clinicaId: null };

    mensaje =
      ausencias >= MAX_AUSENCIAS
        ? 'Segunda ausencia en la jornada. El paciente sale del sistema y debe registrarse de nuevo'
        : 'Paciente marcado ausente. Al volver, su cronometro se reinicia y pierde 10 puntos';
  }

  if (destino === 'en_espera') {
    if (atencion.estado === 'ausente' && atencion.ausencias >= MAX_AUSENCIAS) {
      return next({
        status: 409,
        codigo: 'ausencia_definitiva',
        mensaje: 'El paciente acumulo dos ausencias en la jornada. Debe registrarse de nuevo',
      });
    }

    // Vuelve a la cola con el cronometro reiniciado.
    datos = { estado: 'en_espera', clinicaId: null, reingresoEn: ahora };
  }

  let actualizada;
  try {
    actualizada = await prisma.$transaction(async (tx) => {
      const resultado = await tx.atencion.update({ where: { id: atencion.id }, data: datos });
      // El campo `disponible` se pone al dia con la ocupacion real.
      await sincronizarDisponibilidad(establecimientoId, tx);
      return resultado;
    });
  } catch (error) {
    // El indice unico parcial impide dos atenciones en la misma clinica. Si
    // alguien gano la carrera, es un conflicto de negocio, no un error interno.
    if (error.code === 'P2002') {
      return next({
        status: 409,
        codigo: 'clinica_ocupada',
        mensaje: 'Otro paciente entro a la clínica en este momento. Actualice la cola',
      });
    }
    throw error;
  }

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'atencion',
    entidadId: atencion.id,
    detalle: `Estado ${atencion.estado} a ${destino}${motivo ? `. Motivo: ${motivo}` : ''}`,
  });

  res.json({ atencion: actualizada, mensaje });
}

async function siguiente(req, res) {
  const establecimientoId = req.usuario.establecimientoId;

  // Si la clinica esta libre, entra el de mayor prioridad.
  await asignarClinicaLibre(establecimientoId);

  const atencion = await prisma.atencion.findFirst({
    where: { establecimientoId, estado: 'en_atencion' },
    include: INCLUIR_PACIENTE,
  });

  if (!atencion) {
    return res.json({ atencion: null, alertas: [], mensaje: 'No hay pacientes en atención' });
  }

  // El medico recibe al paciente con sus alertas ya calculadas.
  const { alertas } = await alertasDeAtencion(atencion);

  await req.bitacora({ accion: 'leer', entidad: 'paciente', entidadId: atencion.pacienteId });

  res.json({ atencion, alertas });
}

module.exports = { cola, resumenDia, cambiarEstado, siguiente };
