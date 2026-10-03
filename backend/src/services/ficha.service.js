// Estado de la ficha del paciente: que falta para considerarla completa.
//
// El registro se parte en dos momentos porque en preconsulta hay fila: primero
// lo minimo para poder atender, y el resto cuando haya tiempo. Para que "el
// resto" no se pierda, el sistema lleva la cuenta de lo que falta.
//
// Lo que se exige sale de la ficha oficial que corresponde a la edad del
// paciente (fichaIdentificacion.service), no de una lista propia.
//
// Funcion pura: recibe el paciente, no toca la base.

const {
  estructuraIdentificacion,
  faltantes: faltantesDe,
  tieneValor,
} = require('./fichaIdentificacion.service');

/**
 * Evalua la ficha y devuelve que falta, junto con la ficha que se uso.
 *
 * `ahora` es la fecha de la atencion: la ficha se elige por la edad a esa fecha.
 */
function evaluarFicha(paciente, ahora = new Date()) {
  const estructura = estructuraIdentificacion(paciente.fechaNacimiento, ahora);
  const faltantes = faltantesDe(paciente, estructura);
  return {
    completa: faltantes.length === 0,
    faltantes,
    nombre: estructura.ficha.nombre,
    rango: estructura.ficha.rango,
    clave: estructura.ficha.clave,
  };
}

module.exports = { tieneValor, evaluarFicha };
