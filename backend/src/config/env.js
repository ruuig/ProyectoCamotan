require('dotenv').config();

function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}`);
  }
  return valor;
}

module.exports = {
  puerto: process.env.PORT || 3000,
  databaseUrl: requerida('DATABASE_URL'),
  jwtSecret: process.env.NODE_ENV === 'test' ? (process.env.JWT_SECRET || 'secreto_pruebas') : requerida('JWT_SECRET'),
  jwtExpiracion: '8h',
};
