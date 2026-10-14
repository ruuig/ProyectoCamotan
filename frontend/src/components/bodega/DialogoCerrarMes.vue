<script setup>
import { ref, nextTick } from 'vue';
import Icono from '../comunes/Icono.vue';

/**
 * Cerrar el mes en dos pasos: primero se confirma qué significa cerrarlo,
 * después se escribe la contraseña de quien cierra.
 */
const props = defineProps({
  mes: { type: String, required: true },
  enviando: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['confirmar', 'cancelar']);

const paso = ref(1);
const password = ref('');

async function siguiente() {
  paso.value = 2;
  await nextTick();
  document.getElementById('clave-cierre')?.focus();
}
</script>

<template>
  <div class="fondo" role="dialog" aria-modal="true" :aria-label="`Cerrar ${props.mes}`" @keydown.esc="emit('cancelar')">
    <div class="dialogo">
      <header>
        <span class="icono"><Icono nombre="bloqueo" :tamano="24" :grosor="2.2" /></span>
        <div>
          <p class="b-subtitulo">Paso {{ paso }} de 2</p>
          <h2>Cerrar {{ props.mes }}</h2>
        </div>
      </header>

      <template v-if="paso === 1">
        <ul class="efectos">
          <li>Las cifras del BRES y del balance de {{ props.mes }} quedan fijas.</li>
          <li>Lo que se corrija después entra al mes siguiente como ajuste.</li>
          <li>No se puede deshacer.</li>
        </ul>
        <footer>
          <button type="button" class="b-btn secundario" @click="emit('cancelar')">No, todavía no</button>
          <button type="button" class="b-btn primario" @click="siguiente">Sí, quiero cerrarlo</button>
        </footer>
      </template>

      <form v-else @submit.prevent="emit('confirmar', password)">
        <label for="clave-cierre" class="b-etiqueta">Su contraseña</label>
        <input id="clave-cierre" v-model="password" type="password" required autocomplete="current-password" class="b-campo" />
        <p v-if="props.error" role="alert" class="b-aviso error mt-3 text-sm">{{ props.error }}</p>
        <footer>
          <button type="button" class="b-btn secundario" @click="paso = 1">Volver</button>
          <button type="submit" class="b-btn exito" :disabled="props.enviando || !password">
            <Icono nombre="bloqueo" :tamano="20" /> {{ props.enviando ? 'Cerrando…' : `Cerrar ${props.mes}` }}
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.fondo { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
.dialogo { width: min(460px, 100%); padding: 22px 24px; border-radius: 18px; background: #fff; box-shadow: 0 24px 60px -20px rgba(15, 23, 42, .45); }
header { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.icono { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: #E3EAFB; color: #172A5A; }
h2 { font-size: 22px; font-weight: 800; color: #14244A; }
.efectos { display: grid; gap: 8px; margin-bottom: 4px; }
.efectos li { padding-left: 18px; position: relative; font-weight: 600; color: #334155; }
.efectos li::before { content: ''; position: absolute; left: 4px; top: 9px; width: 6px; height: 6px; border-radius: 50%; background: #172A5A; }
footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
/* --- Relieve (estilo duo) --- */
.dialogo { border-radius: 22px; }
</style>
