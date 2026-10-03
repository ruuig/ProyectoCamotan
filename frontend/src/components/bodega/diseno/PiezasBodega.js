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

export const miles = (n) => (n === null || n === undefined ? '' : Math.round(Number(n)).toLocaleString('en-US'));


const SIN_CATEGORIA = { nombre: 'Sin categoría', corto: 'Otro', tinta: '#334155', fondo: '#EEF2F6', medio: '#64748B', trazo: 'M5 5h14v14H5z' };

export const categoriaVisual = (clave) => CATEGORIA[clave] ?? SIN_CATEGORIA;

/** Variables CSS de la categoría para el lomo, la ficha y el estante. */
export function estiloCategoria(clave) {
  const c = categoriaVisual(clave);
  return { '--cat': c.medio, '--cat-fondo': c.fondo, '--cat-tinta': c.tinta };
}

/** Situación de un renglón del balance, en una palabra. */
export function situacion(bres) {
  if (bres.I === 0 && bres.H === 0) return 'agotado';
  if (bres.sinConsumo) return 'sin_consumo';
  if (bres.bajoMinimo) return 'bajo';
  return 'bien';
}

export const decimal = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1));
