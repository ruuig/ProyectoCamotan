<script setup>
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import LogoInstitucional from '../../components/comunes/LogoInstitucional.vue';
import Icono from '../../components/comunes/Icono.vue';
import BotonInstalar from '../../components/comunes/BotonInstalar.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const usuario = ref('');
const password = ref('');
const codigoTotp = ref('');
const error = ref('');
const enviando = ref(false);
const pideTotp = ref(false);
const verPassword = ref(false);
const mayusculas = ref(false);
const campoPassword = ref(null);

const puedeEnviar = computed(
  () => usuario.value.trim() && password.value && (!pideTotp.value || codigoTotp.value.length === 6),
);

// Fecha y saludo en hora de Guatemala.
const ahora = new Date();
const hora = Number(new Intl.DateTimeFormat('es-GT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Guatemala' }).format(ahora));
const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
const fechaLarga = new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Guatemala' }).format(ahora);
const fecha = fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1);

// Franja con los colores de las áreas del sistema, en tono suave.
const FRANJA = ['#A9C4F0', '#A8DCC0', '#CDB8EC', '#F7C9A3', '#F2DC9B'];

function alternarPassword() {
  verPassword.value = !verPassword.value;
  campoPassword.value?.focus();
}

function revisarMayusculas(e) {
  if (typeof e.getModifierState === 'function') mayusculas.value = e.getModifierState('CapsLock');
}

