import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './style.css';
import './styles/interfaz.css';
import './styles/duo.css';
import './style-impresion.css';
import App from './App.vue';
import './dominio/instalacion';
import router from './router';
import { registrarManejadorSesionExpirada } from './services/http';
import { useAuthStore } from './stores/auth';

const app = createApp(App);

app.use(createPinia());
app.use(router);

// Si el servidor rechaza el token, la sesion local se limpia y se vuelve al
// login sin dejar la interfaz en un estado a medias.
registrarManejadorSesionExpirada(() => {
  useAuthStore().limpiarSesion();
  router.push('/login');
});

// La rueda del ratón sobre un campo numérico con el foco cambia el número sin
// que se note. Se suelta el foco: la página se desplaza y el valor no cambia.
document.addEventListener('wheel', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'number' && document.activeElement === e.target) {
    e.target.blur();
  }
}, { passive: true });

app.mount('#app');
