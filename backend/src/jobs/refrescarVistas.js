const prisma = require('../config/db');

// Unico lugar del sistema con SQL crudo, junto al script que las crea.
// Las vistas materializadas no son modelos de Prisma, asi que no hay otra
// forma de refrescarlas. CONCURRENTLY es posible porque cada una tiene su
// indice unico, y permite refrescar sin bloquear las lecturas del panel.
const VISTAS = ['consumo_diario', 'saldo_insumo', 'cobertura_comunidad'];

const INTERVALO_MS = 60 * 60 * 1000; // cada hora

async function refrescar(vista) {
  // El nombre de una vista no puede ir como parametro en SQL, asi que se
  // interpola. Para que eso nunca sea una via de inyeccion, solo se aceptan
  // los nombres de esta lista: cualquier otro se rechaza aqui mismo.
  if (!VISTAS.includes(vista)) {
    throw new Error(`Vista no permitida: ${vista}`);
  }

  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${vista}`);
}

async function ejecutar() {
  const resultados = [];

  for (const vista of VISTAS) {
    try {
      await refrescar(vista);
      resultados.push({ vista, ok: true });
    } catch (error) {
      // Una vista que falle no debe impedir el refresco de las demas.
      console.error(`No se pudo refrescar ${vista}:`, error.message);
      resultados.push({ vista, ok: false, error: error.message });
    }
  }

  return resultados;
}

let temporizador = null;

function iniciar(intervaloMs = INTERVALO_MS) {
  if (temporizador) return temporizador;

  ejecutar().catch((error) => console.error('Fallo refrescarVistas inicial:', error));

  temporizador = setInterval(() => {
    ejecutar().catch((error) => console.error('Fallo refrescarVistas:', error));
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

module.exports = { VISTAS, INTERVALO_MS, refrescar, ejecutar, iniciar, detener };
