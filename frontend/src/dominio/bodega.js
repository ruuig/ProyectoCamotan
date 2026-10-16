import { reactive } from 'vue';

/**
 * Catálogos de la bodega para la pantalla: las categorías con el color que
 * ya usa el centro, los órdenes de las listas y el semáforo.
 */

export const CATEGORIAS = [
  { clave: 'medicamentos', etiqueta: 'Medicamentos', punto: 'bg-blue-600' },
  { clave: 'suplementos', etiqueta: 'Suplementos', punto: 'bg-orange-500' },
  { clave: 'planificacion_familiar', etiqueta: 'Planificación familiar', punto: 'bg-violet-600' },
  { clave: 'medico_quirurgico', etiqueta: 'Médico quirúrgico', punto: 'bg-green-600' },
  { clave: 'laboratorio', etiqueta: 'Laboratorio', punto: 'bg-yellow-400' },
  { clave: 'tuberculosis', etiqueta: 'Tuberculosis', punto: 'bg-red-600' },
];

export const categoria = (clave) => CATEGORIAS.find((c) => c.clave === clave) ?? { clave, etiqueta: clave, punto: 'bg-linea' };

export const ORDENES = [
  { valor: 'alfabetico', etiqueta: 'Alfabético' },
  { valor: 'categoria', etiqueta: 'Por categoría' },
  { valor: 'existencia', etiqueta: 'Por existencia' },
  { valor: 'meses', etiqueta: 'Por meses de existencia' },
  { valor: 'semaforo', etiqueta: 'Por semáforo' },
];

export const SEMAFORO = {
  vencido: { etiqueta: 'Vencido', clase: 'bg-tinta text-superficie', punto: 'bg-tinta' },
  rojo: { etiqueta: 'Rojo', clase: 'bg-red-100 text-red-900 border-red-300', punto: 'bg-red-600' },
  amarillo: { etiqueta: 'Amarillo', clase: 'bg-yellow-100 text-yellow-900 border-yellow-300', punto: 'bg-yellow-400' },
  verde: { etiqueta: 'Verde', clase: 'bg-green-100 text-green-900 border-green-300', punto: 'bg-green-600' },
};

/** Período del mes actual en hora de Guatemala. */
export function periodoActual() {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function nombrePeriodo(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return `${MESES[mes - 1]} de ${anio}`;
}

export function fecha(valor) {
  return valor ? new Date(valor).toLocaleDateString('es-GT', { timeZone: 'UTC' }) : '';
}

// --- Kardex: anotar o no lo que falta por reclamar ----------------------------
// La misma preferencia rige la pantalla y la tarjeta impresa de este equipo.
const CLAVE_RECLAMAR = 'camotan_kardex_reclamar';

export function leerAnotarReclamar() {
  try { return localStorage.getItem(CLAVE_RECLAMAR) !== 'no'; } catch { return true; }
}
export function guardarAnotarReclamar(si) {
  try { localStorage.setItem(CLAVE_RECLAMAR, si ? 'si' : 'no'); } catch { /* sin almacenamiento */ }
}

/** Observaciones de un renglón del kardex, con o sin el faltante por reclamar. */
export function observacionKardex(f, anotarReclamar) {
  return [f.observaciones, anotarReclamar && f.porReclamar ? `Faltan ${f.porReclamar} por reclamar` : '']
    .filter(Boolean).join('. ');
}

/** Período anterior a uno dado ('2026-01' → '2025-12'). */
export function periodoPrevio(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** Últimos n períodos hasta el actual, del más reciente al más antiguo. */
export function periodosRecientes(n = 13) {
  const lista = [periodoActual()];
  while (lista.length < n) lista.push(periodoPrevio(lista[lista.length - 1]));
  return lista;
}

/**
 * Mes que se está cerrando, compartido por los pasos del cierre: el mes que
 * acaba de terminar, mientras el usuario no elija otro.
 */
export const cierre = reactive({ periodo: periodoPrevio(periodoActual()) });
