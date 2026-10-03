/**
 * Conversion de peso entre libras y kilogramos.
 *
 * Las basculas del centro no son todas de la misma unidad: el formulario
 * oficial de ninez trae casillas separadas de "Peso (Kg)" y "Peso (Lb)". Si
 * el sistema solo aceptara kilogramos, quien pesa en libras tendria que
 * convertir de cabeza con la fila esperando, y ahi es donde aparecen los
 * errores de un factor de diez.
 *
 * Internamente el peso SIEMPRE se guarda en kilogramos. La unidad es solo la
 * forma de capturarlo.
 */

// Factor exacto de la libra avoirdupois. No se redondea aqui: redondear el
// factor arrastra error a todos los calculos de puntaje Z.
const KG_POR_LIBRA = 0.45359237;

const UNIDADES = ['kg', 'lb'];

// Decimales con los que se muestra cada unidad. En kilogramos importa el
// gramo en un recien nacido; en libras, la decima basta.
const DECIMALES = { kg: 2, lb: 1 };

function esUnidadValida(unidad) {
  return UNIDADES.includes(unidad);
}

/** Libras a kilogramos. */
function aKilogramos(valor, unidad = 'kg') {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return unidad === 'lb' ? numero * KG_POR_LIBRA : numero;
}

/** Kilogramos a la unidad que se quiere mostrar. */
function desdeKilogramos(kilogramos, unidad = 'kg') {
  if (kilogramos === null || kilogramos === undefined || kilogramos === '') return null;
  const numero = Number(kilogramos);
  if (!Number.isFinite(numero)) return null;
  return unidad === 'lb' ? numero / KG_POR_LIBRA : numero;
}

/** Redondeo para mostrar, con los decimales que corresponden a la unidad. */
function redondear(valor, unidad = 'kg') {
  if (valor === null || valor === undefined) return null;
  const decimales = DECIMALES[unidad] ?? 2;
  return Number(Number(valor).toFixed(decimales));
}

/**
 * Convierte lo que ya esta escrito al cambiar de unidad.
 *
 * Es la operacion que ve el usuario: escribio 63 en libras, toca el boton, y
 * debe ver 28.58 en kilogramos. No se limpia el campo, porque volver a pesar
 * al paciente para recuperar un numero que ya se tenia es inaceptable.
 */
function convertir(valor, desde, hacia) {
  if (!esUnidadValida(desde) || !esUnidadValida(hacia)) {
    throw new Error(`Unidad de peso desconocida: ${desde} o ${hacia}`);
  }
  if (valor === null || valor === undefined || valor === '') return null;

  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  if (desde === hacia) return redondear(numero, hacia);

  return redondear(desdeKilogramos(aKilogramos(numero, desde), hacia), hacia);
}

/** La otra unidad, para el boton que alterna. */
function alternar(unidad) {
  return unidad === 'lb' ? 'kg' : 'lb';
}

/**
 * Como se lee el peso con su equivalencia.
 * "28.58 kg (63.0 lb)": quien peso en libras puede verificar lo que guardo.
 */
function describir(kilogramos, unidadCaptura = 'kg') {
  const kg = redondear(kilogramos, 'kg');
  if (kg === null) return '';
  if (unidadCaptura === 'kg') return `${kg} kg`;
  return `${kg} kg (${redondear(desdeKilogramos(kilogramos, 'lb'), 'lb')} lb)`;
}

module.exports = {
  KG_POR_LIBRA,
  UNIDADES,
  DECIMALES,
  esUnidadValida,
  aKilogramos,
  desdeKilogramos,
  redondear,
  convertir,
  alternar,
  describir,
};
