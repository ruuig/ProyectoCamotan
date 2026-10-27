<script setup>
import { ref, reactive, watch } from 'vue';
import { useAuthStore } from '../../stores/auth';

// Pide la reautenticacion para una operacion protegida. El administrador o el
// director en sesion confirma con su propia contrasena; los demas, con el DPI
// y la contrasena del director (el DPI se trata como nombre de usuario).
const auth = useAuthStore();
const propia = auth.usuario?.rol === 'admin' || auth.usuario?.esDirector;
const props = defineProps({
  abierto: { type: Boolean, default: false },
  operacion: { type: String, required: true },
  error: { type: String, default: '' },
  enviando: { type: Boolean, default: false },
});

const emitir = defineEmits(['confirmar', 'cancelar']);

const datos = reactive({ dpi: '', password: '', totp: '' });
const mostrarTotp = ref(false);

watch(
  () => props.abierto,
  (abierto) => {
    if (abierto) {
      datos.dpi = '';
      datos.password = '';
      datos.totp = '';
      mostrarTotp.value = false;
    }
  },
);

// Si el servidor pide el segundo factor, se muestra el campo.
watch(
  () => props.error,
  (valor) => {
    if (valor && /codigo de verificacion/i.test(valor)) mostrarTotp.value = true;
  },
);

function confirmar() {
  emitir('confirmar', {
    ...(propia ? {} : { dpi: datos.dpi }),
    password: datos.password,
    ...(datos.totp ? { totp: datos.totp } : {}),
  });
}
</script>

<template>
  <div
    v-if="abierto"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
    role="dialog"
    aria-modal="true"
  >
    <form
      class="w-full max-w-sm rounded-lg bg-white p-6 space-y-4 shadow-lg"
      @submit.prevent="confirmar"
    >
      <div>
        <h2 class="font-semibold text-slate-800">{{ propia ? 'Confirme con su contraseña' : 'Autorización del director' }}</h2>
        <p class="text-slate-500">
          <template v-if="propia">Contraseña para {{ operacion }}</template>
          <template v-else>Autorización del director para {{ operacion }}</template>
        </p>
      </div>

      <div v-if="!propia">
        <label for="aut-dpi" class="block text-sm font-medium text-slate-700 mb-1">DPI del director</label>
        <input
          id="aut-dpi"
          v-model="datos.dpi"
          inputmode="numeric"
          maxlength="13"
          required
          autocomplete="off"
          class="campo"
        />
      </div>

      <div>
        <label for="aut-pass" class="block text-sm font-medium text-slate-700 mb-1">{{ propia ? 'Su contraseña' : 'Contraseña del director' }}</label>
        <input
          id="aut-pass"
          v-model="datos.password"
          type="password"
          required
          autocomplete="off"
          class="campo"
        />
      </div>

      <div v-if="mostrarTotp">
        <label for="aut-totp" class="block text-sm font-medium text-slate-700 mb-1">
          Código de verificación
        </label>
        <input
          id="aut-totp"
          v-model="datos.totp"
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          class="campo"
        />
      </div>

      <p v-if="error" role="alert" class="aviso aviso-urgente text-slate-700">
        {{ error }}
      </p>

      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="enviando"
          class="boton-primario !py-2.5"
        >
          {{ enviando ? 'Verificando...' : 'Autorizar' }}
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-300 px-4 py-2 text-sm"
          @click="emitir('cancelar')"
        >
          Cancelar
        </button>
      </div>
    </form>
  </div>
</template>
