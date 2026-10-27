<script setup>
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import http from '../../services/http';
import Icono from './Icono.vue';

/** Cada usuario cambia su propia contraseña: la actual y la nueva dos veces. */
const emit = defineEmits(['cerrar']);
const actual = ref('');
const nueva = ref('');
const repetir = ref('');
const ocupado = ref(false);
const error = ref('');
const listo = ref(false);
const campo = ref(null);

const corta = computed(() => nueva.value.length > 0 && nueva.value.length < 10);
const distintas = computed(() => repetir.value.length > 0 && repetir.value !== nueva.value);
const puede = computed(() => actual.value && nueva.value.length >= 10 && repetir.value === nueva.value && !ocupado.value);

async function guardar() {
  if (!puede.value) return;
  ocupado.value = true;
  error.value = '';
  try {
    await http.post('/auth/contrasena', { actual: actual.value, nueva: nueva.value });
    listo.value = true;
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    ocupado.value = false;
  }
}

const alTeclado = (e) => { if (e.key === 'Escape' && !ocupado.value) emit('cerrar'); };
onMounted(() => { window.addEventListener('keydown', alTeclado); campo.value?.focus(); });
onBeforeUnmount(() => window.removeEventListener('keydown', alTeclado));
</script>

<template>
  <Teleport to="body">
    <div class="velo" role="dialog" aria-modal="true" aria-labelledby="titulo-contrasena" @click.self="!ocupado && emit('cerrar')">
      <form class="ventana" @submit.prevent="guardar">
        <h2 id="titulo-contrasena">Cambiar contraseña</h2>
        <template v-if="!listo">
          <label>
            <span class="etiqueta-campo">Contraseña actual</span>
            <input ref="campo" v-model="actual" type="password" class="campo" autocomplete="current-password" />
          </label>
          <label>
            <span class="etiqueta-campo">Contraseña nueva</span>
            <input v-model="nueva" type="password" class="campo" autocomplete="new-password" />
            <small v-if="corta" class="mal">Mínimo 10 caracteres</small>
          </label>
          <label>
            <span class="etiqueta-campo">Repetir la nueva</span>
            <input v-model="repetir" type="password" class="campo" autocomplete="new-password" />
            <small v-if="distintas" class="mal">No coinciden</small>
          </label>
          <p v-if="error" class="mal">{{ error }}</p>
          <footer class="pie">
            <button type="button" class="b-btn secundario" :disabled="ocupado" @click="emit('cerrar')">Cancelar</button>
            <button type="submit" class="b-btn primario" :disabled="!puede">
              <Icono nombre="guardar" :tamano="20" /> {{ ocupado ? 'Guardando…' : 'Cambiar' }}
            </button>
          </footer>
        </template>
        <template v-else>
          <p class="bien">Contraseña cambiada.</p>
          <footer class="pie">
            <button type="button" class="b-btn primario" @click="emit('cerrar')">Listo</button>
          </footer>
        </template>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.velo { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .5); }
.ventana { display: flex; flex-direction: column; gap: 14px; width: min(440px, 100%); padding: 20px; border-radius: 22px; background: #fff; }
.ventana h2 { font-size: 22px; font-weight: 900; color: #14244A; }
.mal { display: block; margin-top: 4px; font-size: 13.5px; font-weight: 700; color: #C03535; }
.bien { font-size: 16px; font-weight: 800; color: #145C3C; }
.pie { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; padding-top: 4px; }
</style>
