import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './style.css';
import './styles/interfaz.css';
import './style-impresion.css';
import App from './App.vue';
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

app.mount('#app');
