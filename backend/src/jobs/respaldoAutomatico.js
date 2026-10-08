const prisma = require('../config/db');
const respaldo = require('../services/respaldo.service');

// Se revisa a menudo para no pasarse mucho de la hora configurada; el
// respaldo solo se hace cuando toca (ver tocaRespaldo).
const INTERVALO_MS = 10 * 60 * 1000;

async function ejecutar(ahora = new Date()) {
  const config = await prisma.configuracionRespaldo.findUnique({ where: { id: 1 } });
  if (!respaldo.tocaRespaldo(config, ahora)) return null;

  // El intento se anota antes de empezar: si el servidor se reinicia a
  // medias, no se vuelve a lanzar en cada arranque.
  await prisma.configuracionRespaldo.update({ where: { id: 1 }, data: { ultimoIntentoEn: ahora } });

  try {
    const nombre = await respaldo.crearRespaldo('automatico');
    await respaldo.aplicarConservacion(config.conservar);
    await prisma.configuracionRespaldo.update({ where: { id: 1 }, data: { ultimoError: null } });
    return nombre;
  } catch (error) {
    console.error('Fallo el respaldo automatico:', error.message);
    await prisma.configuracionRespaldo.update({ where: { id: 1 }, data: { ultimoError: error.message.slice(0, 500) } });
    return null;
  }
}

let temporizador = null;

function iniciar(intervaloMs = INTERVALO_MS) {
  if (temporizador) return temporizador;

  ejecutar().catch((error) => console.error('Fallo respaldoAutomatico inicial:', error));

  temporizador = setInterval(() => {
    ejecutar().catch((error) => console.error('Fallo respaldoAutomatico:', error));
  }, intervaloMs);

  temporizador.unref?.();
  return temporizador;
}

function detener() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}

module.exports = { INTERVALO_MS, ejecutar, iniciar, detener };
