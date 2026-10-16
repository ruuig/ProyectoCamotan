/**
 * Catálogo visual de la bodega: color y pictograma de cada categoría.
 * Los pictogramas son trazos SVG propios (viewBox 0 0 24 24).
 */
export const CATEGORIA = {
  medicamentos: {
    nombre: 'Medicamentos', corto: 'Medicamento',
    tinta: '#1F4FA8', fondo: '#E3EDFC', medio: '#3D7BE0',
    trazo: 'M8.5 3.5a5 5 0 0 1 7 7l-5 5a5 5 0 0 1-7-7l5-5Z M6 11l7 7',
  },
  suplementos: {
    nombre: 'Suplementos', corto: 'Suplemento',
    tinta: '#B9531A', fondo: '#FDEBDC', medio: '#F08A3C',
    trazo: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5',
  },
  planificacion_familiar: {
    nombre: 'Planificación familiar', corto: 'Planificación',
    tinta: '#6A3DAE', fondo: '#F0E8FB', medio: '#9466D6',
    trazo: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z',
  },
  medico_quirurgico: {
    nombre: 'Médico quirúrgico', corto: 'Quirúrgico',
    tinta: '#1D7550', fondo: '#DFF4EA', medio: '#2FA772',
    trazo: 'M18 3l3 3 M16.5 4.5l3 3 M18 6l-9.5 9.5-3-3L15 3 M5.5 15.5l-2.5 2.5 M8.5 9.5l2 2 M11 7l2 2',
  },
  laboratorio: {
    nombre: 'Laboratorio', corto: 'Laboratorio',
    tinta: '#9A6E0C', fondo: '#FCF1D4', medio: '#E5AE2B',
    trazo: 'M9 3h6 M10 3v6.5L5 18a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-8.5V3 M7.5 15h9',
  },
  tuberculosis: {
    nombre: 'Tuberculosis', corto: 'TB',
    tinta: '#922845', fondo: '#FBE3EA', medio: '#C8456A',
    trazo: 'M12 3v7 M12 10c-1.5 1-2.5 2-2.5 4 M12 10c1.5 1 2.5 2 2.5 4 M9.5 7.5C6 8 4 12 4 16.5 4 19 5.5 20 7 20c2 0 2.5-2 2.5-4V7.5 M14.5 7.5C18 8 20 12 20 16.5c0 2.5-1.5 3.5-3 3.5-2 0-2.5-2-2.5-4V7.5',
  },
};

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export function sello(fecha) {
  const d = new Date(fecha);
  return { mes: MESES[d.getUTCMonth()], anio: d.getUTCFullYear() };
}

// Como el formato #,##0 de Excel: entero con separador de miles, y el medio
// se redondea alejandose del cero (-2.5 -> -3), no hacia arriba.
const redondearExcel = (x) => Math.sign(x) * Math.round(Math.abs(x));
export const miles = (n) => (n === null || n === undefined ? '' : redondearExcel(Number(n)).toLocaleString('en-US'));
// Como el formato General de Excel: el numero tal cual, con sus decimales.
export const general = (n) => (n === null || n === undefined ? '' : String(Math.round(Number(n) * 1e9) / 1e9));


const SIN_CATEGORIA = { nombre: 'Sin categoría', corto: 'Otro', tinta: '#334155', fondo: '#EEF2F6', medio: '#64748B', trazo: 'M5 5h14v14H5z' };

export const categoriaVisual = (clave) => CATEGORIA[clave] ?? SIN_CATEGORIA;

/** Variables CSS de la categoría para el lomo, la ficha y el estante. */
export function estiloCategoria(clave) {
  const c = categoriaVisual(clave);
  return { '--cat': c.medio, '--cat-fondo': c.fondo, '--cat-tinta': c.tinta };
}

/**
 * Situación de un renglón del balance, en una palabra. Agotado es la bodega
 * en cero con consumo: la misma regla que cuenta la cifra "Agotados". Sin
 * consumo no es urgente aunque no haya existencia.
 */
export function situacion(bres) {
  if (bres.sinConsumo) return 'sin_consumo';
  if (bres.I === 0) return 'agotado';
  if (bres.bajoMinimo) return 'bajo';
  return 'bien';
}

/** Colores de estado, los mismos en cifras, reglas y etiquetas. */
export const TONO = {
  accion: { nombre: 'acción', fuerte: '#2F83C4', fondo: '#EAF3FB', borde: '#9FCDEC', hondo: '#1F6AA5', tinta: '#174E80' },
  atencion: { nombre: 'atención', fuerte: '#E8930C', fondo: '#FFF4E0', borde: '#F5C26B', hondo: '#C27708', tinta: '#8A4B00' },
  critico: { nombre: 'crítico', fuerte: '#D64545', fondo: '#FDECEC', borde: '#F3B1B1', hondo: '#A83232', tinta: '#8C2323' },
  bien: { nombre: 'bien', fuerte: '#22A06B', fondo: '#E3F6EC', borde: '#9ED9BC', hondo: '#17784F', tinta: '#145C3D' },
  neutro: { nombre: 'neutro', fuerte: '#94A3B8', fondo: '#F1F4F8', borde: '#CBD5E1', hondo: '#94A3B8', tinta: '#475569' },
};

/** Variables CSS de un tono, para tarjetas, franjas y etiquetas. */
export function estiloTono(clave) {
  const t = TONO[clave] ?? TONO.neutro;
  return { '--t': t.fuerte, '--t-fondo': t.fondo, '--t-borde': t.borde, '--t-hondo': t.hondo, '--t-tinta': t.tinta };
}

export const decimal = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1));
