const ROLES = ['admin', 'preconsulta', 'medico', 'farmacia', 'bodega', 'servicio'];

// Se usa despues de autenticar. Recibe los roles con permiso sobre el endpoint.
function autorizar(...rolesPermitidos) {
  const desconocido = rolesPermitidos.find((rol) => !ROLES.includes(rol));
  if (desconocido) {
    throw new Error(`Rol desconocido en la definicion de la ruta: ${desconocido}`);
  }

  return (req, res, next) => {
    if (!req.usuario) {
      return next({
        status: 401,
        codigo: 'no_autenticado',
        mensaje: 'Debe iniciar sesión',
      });
    }

    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return next({
        status: 403,
        codigo: 'sin_permiso',
        mensaje: 'No tiene permiso para esta operación',
      });
    }

    next();
  };
}

module.exports = autorizar;
module.exports.ROLES = ROLES;
