/**
 * Pantalla completa y tamaño de la letra.
 *
 * En las computadoras del centro (pantallas chicas y de poca resolución) la
 * información se veía diminuta. Por eso, desde la barra superior:
 *  - «Pantalla completa» quita el menú lateral y la barra del navegador: la
 *    pantalla que se está usando ocupa todo el monitor. Esc la regresa.
 *  - A− / A+ cambian el tamaño de la letra de todo el sistema; se recuerda
 *    en el equipo.
 */
import { ref } from 'vue';

const CLAVE_ZOOM = 'camotan_tamano_letra';
export const TAMANOS = [0.9, 1, 1.15, 1.3, 1.45];
export const completa = ref(false);

export function aplicarTamano(t) {
  document.documentElement.style.zoom = t === 1 ? '' : String(t);
  try { localStorage.setItem(CLAVE_ZOOM, String(t)); } catch { /* sin almacenamiento */ }
}

export function tamanoActual() {
  try {
    const t = Number(localStorage.getItem(CLAVE_ZOOM));
    return TAMANOS.includes(t) ? t : 1;
  } catch {
    return 1;
  }
}

function marcar(si) {
  completa.value = si;
  document.body.classList.toggle('modo-completo', si);
}

export async function alternarPantallaCompleta() {
  if (completa.value) {
    marcar(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    return;
  }
  marcar(true);
  // Si el navegador no lo permite, igual se quita el menú lateral.
  await document.documentElement.requestFullscreen?.().catch(() => {});
}

export function iniciarAmpliar() {
  aplicarTamano(tamanoActual());
  // Esc del navegador sale de pantalla completa: vuelve el menú.
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) marcar(false); });
}
