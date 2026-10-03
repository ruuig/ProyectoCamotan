// Express 4 no propaga rechazos de promesas al manejador de errores.
// Este envoltorio evita repetir try/catch en cada controlador.
const asincrono = (manejador) => (req, res, next) =>
  Promise.resolve(manejador(req, res, next)).catch(next);

module.exports = asincrono;
