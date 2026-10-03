const prisma = require('../config/db');

function obtenerIp(req) {
  const reenviada = req.headers['x-forwarded-for'];
  if (reenviada) return String(reenviada).split(',')[0].trim();
  return req.ip || null;
}

async function registrar({ usuarioId, accion, entidad, entidadId = null, ip = null, detalle = null }) {
  await prisma.bitacora.create({
    data: { usuarioId, accion, entidad, entidadId, ip, detalle },
  });
}

// Expone req.bitacora() para que cada controlador registre su operacion.
// El usuarioId sale de la sesion salvo que se indique otro explicitamente
// (necesario al registrar un intento de login, donde aun no hay sesion).
function bitacora(req, res, next) {
  req.bitacora = (datos) =>
    registrar({
      usuarioId: datos.usuarioId ?? req.usuario?.id,
      ip: obtenerIp(req),
      ...datos,
    });
  next();
}

module.exports = bitacora;
module.exports.registrar = registrar;
module.exports.obtenerIp = obtenerIp;
