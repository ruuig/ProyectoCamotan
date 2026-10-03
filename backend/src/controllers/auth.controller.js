const prisma = require('../config/db');
const { firmarToken, compararPassword, usuarioPublico } = require('../services/auth.service');
const { verificarCodigo } = require('../services/totp.service');

// Mensaje unico para toda falla de login. No se distingue entre usuario
// inexistente, usuario desactivado y contrasena incorrecta: eso permitiria
// averiguar que usuarios existen en el sistema.
const ERROR_CREDENCIALES = {
  status: 401,
  codigo: 'credenciales_invalidas',
  mensaje: 'Usuario o contrasena incorrectos',
};

async function login(req, res, next) {
  const { usuario: nombreUsuario, password } = req.body;

  const usuario = await prisma.usuario.findUnique({ where: { usuario: nombreUsuario } });

  // Se compara siempre, incluso sin usuario, para que el tiempo de respuesta
  // no delate si el usuario existe (compararPassword usa un hash senuelo).
  const passwordCorrecta = await compararPassword(password, usuario?.passwordHash);

  if (!usuario || !usuario.activo || !passwordCorrecta) {
    // Solo se puede registrar el intento si el usuario existe: bitacora exige
    // un usuarioId valido por llave foranea.
    if (usuario) {
      await req.bitacora({
        usuarioId: usuario.id,
        accion: 'login_fallido',
        entidad: 'usuario',
        entidadId: usuario.id,
        detalle: usuario.activo ? 'Contrasena incorrecta' : 'Usuario desactivado',
      });
    }
    return next(ERROR_CREDENCIALES);
  }

  // Segundo factor: solo para el rol admin, y solo si ya lo configuro.
  if (usuario.rol === 'admin' && usuario.totpSecret) {
    if (!req.body.codigoTotp) {
      // No es un fallo de credenciales: la contrasena ya fue correcta. Se
      // pide el segundo factor sin volver a preguntar por la contrasena.
      return next({
        status: 401,
        codigo: 'totp_requerido',
        mensaje: 'Ingrese el código de su aplicación de autenticación',
      });
    }

    if (!verificarCodigo(req.body.codigoTotp, usuario.totpSecret)) {
      await req.bitacora({
        usuarioId: usuario.id,
        accion: 'login_fallido',
        entidad: 'usuario',
        entidadId: usuario.id,
        detalle: 'Codigo TOTP invalido',
      });
      return next(ERROR_CREDENCIALES);
    }
  }

  const token = firmarToken(usuario);

  await req.bitacora({
    usuarioId: usuario.id,
    accion: 'login',
    entidad: 'usuario',
    entidadId: usuario.id,
  });

  res.json({ token, usuario: usuarioPublico(usuario) });
}

// Renueva el token mientras la sesion siga vigente. No usa refresh tokens
// persistidos porque el modelo de datos no contempla una tabla para ellos.
async function refresh(req, res) {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
  res.json({ token: firmarToken(usuario), usuario: usuarioPublico(usuario) });
}

// El JWT es sin estado: el cierre real ocurre cuando el cliente descarta el
// token. Aqui se deja constancia en bitacora del fin de sesion.
async function logout(req, res) {
  await req.bitacora({
    accion: 'logout',
    entidad: 'usuario',
    entidadId: req.usuario.id,
  });

  res.json({ mensaje: 'Sesión cerrada' });
}

module.exports = { login, refresh, logout };
