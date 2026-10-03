<script setup>
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import LogoInstitucional from '../../components/comunes/LogoInstitucional.vue';
import Icono from '../../components/comunes/Icono.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const usuario = ref('');
const password = ref('');
const codigoTotp = ref('');
const error = ref('');
const enviando = ref(false);
const pideTotp = ref(false);

const puedeEnviar = computed(
  () => usuario.value.trim() && password.value && (!pideTotp.value || codigoTotp.value.length === 6),
);

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
  <main class="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 py-10">
    <div class="w-full max-w-md space-y-6">
      <!-- El emblema institucional preside la pantalla, en vertical -->
      <div class="flex flex-col items-center">
        <LogoInstitucional orientacion="vertical" :alto="150" />
        <h1 class="mt-6 text-center text-2xl font-semibold text-mspas-700">
          Centro de Salud de Camotán
        </h1>
        <p class="text-center text-slate-500">Sistema de gestión clínica</p>
      </div>

      <form class="tarjeta space-y-5 p-8" @submit.prevent="enviar">
        <div>
          <label for="usuario" class="etiqueta-campo">Usuario</label>
          <input
            id="usuario"
            v-model="usuario"
            type="text"
            autocomplete="username"
            autofocus
            required
            class="campo"
          />
        </div>

        <div>
          <label for="password" class="etiqueta-campo">Contraseña</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="campo"
          />
        </div>

        <!-- Aparece solo si el servidor lo pide -->
        <div v-if="pideTotp" class="rounded-xl border border-celeste-200 bg-celeste-50 p-4">
          <label for="codigoTotp" class="etiqueta-campo !text-mspas-700">
            Código de verificación
          </label>
          <input
            id="codigoTotp"
            v-model="codigoTotp"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
            placeholder="000000"
            class="campo text-center text-2xl tracking-[0.5em]"
          />
          <p class="mt-2 text-sm text-mspas-700">
            Abra su aplicación de autenticación e ingrese los 6 dígitos.
          </p>
        </div>

        <p
          v-if="error"
          role="alert"
          class="flex items-start gap-2.5 rounded-xl border border-urgente-100 bg-slate-50 px-4 py-3 text-urgente-700"
        >
          <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0" />
          <span>{{ error }}</span>
        </p>

        <button type="submit" :disabled="enviando || !puedeEnviar" class="boton-primario w-full">
          {{ enviando ? 'Ingresando...' : 'Ingresar' }}
        </button>
      </form>

      <p class="text-center text-slate-500">
        Ministerio de Salud Pública y Asistencia Social
      </p>
    </div>
  </main>
</template>
