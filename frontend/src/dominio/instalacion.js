import { ref } from 'vue';

// Chrome y Edge avisan al cargar la página que se puede instalar. El aviso se
// guarda aquí, antes de montar la app, para que el botón del menú lo use.
const aviso = ref(null);
const instalada = ref(
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true,
);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  aviso.value = e;
});
window.addEventListener('appinstalled', () => {
  instalada.value = true;
  aviso.value = null;
});

// iPad y iPhone no tienen el aviso: se instala desde Compartir de Safari.
const esApple = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function usarInstalacion() {
  async function instalar() {
    if (!aviso.value) return false;
    aviso.value.prompt();
    await aviso.value.userChoice;
    aviso.value = null;
    return true;
  }
  return { aviso, instalada, esApple, instalar };
}
