const { PrismaClient } = require('@prisma/client');

/**
 * Las columnas de fecha son TIMESTAMP sin zona horaria. Prisma escribe
 * siempre en UTC, pero los DEFAULT CURRENT_TIMESTAMP del esquema usan la hora
 * local del servidor. En Guatemala eso son 6 horas de diferencia: una fila
 * creada por SQL quedaria con una espera de 6 horas de mas en la cola.
 *
 * Fijar la sesion en UTC hace que ambas vias coincidan.
 */
function urlConUtc(url) {
  if (!url) return url;

  try {
    const direccion = new URL(url);
    if (!direccion.searchParams.has('options')) {
      direccion.searchParams.set('options', '-c timezone=UTC');
    }
    return direccion.toString();
  } catch {
    // Si la cadena no se puede analizar se deja como esta: fallar aqui
    // impediria arrancar por un detalle de formato.
    return url;
  }
}

const prisma = new PrismaClient({
  datasources: { db: { url: urlConUtc(process.env.DATABASE_URL) } },
});

module.exports = prisma;
module.exports.urlConUtc = urlConUtc;