async function enviar() {
  error.value = '';
  enviando.value = true;

  try {
    await auth.iniciarSesion(usuario.value, password.value, codigoTotp.value || undefined);
    router.push(route.query.redirigir || auth.rutaPanel);
  } catch (fallo) {
    if (fallo.codigo === 'totp_requerido') {
      pideTotp.value = true;
      error.value = '';
    } else {
      error.value = fallo.message;
    }
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <main class="acceso">
    <div class="tarjeta-acceso">
      <div class="franja" aria-hidden="true">
        <span v-for="c in FRANJA" :key="c" :style="{ background: c }" />
      </div>

      <div class="contenido">
        <div class="fila-fecha">
          <span>{{ fecha }}</span>
          <span class="saludo">{{ saludo }}</span>
        </div>

        <div class="encabezado">
          <LogoInstitucional orientacion="horizontal" :alto="58" />
          <span class="separador" aria-hidden="true" />
          <div>
            <h1 class="nombre">Centro de Salud de Camotán</h1>
            <p class="sistema">Sistema de gestión clínica</p>
          </div>
        </div>

        <form class="formulario" @submit.prevent="enviar">
          <h2 class="titulo">Iniciar sesión</h2>

          <div>
            <label for="usuario" class="etiqueta">Usuario</label>
            <div class="caja-campo">
              <Icono nombre="usuario" :tamano="20" class="icono-campo" />
              <input
                id="usuario"
                v-model="usuario"
                type="text"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                autofocus
                required
                class="entrada"
              />
            </div>
          </div>

          <div>
            <label for="password" class="etiqueta">Contraseña</label>
            <div class="caja-campo">
              <Icono nombre="bloqueo" :tamano="20" class="icono-campo" />
              <input
                id="password"
                ref="campoPassword"
                v-model="password"
                :type="verPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
                class="entrada con-boton"
                @keydown="revisarMayusculas"
                @keyup="revisarMayusculas"
                @blur="mayusculas = false"
              />
              <button
                type="button"
                class="ver"
                :aria-pressed="verPassword"
                :aria-label="verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                :title="verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                @click="alternarPassword"
              >
                <Icono :nombre="verPassword ? 'ojoTachado' : 'ojo'" :tamano="20" />
              </button>
            </div>
            <p v-if="mayusculas" class="mayus" role="status">
              <Icono nombre="alerta" :tamano="16" /> Mayúsculas activadas
            </p>
          </div>

          <!-- Aparece solo si el servidor lo pide -->
          <div v-if="pideTotp" class="totp">
            <label for="codigoTotp" class="etiqueta">Código de verificación</label>
            <input
              id="codigoTotp"
              v-model="codigoTotp"
              inputmode="numeric"
              maxlength="6"
              autocomplete="one-time-code"
              placeholder="000000"
              class="entrada sin-icono text-center font-mono text-2xl tracking-[0.5em]"
            />
            <p class="mt-2 text-sm text-tinta">Código de 6 dígitos de la aplicación de autenticación</p>
          </div>

          <p v-if="error" role="alert" class="falla">
            <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0" />
            <span>{{ error }}</span>
          </p>

          <button type="submit" :disabled="enviando || !puedeEnviar" class="entrar">
            <span>{{ enviando ? 'Ingresando...' : 'Ingresar' }}</span>
            <Icono v-if="!enviando" nombre="irA" :tamano="20" :grosor="2.2" />
          </button>
        </form>
        <BotonInstalar en-login />
      </div>

      <footer class="pie">
        <svg class="pulso" viewBox="0 0 120 20" aria-hidden="true">
          <path d="M0 12 H44 L49 12 L53 4 L58 18 L63 2 L67 14 L70 12 H120" />
        </svg>
        <span>Ministerio de Salud Pública y Asistencia Social</span>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.acceso {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px 16px;
  background-color: #EEF2F7;
  /* Cuadrícula muy tenue, como papel de ficha clínica */
  background-image:
    linear-gradient(rgba(23, 42, 90, .035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(23, 42, 90, .035) 1px, transparent 1px);
  background-size: 28px 28px;
}

.tarjeta-acceso {
  width: 100%;
  max-width: 460px;
  overflow: hidden;
  border: 1px solid #DDE4EE;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 18px 40px -24px rgba(23, 42, 90, .28);
}

.franja { display: flex; height: 6px; }
.franja span { flex: 1; }

.contenido { padding: 20px 36px 28px; }

.fila-fecha {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: #7A8699;
}
.saludo { font-weight: 600; color: #4A6297; }

.encabezado {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 18px;
  padding: 14px 18px;
  border-radius: 14px;
  background: #F4F7FC;
}
.separador { align-self: stretch; width: 1px; background: #D6DEEA; }
.nombre { font-size: 17px; line-height: 1.25; font-weight: 700; color: #233A6E; }
.sistema { margin-top: 2px; font-size: 13px; color: #7A8699; }

.formulario { display: flex; flex-direction: column; gap: 16px; margin-top: 22px; }
.titulo { font-size: 24px; font-weight: 700; color: #233A6E; letter-spacing: -.01em; }

.etiqueta { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 600; color: #46536A; }

.caja-campo { position: relative; }
.icono-campo {
  position: absolute;
  left: 15px;
  top: 50%;
  transform: translateY(-50%);
  color: #A3AFC2;
  pointer-events: none;
  transition: color .15s;
}
.caja-campo:focus-within .icono-campo { color: #4A6297; }

.entrada {
  width: 100%;
  height: 48px;
  padding: 0 16px 0 46px;
  border: 2px solid #DDE4EE;
  border-radius: 12px;
  background: #FBFCFE;
  font-size: 16px;
  color: #1E293B;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.entrada.con-boton { padding-right: 54px; }
.entrada.sin-icono { padding-left: 16px; }
.entrada:hover { border-color: #C7D2E2; }
.entrada:focus { outline: none; border-color: #8FAEE3; background: #fff; box-shadow: 0 0 0 4px rgba(143, 174, 227, .22); }

.ver {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 40px;
  height: 38px;
  border-radius: 9px;
  color: #7A8699;
  transition: background .15s, color .15s;
}
.ver:hover { background: #EEF2F8; color: #233A6E; }
.ver:focus-visible { outline: 2px solid #8FAEE3; outline-offset: 1px; }
.ver[aria-pressed="true"] { color: #233A6E; background: #E7EEFA; }

.mayus {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #FBF1DA;
  font-size: 13px;
  font-weight: 600;
  color: #8A6417;
}

.totp { padding: 16px; border: 2px solid #DFE8F7; border-radius: 12px; background: #F4F7FC; }

.falla {
  display: flex;
  gap: 10px;
  padding: 11px 14px;
  border-radius: 12px;
  background: #FCEFF1;
  color: #A23B52;
  font-size: 15px;
}

.entrar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 50px;
  margin-top: 4px;
  border-radius: 12px;
  background: #34508F;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  transition: background .15s;
}
.entrar:hover:not(:disabled) { background: #2B4479; }
.entrar svg { transition: transform .15s; }
.entrar:hover:not(:disabled) svg { transform: translateX(3px); }
.entrar:focus-visible { outline: 3px solid #8FAEE3; outline-offset: 2px; }
.entrar:disabled { background: #C3CCDB; cursor: not-allowed; }

.pie {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 36px;
  border-top: 1px solid #EDF1F6;
  background: #FAFBFD;
  font-size: 13px;
  color: #7A8699;
}
.pulso { width: 54px; height: 16px; flex-shrink: 0; }
.pulso path { fill: none; stroke: #A9C4F0; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }

@media (max-width: 480px) {
  .contenido { padding: 18px 20px 24px; }
  .pie { padding: 12px 20px; }
  .encabezado { flex-direction: column; align-items: flex-start; gap: 10px; }
  .separador { display: none; }
}
</style>
