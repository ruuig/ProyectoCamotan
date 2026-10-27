/**
 * Piezas para escribir sobre un formulario oficial. Las medidas van en puntos
 * (1/72 de pulgada) desde la esquina superior izquierda de la página.
 * v(d, e): d son los datos de la ficha (oficial) y e el establecimiento.
 */

/** Texto en un renglón; w recorta lo que no cabe. */
export const t = (x, y, v, o = {}) => ({ tipo: 't', x, y, v, ...o });
/** Círculo del formulario marcado (relleno). */
export const m = (x, y, v) => ({ tipo: 'm', x, y, v });
/** Equis junto a una etiqueta que no tiene su propio círculo. */
export const x = (cx, cy, v) => ({ tipo: 'x', x: cx, y: cy, v });
/** Texto de varios renglones dentro de un recuadro. */
export const area = (ax, ay, w, h, v, o = {}) => ({ tipo: 'area', x: ax, y: ay, w, h, v, ...o });

/** Un carácter por casilla; v devuelve la lista de caracteres. xs: borde izquierdo de cada casilla. */
export const cajas = (xs, y, ancho, v) => xs.map((x0, i) => t(x0 + ancho / 2 - 2.8, y, (d, e) => (v(d, e) ?? [])[i] ?? '', { s: 10 }));

/** Número en casillas: enteras a la derecha y, si hay, un decimal en la última. */
export function cifras(valor, enteras, decimal = false) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  if (!decimal) return [...String(Math.round(n)).padStart(enteras, ' ')].slice(-enteras);
  const d = Math.round(n * 10);
  return [...String(Math.floor(d / 10)).padStart(enteras, ' ').slice(-enteras), String(d % 10)];
}

/** Un dígito por casilla (CUI). */
export const digitos = (x0, y, ancho, n, v) => Array.from({ length: n }, (_, i) => t(x0 + ancho * i + ancho / 2 - 2.5, y, (d, e) => String(v(d, e) ?? '').replace(/\D/g, '')[i] ?? '', { s: 9 }));

/**
 * Día, mes y año en sus casillas. local: la fecha de un momento (hora de
 * Guatemala); si no, una fecha sin hora (nacimiento), tal cual.
 */
export function partesFecha(valor, local = false) {
  if (!valor) return null;
  const f = new Date(new Date(valor).getTime() - (local ? 6 * 3600000 : 0));
  return [String(f.getUTCDate()).padStart(2, '0'), String(f.getUTCMonth() + 1).padStart(2, '0'), String(f.getUTCFullYear())];
}
export const fechaPartes = (x0, y, v, saltos, local = false) => saltos.map((dx, i) => t(x0 + dx, y, (d, e) => partesFecha(v(d, e), local)?.[i] ?? '', { s: 8 }));

export const fechaTexto = (valor) => partesFecha(valor)?.join('/') ?? '';

/** Datos de una sección de antecedentes (vacío si no se ha llenado). */
export const sec = (d, clave) => d.secciones?.[clave] ?? {};
