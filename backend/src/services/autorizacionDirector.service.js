const { authenticator } = require('otplib');
const prisma = require('../config/db');
const { compararPassword } = require('./auth.service');
const { registrar, obtenerIp } = require('../middleware/bitacora');

// Limite de intentos fallidos por hora, por IP.
const MAX_INTENTOS_HORA = 3;
const VENTANA_MS = 60 * 60 * 1000;

// Mensaje unico. Nunca revela si fallo el DPI, la contrasena o el codigo:
// decirlo permitiria averiguar que DPI corresponde a un director.
const MENSAJE_GENERICO = 'Credenciales de autorización inválidas';

function errorAutorizacion(status = 403, codigo = 'autorizacion_invalida', mensaje = MENSAJE_GENERICO) {
  return { status, codigo, mensaje };
}

/**
 * Cuenta los intentos fallidos recientes de esta IP.
 * Se apoya en la bitacora, que ya registra todo intento.
 */
async function intentosFallidosRecientes(ip, ahora = new Date()) {
  if (!ip) return 0;

  return prisma.bitacora.count({
    where: {
      ip,
      accion: 'autorizacion_fallida',
      registradaEn: { gte: new Date(new Date(ahora).getTime() - VENTANA_MS) },
    },
  });
}

/**
 * Verifica la autorizacion del director para una operacion protegida.
 *
 * El DPI NO es un secreto: aparece en documentos y listados. Se trata como
 * nombre de usuario. La seguridad real la da la contrasena, y el TOTP como
 * tercer factor cuando el director lo tiene configurado.
 *
 * No genera sesion ni token: sirve solo para la operacion en curso.
 */
async function verificarAutorizacion({ autorizacion, establecimientoId, usuarioSesionId, ip, operacion }) {
  const registrarIntento = (detalle) =>
    registrar({
      usuarioId: usuarioSesionId,
      accion: 'autorizacion_fallida',
      entidad: 'autorizacion',
      ip,
      detalle: `${operacion}: ${detalle}`,
    });

  // 1. Limite de intentos por IP, antes de tocar la base con comparaciones.
  const intentos = await intentosFallidosRecientes(ip);
  if (intentos >= MAX_INTENTOS_HORA) {
    await registrarIntento('bloqueado por exceso de intentos');
    throw errorAutorizacion(
      429,
      'demasiados_intentos',
      'Demasiados intentos de autorización fallidos. Intente de nuevo en una hora',
    );
  }

  if (!autorizacion?.dpi || !autorizacion?.password) {
    await registrarIntento('datos de autorización incompletos');
    throw errorAutorizacion();
  }

  // 2. Buscar un director activo con ese DPI en el mismo establecimiento.
  const director = await prisma.usuario.findFirst({
    where: {
      dpi: autorizacion.dpi,
      esDirector: true,
      activo: true,
      establecimientoId,
    },
  });

  // 3. Se compara siempre, exista o no el director, para que el tiempo de
  //    respuesta no delate que DPI pertenece a uno.
  const passwordCorrecta = await compararPassword(autorizacion.password, director?.passwordHash);

  if (!director || !passwordCorrecta) {
    await registrarIntento('credenciales incorrectas');
    throw errorAutorizacion();
  }

  // 4. TOTP como tercer factor cuando el director lo tiene configurado.
  if (director.totpSecret) {
    if (!autorizacion.totp) {
      await registrarIntento('falta el código TOTP');
      throw errorAutorizacion(403, 'totp_requerido', 'Se requiere el código de verificacion del director');
    }

    const valido = authenticator.verify({
      token: String(autorizacion.totp),
      secret: director.totpSecret,
    });

    if (!valido) {
      await registrarIntento('codigo TOTP invalido');
      throw errorAutorizacion();
    }
  }

  return director;
}

/**
 * Middleware para las rutas protegidas. Deja el director en req.director y
 * quita `autorizacion` del cuerpo para que no llegue a la capa de datos.
 */
function exigirAutorizacionDirector(operacion) {
  return async (req, res, next) => {
    try {
      const { autorizacion, ...resto } = req.body;

      req.director = await verificarAutorizacion({
        autorizacion,
        establecimientoId: req.usuario.establecimientoId,
        usuarioSesionId: req.usuario.id,
        ip: obtenerIp(req),
        operacion,
      });

      req.body = resto;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  MAX_INTENTOS_HORA,
  VENTANA_MS,
  MENSAJE_GENERICO,
  intentosFallidosRecientes,
  verificarAutorizacion,
  exigirAutorizacionDirector,
};
