<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import Icono from './Icono.vue';

/**
 * Resumen de lo que se va a mandar, antes de mandarlo: un clic de más no
 * envía nada. Se cierra con Esc, con «Seguir revisando» o tocando afuera.
 *
 * filas: [{ nombre, cantidad, unidad }] (opcional; también se puede usar el slot).
 */
const props = defineProps({
  titulo: { type: String, required: true },
  detalle: { type: String, default: '' },
  filas: { type: Array, default: () => [] },
  confirmar: { type: String, default: 'Enviar' },
  icono: { type: String, default: 'correcto' },
  ocupado: { type: Boolean, default: false },
});
const emit = defineEmits(['cerrar', 'confirmar']);
const boton = ref(null);

const alTeclado = (e) => { if (e.key === 'Escape' && !props.ocupado) emit('cerrar'); };
onMounted(() => { window.addEventListener('keydown', alTeclado); boton.value?.focus(); });
onBeforeUnmount(() => window.removeEventListener('keydown', alTeclado));
const miles = (n) => Number(n ?? 0).toLocaleString('es-GT');
</script>

<template>
  <Teleport to="body">
    <div class="velo" role="dialog" aria-modal="true" aria-labelledby="titulo-confirmar" @click.self="!ocupado && emit('cerrar')">
      <div class="ventana">
        <header>
          <h2 id="titulo-confirmar">{{ titulo }}</h2>
          <p v-if="detalle">{{ detalle }}</p>
        </header>
        <ul v-if="filas.length" class="resumen">
          <li v-for="(f, i) in filas" :key="i">
            <span class="min-w-0 flex-1">{{ f.nombre }}</span>
            <b>{{ miles(f.cantidad) }}</b>
            <small>{{ f.unidad }}</small>
          </li>
        </ul>
        <slot />
        <footer class="pie">
          <button type="button" class="b-btn secundario" :disabled="ocupado" @click="emit('cerrar')">Seguir revisando</button>
          <button ref="boton" type="button" class="b-btn primario" :disabled="ocupado" @click="emit('confirmar')">
            <Icono :nombre="icono" :tamano="20" /> {{ ocupado ? 'Enviando…' : confirmar }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.velo { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .5); }
.ventana { display: flex; flex-direction: column; gap: 12px; width: min(620px, 100%); max-height: calc(100vh - 32px); padding: 20px; border-radius: 22px; background: #fff; }
.ventana h2 { font-size: 22px; font-weight: 900; color: #14244A; }
.ventana header p { margin-top: 2px; font-size: 15px; font-weight: 700; color: #475569; }
.resumen { min-height: 0; overflow-y: auto; border: 2px solid #E5E9F0; border-radius: 14px; }
.resumen li { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1px solid #EEF2F6; font-size: 14.5px; font-weight: 700; color: #1E293B; }
.resumen li:first-child { border-top: 0; }
.resumen li b { font-variant-numeric: tabular-nums; color: #14244A; }
.resumen li small { width: 70px; font-size: 12.5px; font-weight: 700; color: #64748B; }
.pie { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; padding-top: 4px; }
</style>
