const ROLES = ['admin', 'preconsulta', 'medico', 'farmacia', 'bodega', 'servicio'];
const LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

// Se usa despues de autenticar. Recibe los roles con permiso sobre el endpoint.
//
// El administrador (director) ve todo, pero solo cambia lo que es suyo: en una
// ruta que comparte con otros roles (preconsulta, consulta, farmacia, bodega)
// solo puede leer. Para dejarlo escribir en una ruta compartida, se usa
// autorizar.conAdmin(...).
function crear(rolesPermitidos, adminEscribe) {
  const desconocido = rolesPermitidos.find((rol) => !ROLES.includes(rol));
  if (desconocido) {
    throw new Error(`Rol desconocido en la definicion de la ruta: ${desconocido}`);
  }
  const compartida = rolesPermitidos.some((rol) => rol !== 'admin');

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

    if (req.usuario.rol === 'admin' && compartida && !adminEscribe && !LECTURA.has(req.method)) {
      return next({
        status: 403,
        codigo: 'solo_lectura',
        mensaje: 'El administrador solo consulta en este módulo',
      });
    }

    next();
  };
}

function autorizar(...rolesPermitidos) {
  return crear(rolesPermitidos, false);
}

/** Ruta compartida en la que el administrador también escribe. */
autorizar.conAdmin = (...rolesPermitidos) => crear(rolesPermitidos, true);

module.exports = autorizar;
module.exports.ROLES = ROLES;
