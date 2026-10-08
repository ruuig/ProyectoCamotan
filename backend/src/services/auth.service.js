const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { jwtSecret, jwtExpiracion } = require('../config/env');

const COSTO_BCRYPT = 12;

// Hash de descarte. Cuando el usuario no existe se compara igual contra este
// valor, para que la respuesta tarde lo mismo que con un usuario real y no se
// pueda averiguar que usuarios existen midiendo el tiempo de respuesta.
const HASH_SENUELO = bcrypt.hashSync('usuario-inexistente', COSTO_BCRYPT);

function firmarToken(usuario) {
  return jwt.sign(
    {
      sub: usuario.id,
      rol: usuario.rol,
      establecimientoId: usuario.establecimientoId,
      esDirector: usuario.esDirector,
    },
    jwtSecret,
    { expiresIn: jwtExpiracion },
  );
}

function verificarToken(token) {
  return jwt.verify(token, jwtSecret);
}

function hashearPassword(password) {
  return bcrypt.hash(password, COSTO_BCRYPT);
}

function compararPassword(password, hash) {
  return bcrypt.compare(password, hash ?? HASH_SENUELO);
}

// Datos del usuario que si pueden viajar al cliente.
// Nunca incluye passwordHash ni totpSecret.
function usuarioPublico(usuario) {
  return {
    id: usuario.id,
    usuario: usuario.usuario,
    nombre: usuario.nombre,
    rol: usuario.rol,
    cargo: usuario.cargo ?? null,
    esDirector: usuario.esDirector,
    activo: usuario.activo,
    establecimientoId: usuario.establecimientoId,
  };
}

module.exports = {
  COSTO_BCRYPT,
  HASH_SENUELO,
  firmarToken,
  verificarToken,
  hashearPassword,
  compararPassword,
  usuarioPublico,
};
