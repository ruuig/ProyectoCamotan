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

/**
 * Tablet: su pantalla tiene muchos píxeles y todo salía diminuto. Se le dice
 * al navegador que la página mide 780 de ancho en vertical (1024 acostado):
 * agranda todo por igual y se usa el diseño de una columna, pensado para el
 * dedo. En la computadora y en el celular no cambia nada.
 */
// En tablet: barra de botones abajo, gestos y todo más grande.
export const tactil = ref(false);

function esTablet() {
  const corto = Math.min(window.screen.width, window.screen.height);
  return Boolean(window.matchMedia?.('(pointer: coarse)').matches) && corto >= 600;
}

let ultimo = '';
function ajustarVentana() {
  const meta = document.querySelector('meta[name="viewport"]');
  const si = esTablet();
  tactil.value = si;
  document.documentElement.classList.toggle('tactil', si);
  if (!meta) return;
  const acostada = window.screen.width > window.screen.height;
  const ancho = acostada ? 1024 : 780;
  const contenido = si
    ? `width=${ancho}, initial-scale=${(window.screen.width / ancho).toFixed(3)}`
    : 'width=device-width, initial-scale=1.0';
  // Cambiar la ventana dispara otro «resize»: solo se toca si cambió.
  if (contenido !== ultimo) {
    ultimo = contenido;
    meta.setAttribute('content', contenido);
  }
}

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
  ajustarVentana();
  // Al girar la tablet cambia el ancho: se recalcula.
  window.addEventListener('orientationchange', () => setTimeout(ajustarVentana, 200));
  window.addEventListener('resize', ajustarVentana);
  // Esc del navegador sale de pantalla completa: vuelve el menú.
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) marcar(false); });
}
