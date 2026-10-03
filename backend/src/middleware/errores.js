// Formato uniforme de error exigido por la seccion API REST:
// { error: { codigo, mensaje, detalles } }
function manejarErrores(err, req, res, next) {
  // express.json() rechaza cuerpos malformados con su propio error.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { codigo: 'json_invalido', mensaje: 'El cuerpo de la peticion no es JSON valido', detalles: null },
    });
  }

  const status = err.status || 500;

  // Los errores 5xx se registran completos en consola, pero nunca se devuelven
  // al cliente: podrian exponer detalles internos de la base de datos.
  if (status >= 500) {
    console.error(err);
    return res.status(status).json({
      error: { codigo: 'error_interno', mensaje: 'Error interno del servidor', detalles: null },
    });
  }

  res.status(status).json({
    error: {
      codigo: err.codigo || 'error',
      mensaje: err.mensaje || err.message || 'Solicitud invalida',
      detalles: err.detalles || null,
    },
  });
}

module.exports = manejarErrores;
