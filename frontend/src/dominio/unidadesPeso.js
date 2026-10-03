/**
 * Conversión de peso entre libras y kilogramos, para el momento de capturar.
 *
 * Las básculas del centro no son todas de la misma unidad: el formulario
 * oficial de niñez trae casillas separadas de «Peso (Kg)» y «Peso (Lb)». Sin
 * esto, quien pesa en libras tiene que convertir de cabeza con la fila
 * esperando, y ahí es donde aparecen los errores de un factor de diez.
 *
 * Esto sirve solo para mostrar el número mientras se escribe. **La conversión
 * que cuenta la hace el servidor**: la pantalla manda el número tal como se
 * escribió junto con su unidad, y el valor que se guarda lo calcula el
 * backend. Así lo que queda en el expediente no depende de que el navegador
 * haya calculado bien.
 */

// Factor exacto de la libra avoirdupois, el mismo que usa el servidor.
export const KG_POR_LIBRA = 0.45359237;

// En kilogramos importa el gramo en un recién nacido; en libras, la décima.
const DECIMALES = { kg: 2, lb: 1 };

export const UNIDADES = [
  { valor: 'kg', etiqueta: 'kg' },
  { valor: 'lb', etiqueta: 'lb' },
];

/** La otra unidad, para el botón que alterna. */
export function alternar(unidad) {
  return unidad === 'lb' ? 'kg' : 'lb';
}

export function redondear(valor, unidad = 'kg') {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return Number(numero.toFixed(DECIMALES[unidad] ?? 2));
}

/**
 * Convierte lo que ya está escrito al cambiar de unidad.
 *
 * Escribió 63 en libras, toca el botón y debe ver 28.58 en kilogramos. El
 * campo no se limpia: volver a pesar al paciente para recuperar un número que
 * ya se tenía es inaceptable.
 */
export function convertir(valor, desde, hacia) {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  if (desde === hacia) return numero;

  const enKilogramos = desde === 'lb' ? numero * KG_POR_LIBRA : numero;
  const destino = hacia === 'lb' ? enKilogramos / KG_POR_LIBRA : enKilogramos;
  return redondear(destino, hacia);
}

/** La equivalencia, para poder verificar lo que se va a guardar. */
export function equivalencia(valor, unidad) {
  if (valor === null || valor === undefined || valor === '') return '';
  const otra = alternar(unidad);
  const convertido = convertir(valor, unidad, otra);
  return convertido === '' ? '' : `${convertido} ${otra}`;
}

// --- Unidad recordada en este dispositivo ---------------------------------

const CLAVE = 'camotan_unidad_peso';

/**
 * El sistema recuerda la última unidad usada en esta tablet y la propone de
 * entrada en el siguiente paciente. Si volviera a kilogramos cada vez, quien
 * trabaja con una báscula de libras tendría que tocar el botón en cada
 * paciente del día.
 */
export function unidadRecordada() {
  try {
    const guardada = localStorage.getItem(CLAVE);
    return guardada === 'lb' || guardada === 'kg' ? guardada : 'kg';
  } catch {
    // En modo privado o con el almacenamiento bloqueado se usa el valor
    // por omisión: perder la preferencia no debe romper la captura.
    return 'kg';
  }
}

export function recordarUnidad(unidad) {
  try {
    localStorage.setItem(CLAVE, unidad);
  } catch {
    // Sin almacenamiento la unidad simplemente no se recuerda.
  }
}
