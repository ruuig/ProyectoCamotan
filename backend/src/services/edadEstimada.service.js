// Edad aproximada para quien no conoce su fecha de nacimiento.
//
// En el area rural hay pacientes que no la saben. El SIGSA acepta la edad en
// dias (menores de un mes), meses (menores de un año) o años. El sistema
// calcula una fecha aproximada para poder seguir la edad en el tiempo, y deja
// marcado que es estimada: todo lo que dependa de ella se muestra con esa
// advertencia, incluidos los puntajes Z.
//
// Funciones puras.

const MS_POR_DIA = 86400000;

const UNIDADES = ['dias', 'meses', 'anios'];

/**
 * Fecha de nacimiento aproximada a partir de una edad declarada.
 *
 * Se toma el dia de hoy menos la edad. No se inventa precision: si alguien
 * dice "como 40 años", la fecha resultante sirve para calcular la edad mas
 * adelante, no para afirmar el dia en que nacio.
 */
function fechaDesdeEdad(valor, unidad, ahora = new Date()) {
  if (!UNIDADES.includes(unidad)) return null;
  if (!Number.isFinite(valor) || valor < 0) return null;

  const base = new Date(ahora);

  if (unidad === 'dias') {
    return new Date(base.getTime() - valor * MS_POR_DIA);
  }

  const fecha = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));

  if (unidad === 'meses') {
    fecha.setUTCMonth(fecha.getUTCMonth() - valor);
  } else {
    fecha.setUTCFullYear(fecha.getUTCFullYear() - valor);
  }

  return fecha;
}

/**
 * Valida que la edad declarada tenga sentido en su unidad.
 *
 * Los cortes son los del propio SIGSA: los dias se usan en menores de un mes
 * y los meses en menores de un año. Si alguien escribe 40 en dias, es que se
 * equivoco de unidad.
 */
function validarEdadDeclarada(valor, unidad) {
  if (!UNIDADES.includes(unidad)) {
    return { valida: false, mensaje: 'La unidad debe ser días, meses o años' };
  }

  if (!Number.isInteger(valor) || valor < 0) {
    return { valida: false, mensaje: 'La edad debe ser un número entero' };
  }

  if (unidad === 'dias' && valor > 31) {
    return {
      valida: false,
      mensaje: 'Los días se usan en menores de un mes. Para más edad use meses o años',
    };
  }

  if (unidad === 'meses' && valor > 23) {
    return {
      valida: false,
      mensaje: 'Los meses se usan en menores de dos años. Para más edad use años',
    };
  }

  if (unidad === 'anios' && valor > 120) {
    return { valida: false, mensaje: 'La edad supera lo posible en una persona' };
  }

  return { valida: true, mensaje: null };
}

/**
 * Texto de la edad para mostrarla, con la marca de aproximada cuando aplica.
 */
function edadLegible({ anios, meses, dias }, estimada = false) {
  const marca = estimada ? ' (aproximada)' : '';

  if (anios >= 1) {
    const texto = anios === 1 ? '1 año' : `${anios} años`;
    return meses > 0 ? `${texto} ${meses} meses${marca}` : `${texto}${marca}`;
  }

  if (meses >= 1) return `${meses} ${meses === 1 ? 'mes' : 'meses'}${marca}`;
  return `${dias} ${dias === 1 ? 'día' : 'días'}${marca}`;
}

module.exports = {
  UNIDADES,
  fechaDesdeEdad,
  validarEdadDeclarada,
  edadLegible,
};
