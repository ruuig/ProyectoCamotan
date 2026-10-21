/**
 * Cómo se reparte una requisición en hojas del FOR-ASB-01 y qué número le
 * toca a cada hoja. La misma regla está en el frontend
 * (frontend/src/dominio/hojasRequisicion.js): si se cambia una, se cambia la otra.
 *
 * Cada hoja tiene 25 renglones. Una descripción larga ocupa varios renglones
 * (caben unos 44 caracteres por renglón) y un artículo no se parte entre dos
 * hojas. El número del formulario viene impreso en cada hoja: si la
 * requisición lleva el 0156 y ocupa 4 hojas, sus números son 0156 a 0159.
 */
const RENGLONES_POR_HOJA = 25;
const CARACTERES_POR_RENGLON = 44;

/** Los renglones que ocupa una descripción, partida por palabras. */
function lineasDe(texto) {
  let lineas = 1;
  let actual = 0;
  for (const palabra of String(texto ?? '').split(/\s+/).filter(Boolean)) {
    const largo = actual ? actual + 1 + palabra.length : palabra.length;
    if (largo <= CARACTERES_POR_RENGLON || !actual) actual = largo;
    else { lineas += 1; actual = palabra.length; }
  }
  return lineas;
}

/** Cuántas hojas ocupa una lista de descripciones. */
function cantidadDeHojas(descripciones) {
  let hojas = 1;
  let usados = 0;
  for (const d of descripciones) {
    const n = lineasDe(d);
    if (usados && usados + n > RENGLONES_POR_HOJA) { hojas += 1; usados = 0; }
    usados += n;
  }
  return hojas;
}

/** Los números de las hojas a partir del primero: '0156' y 3 hojas → 0156, 0157, 0158. */
function numerosDeHojas(primero, hojas) {
  if (!primero) return [];
  const m = /^(.*?)(\d+)$/.exec(String(primero).trim());
  if (!m) return [String(primero)];
  const [, prefijo, digitos] = m;
  return Array.from({ length: hojas }, (_, i) => `${prefijo}${String(Number(digitos) + i).padStart(digitos.length, '0')}`);
}

const numerosDe = (numero, descripciones) => numerosDeHojas(numero, cantidadDeHojas(descripciones));

module.exports = { RENGLONES_POR_HOJA, CARACTERES_POR_RENGLON, lineasDe, cantidadDeHojas, numerosDeHojas, numerosDe };
