// Valida con Zod en el servidor antes de llegar al controlador.
// Reemplaza req[origen] por el dato ya parseado y normalizado.
function validar(esquema, origen = 'body') {
  return (req, res, next) => {
    const resultado = esquema.safeParse(req[origen]);

    if (!resultado.success) {
      return next({
        status: 400,
        codigo: 'validacion',
        mensaje: 'Los datos enviados no son validos',
        detalles: resultado.error.issues.map((problema) => ({
          campo: problema.path.join('.'),
          mensaje: problema.message,
        })),
      });
    }

    req[origen] = resultado.data;
    next();
  };
}

module.exports = validar;
