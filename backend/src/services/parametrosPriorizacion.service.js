/**
 * Parametros de la prioridad del establecimiento: criterios clinicos (capa 1)
 * y puntos y tiempos (capas 2 y 3). Se guardan un momento en memoria porque
 * la cola los lee a cada rato; al cambiarlos se olvida la copia.
 */

const prisma = require('../config/db');
const { normalizarPuntos } = require('./priorizacion.service');

const VIGENCIA_MS = 30 * 1000;
const memoria = new Map();

async function parametros(establecimientoId) {
  const guardado = memoria.get(establecimientoId);
  if (guardado && Date.now() - guardado.en < VIGENCIA_MS) return guardado.valor;

  const [fila, criterios] = await Promise.all([
    prisma.parametroPriorizacion.findUnique({ where: { establecimientoId } }),
    prisma.criterioTriaje.findMany({ where: { establecimientoId, activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] }),
  ]);
  const valor = {
    puntos: normalizarPuntos(fila?.puntos),
    criterios: criterios.map((c) => ({ ...c, valor: Number(c.valor) })),
    actualizadoEn: fila?.actualizadoEn ?? null,
  };
  memoria.set(establecimientoId, { en: Date.now(), valor });
  return valor;
}

function olvidar(establecimientoId) {
  memoria.delete(establecimientoId);
}

module.exports = { parametros, olvidar };
