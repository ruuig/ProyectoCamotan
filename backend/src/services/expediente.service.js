// Generacion del numero de expediente.
//
// El numero lo da el sistema, no la persona que registra: es un correlativo
// por establecimiento y anio, legible y sin sufijos al azar (2026-00123).

const prisma = require('../config/db');

const DIGITOS = 5;

/**
 * Arma el numero a partir del anio y la posicion. Funcion pura, para poder
 * probar el formato sin tocar la base.
 */
function formatearExpediente(anio, correlativo) {
  return `${anio}-${String(correlativo).padStart(DIGITOS, '0')}`;
}

/**
 * Lee el anio y la posicion de un expediente con el formato nuevo.
 * Devuelve null si el texto no tiene ese formato (por ejemplo, uno de papel).
 */
function leerExpediente(texto) {
  const coincide = /^(\d{4})-(\d{5})$/.exec(String(texto ?? '').trim());
  if (!coincide) return null;
  return { anio: Number(coincide[1]), correlativo: Number(coincide[2]) };
}

/**
 * Se asegura de que exista la fila del contador.
 *
 * Va fuera de la transaccion a proposito: en PostgreSQL un error dentro de una
 * transaccion la invalida entera, y aqui el choque por clave duplicada es
 * esperable cuando dos registros del mismo dia entran a la vez.
 */
async function asegurarContador(establecimientoId, anio) {
  try {
    await prisma.correlativoExpediente.create({
      data: { establecimientoId, anio, ultimo: 0 },
    });
  } catch (error) {
    // P2002: otro proceso la creo primero. Es justo lo que se queria.
    if (error.code !== 'P2002') throw error;
  }
}

/**
 * Toma el siguiente numero dentro de la transaccion recibida.
 *
 * El incremento se hace en el propio UPDATE, asi que la fila queda bloqueada
 * hasta que la transaccion termina: dos registros simultaneos se serializan y
 * no pueden obtener el mismo numero.
 */
async function siguienteExpediente(tx, establecimientoId, ahora = new Date()) {
  const anio = ahora.getUTCFullYear();

  const fila = await tx.correlativoExpediente.update({
    where: { establecimientoId_anio: { establecimientoId, anio } },
    data: { ultimo: { increment: 1 } },
  });

  return formatearExpediente(anio, fila.ultimo);
}

module.exports = {
  DIGITOS,
  formatearExpediente,
  leerExpediente,
  asegurarContador,
  siguienteExpediente,
};
