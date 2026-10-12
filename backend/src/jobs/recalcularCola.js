const prisma = require('../config/db');
const { ordenarCola } = require('../services/priorizacion.service');
const { INCLUIR_PACIENTE } = require('../services/cola.service');
const { parametros } = require('../services/parametrosPriorizacion.service');
const { buscarClinicaLibre, sincronizarDisponibilidad } = require('../services/clinicas.service');

const INTERVALO_MS = 5 * 60 * 1000;

/**
 * Asigna la clinica libre al paciente de mayor prioridad.
 *
 * No hace UPDATE masivo de puntajes: el puntaje se calcula al leer la cola.
 * Aqui solo se persiste cuando cambia el estado, que es lo unico que la
 * lectura no puede derivar sola.
 */
async function asignarClinicaLibre(establecimientoId, ahora = new Date()) {
  // La disponibilidad se deriva de los hechos, no del campo `disponible`.
  const clinica = await buscarClinicaLibre(establecimientoId);
  if (!clinica) return null;

  const enEspera = await prisma.atencion.findMany({
    where: { establecimientoId, estado: 'en_espera' },
    include: INCLUIR_PACIENTE,
  });

  const { puntos } = await parametros(establecimientoId);
  const siguiente = ordenarCola(enEspera, ahora, puntos)[0];
  if (!siguiente) return null;

  // Se persiste el puntaje solo en este momento, junto al cambio de estado.
  try {
    return await prisma.$transaction(async (tx) => {
      const atencion = await tx.atencion.update({
        where: { id: siguiente.atencion.id },
        data: {
          estado: 'en_atencion',
          clinicaId: clinica.id,
          puntaje: siguiente.puntaje,
          llamadaEn: ahora,
          iniciadaEn: ahora,
        },
      });
      await sincronizarDisponibilidad(establecimientoId, tx);
      return atencion;
    });
  } catch (error) {
    // Alguien llamo al paciente entre la lectura y la escritura: el job
    // no tiene a quien avisar, simplemente no hace nada esta vuelta.
    if (error.code === 'P2002') return null;
    throw error;
  }
}

async function ejecutar(ahora = new Date()) {
  const establecimientos = await prisma.establecimiento.findMany({
    where: { activo: true },
    select: { id: true },
  });

  const asignadas = [];
  for (const { id } of establecimientos) {
    const atencion = await asignarClinicaLibre(id, ahora);
    if (atencion) asignadas.push(atencion.id);
  }

  return asignadas;
}

let temporizador = null;

function iniciar(intervaloMs = INTERVALO_MS) {
  if (temporizador) return temporizador;

  temporizador = setInterval(() => {
    ejecutar().catch((error) => console.error('Fallo recalcularCola:', error));
  }, intervaloMs);

  // No debe impedir que el proceso termine.
  temporizador.unref?.();
  return temporizador;
}

function detener() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}

module.exports = { INTERVALO_MS, asignarClinicaLibre, ejecutar, iniciar, detener };
