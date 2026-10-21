/**
 * Borrador: lo que se está llenando no se pierde.
 *
 * Mientras se arma una requisición, una recepción o el conteo del día, lo
 * escrito se guarda en este equipo. Si la persona se va a otra pantalla (por
 * ejemplo, a ver cuánto hay en existencias), se cierra la pestaña o se va la
 * luz, al volver encuentra todo como lo dejó. Se borra al enviar.
 *
 *   const b = usarBorrador('requisicion-entregar', { nueva, renglones });
 *   b.recuperado  -> true si al abrir había algo guardado
 *   b.limpiar()   -> al enviar con éxito, o «Empezar de nuevo»
 *
 * Los valores pueden ser ref (se reemplaza .value) o reactive (se copian sus
 * campos). Se guarda por usuario para que dos personas del mismo equipo no se
 * mezclen.
 */
import { ref, watch, isRef } from 'vue';

const PREFIJO = 'camotan_borrador_';
// Un borrador de más de 3 días ya no es de este trabajo.
const VIGENCIA_MS = 3 * 86400000;

function usuarioActual() {
  try { return JSON.parse(localStorage.getItem('camotan_usuario'))?.id ?? 'x'; } catch { return 'x'; }
}

function leer(clave) {
  try {
    const g = JSON.parse(localStorage.getItem(clave));
    if (!g || Date.now() - g.en > VIGENCIA_MS) return null;
    return g.datos;
  } catch {
    return null;
  }
}

export function usarBorrador(nombre, partes, { vacio = () => false } = {}) {
  const clave = () => `${PREFIJO}${usuarioActual()}_${typeof nombre === 'function' ? nombre() : nombre}`;
  const recuperado = ref(false);
  let pausado = false;

  function aplicar(datos) {
    pausado = true;
    for (const [k, destino] of Object.entries(partes)) {
      if (!(k in datos)) continue;
      if (isRef(destino)) destino.value = datos[k];
      else {
        for (const c of Object.keys(destino)) delete destino[c];
        Object.assign(destino, datos[k]);
      }
    }
    pausado = false;
  }

  /** Trae lo guardado, si hay. Devuelve true si recuperó algo. */
  function recuperar() {
    const datos = leer(clave());
    if (!datos) return false;
    aplicar(datos);
    recuperado.value = true;
    return true;
  }

  function guardar() {
    if (pausado) return;
    const datos = Object.fromEntries(Object.entries(partes).map(([k, v]) => [k, isRef(v) ? v.value : { ...v }]));
    try {
      if (vacio(datos)) localStorage.removeItem(clave());
      else localStorage.setItem(clave(), JSON.stringify({ en: Date.now(), datos }));
    } catch { /* sin almacenamiento: se sigue trabajando igual */ }
  }

  function limpiar() {
    try { localStorage.removeItem(clave()); } catch { /* nada */ }
    recuperado.value = false;
  }

  watch(() => Object.values(partes).map((v) => (isRef(v) ? v.value : { ...v })), guardar, { deep: true });

  return { recuperado, recuperar, limpiar, guardar };
}

/**
 * Los errores del servidor por renglón: { insumoId: mensaje }. El servidor dice
 * «renglones.12.cantidadSolicitada»; aquí se vuelve el insumo de ese renglón.
 */
/**
 * Un renglón del editor tal como lo recibe el servidor. Lo escrito a mano (que
 * no está en el sistema) va con su descripción y unidad, sin producto.
 */
export function renglonPedido(l) {
  const cantidadSolicitada = Number(String(l.cantidad ?? '').replace(/[^0-9]/g, '')) || 0;
  return l.libre
    ? { insumoId: null, descripcion: l.nombre.trim(), unidadMedida: l.unidad || 'Unidad', cantidadSolicitada }
    : { insumoId: l.insumoId, cantidadSolicitada };
}

export function erroresPorRenglon(fallo, enviados) {
  const salida = {};
  for (const d of fallo?.detalles ?? []) {
    const m = /^renglones\.(\d+)/.exec(d.campo ?? '');
    const r = m && enviados[Number(m[1])];
    if (r) salida[r.insumoId ?? r.clave] = d.mensaje;
  }
  return salida;
}
