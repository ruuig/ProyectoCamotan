const prisma = require('../config/db');

const ENCABEZADO = 'idempotency-key';
const LARGO_MIN = 8;
const LARGO_MAX = 200;

/**
 * Evita que el reenvio de una operacion desde la cola offline duplique
 * registros.
 *
 * El cliente genera una clave por operacion y la repite en cada reintento.
 * Si la clave ya se proceso, se devuelve la respuesta guardada en lugar de
 * volver a escribir en la base.
 *
 * La clave es opcional: sin ella la peticion sigue su curso normal.
 */
function idempotencia(req, res, next) {
  const clave = req.headers[ENCABEZADO];

  if (!clave) return next();

  if (typeof clave !== 'string' || clave.length < LARGO_MIN || clave.length > LARGO_MAX) {
    return next({
      status: 400,
      codigo: 'clave_idempotencia_invalida',
      mensaje: `El encabezado ${ENCABEZADO} debe tener entre ${LARGO_MIN} y ${LARGO_MAX} caracteres`,
    });
  }

  prisma.operacionIdempotente
    .findUnique({ where: { clave } })
    .then((previa) => {
      if (previa) {
        // Ya se proceso: se devuelve lo mismo, sin repetir la escritura.
        res.setHeader('X-Idempotencia', 'repetida');
        return res.status(200).json(previa.respuesta);
      }

      // Se intercepta la respuesta para guardarla solo si todo salio bien.
      const jsonOriginal = res.json.bind(res);

      // La clave se guarda ANTES de responder. Si se respondiera primero, un
      // reintento que llega enseguida (la cola offline al volver la red) no
      // encontraria la clave y chocaria con el registro ya hecho.
      res.json = (cuerpo) => {
        if (res.statusCode < 200 || res.statusCode >= 300) return jsonOriginal(cuerpo);

        prisma.operacionIdempotente
          .create({
            data: {
              clave,
              usuarioId: req.usuario?.id ?? null,
              endpoint: `${req.method} ${req.originalUrl}`,
              respuesta: cuerpo,
            },
          })
          .catch((error) => {
            // Una carrera entre dos reenvios simultaneos deja la clave ya
            // creada: no es un fallo que deba romper la respuesta.
            if (error.code !== 'P2002') {
              console.error('No se pudo registrar la idempotencia:', error.message);
            }
          })
          .finally(() => jsonOriginal(cuerpo));
        return res;
      };

      return next();
    })
    .catch(next);
}

module.exports = idempotencia;
module.exports.ENCABEZADO = ENCABEZADO;
