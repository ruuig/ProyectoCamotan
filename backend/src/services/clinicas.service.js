const prisma = require('../config/db');

/**
 * Devuelve una clinica realmente libre, o null.
 *
 * La ocupacion se deriva de los hechos: que no haya una atencion en curso
 * asignada a ella. El campo `disponible` se mantiene para mostrarlo, pero no
 * se usa para decidir, porque es estado redundante que puede quedar
 * desincronizado (un proceso interrumpido, una correccion manual) y entonces
 * el sistema intentaria asignar una clinica ocupada.
 */
async function buscarClinicaLibre(establecimientoId, cliente = prisma) {
  const clinicas = await cliente.clinica.findMany({
    where: { establecimientoId, activa: true },
    orderBy: { id: 'asc' },
  });

  if (clinicas.length === 0) return null;

  const ocupadas = await cliente.atencion.findMany({
    where: {
      clinicaId: { in: clinicas.map((c) => c.id) },
      estado: 'en_atencion',
    },
    select: { clinicaId: true },
  });

  const idsOcupadas = new Set(ocupadas.map((a) => a.clinicaId));
  return clinicas.find((c) => !idsOcupadas.has(c.id)) ?? null;
}

/**
 * Pone el campo `disponible` de acuerdo con la ocupacion real.
 * Se llama tras cada cambio de estado para que lo que se muestra coincida.
 */
async function sincronizarDisponibilidad(establecimientoId, cliente = prisma) {
  const clinicas = await cliente.clinica.findMany({
    where: { establecimientoId, activa: true },
    select: { id: true, disponible: true },
  });

  const ocupadas = await cliente.atencion.findMany({
    where: { clinicaId: { in: clinicas.map((c) => c.id) }, estado: 'en_atencion' },
    select: { clinicaId: true },
  });
  const idsOcupadas = new Set(ocupadas.map((a) => a.clinicaId));

  for (const clinica of clinicas) {
    const libre = !idsOcupadas.has(clinica.id);
    if (clinica.disponible !== libre) {
      await cliente.clinica.update({ where: { id: clinica.id }, data: { disponible: libre } });
    }
  }
}

module.exports = { buscarClinicaLibre, sincronizarDisponibilidad };
