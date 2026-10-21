// Valida con Zod en el servidor antes de llegar al controlador.
// Reemplaza req[origen] por el dato ya parseado y normalizado.
const { z } = require('zod');

// Mensajes en español para lo que no trae mensaje propio en el esquema.
z.setErrorMap((problema, ctx) => {
  switch (problema.code) {
    case 'invalid_type':
      return { message: problema.received === 'undefined' || problema.received === 'null' ? 'Falta este dato' : 'El dato no tiene el formato correcto' };
    case 'too_small':
      return { message: problema.type === 'string' ? `Debe tener al menos ${problema.minimum} caracteres` : problema.type === 'array' ? `Debe tener al menos ${problema.minimum}` : `Debe ser mayor o igual a ${problema.minimum}` };
    case 'too_big':
      return { message: problema.type === 'string' ? `Debe tener como máximo ${problema.maximum} caracteres` : problema.type === 'array' ? `No puede tener más de ${problema.maximum}` : `Debe ser menor o igual a ${problema.maximum}` };
    case 'invalid_enum_value':
      return { message: 'Elija una de las opciones' };
    case 'invalid_string':
      return { message: 'El dato no tiene el formato correcto' };
    default:
      return { message: ctx.defaultError };
  }
});

/** El renglón y el campo en palabras: «renglones.12.cantidad» → «renglón 13, cantidad». */
function dondeEs(ruta) {
  return ruta.map((p, i) => (typeof p === 'number' ? `${ruta[i - 1] === 'renglones' ? 'renglón' : 'elemento'} ${p + 1}` : p))
    .filter((p) => p !== 'renglones')
    .join(', ');
}

function validar(esquema, origen = 'body') {
  return (req, res, next) => {
    const resultado = esquema.safeParse(req[origen]);

    if (!resultado.success) {
      return next({
        status: 400,
        codigo: 'validacion',
        // El primer problema, dicho con dónde está, para que se pueda corregir.
        mensaje: (() => {
          const p = resultado.error.issues[0];
          const donde = dondeEs(p.path);
          return donde ? `${p.message} (${donde})` : p.message;
        })(),
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
