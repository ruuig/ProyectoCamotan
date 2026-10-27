const prisma = require('../config/db');
const { verificarToken, usuarioPublico } = require('../services/auth.service');

async function autenticar(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const [esquema, token] = encabezado.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return next({
      status: 401,
      codigo: 'no_autenticado',
      mensaje: 'Falta el token de acceso',
    });
  }

  let carga;
  try {
    carga = verificarToken(token);
  } catch (error) {
    const expirado = error.name === 'TokenExpiredError';
    return next({
      status: 401,
      codigo: expirado ? 'sesion_expirada' : 'token_invalido',
      mensaje: expirado ? 'La sesion expiro, vuelva a iniciar sesion' : 'Token invalido',
    });
  }

  // Se relee el usuario en cada peticion a proposito: si el director desactiva
  // a alguien, su token vigente debe dejar de servir de inmediato y no seguir
  // valido hasta que expire.
  const usuario = await prisma.usuario.findUnique({ where: { id: carga.sub }, include: { ubicacion: { select: { territorioId: true } } } });

  if (!usuario || !usuario.activo) {
    return next({
      status: 401,
      codigo: 'no_autenticado',
      mensaje: 'La sesión ya no es valida',
    });
  }

  // El territorio de su centro o puesto: el encargado pide por todos sus lugares.
  req.usuario = { ...usuarioPublico(usuario), territorioId: usuario.ubicacion?.territorioId ?? null };
  next();
}

module.exports = autenticar;
