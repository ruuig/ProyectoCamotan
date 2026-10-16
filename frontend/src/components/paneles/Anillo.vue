<script setup>
import { computed } from 'vue';

/** Anillo de avance "x de y": cuánto falta para cumplir algo que se debe cumplir. */
const props = defineProps({
  valor: { type: Number, default: 0 },
  de: { type: Number, default: 0 },
  color: { type: String, default: '#22A06B' },
  texto: { type: String, default: '' },
  tamano: { type: Number, default: 64 },
});

const R = 24;
const C = 2 * Math.PI * R;
const fraccion = computed(() => (props.de ? Math.min(props.valor / props.de, 1) : 0));
</script>

<template>
  <div class="anillo" :style="{ width: `${tamano}px`, height: `${tamano}px` }" role="img" :aria-label="`${valor} de ${de}`">
    <svg viewBox="0 0 60 60">
      <circle cx="30" cy="30" :r="R" fill="none" stroke="#EEF2F6" stroke-width="7" />
      <circle
        cx="30" cy="30" :r="R" fill="none" :stroke="color" stroke-width="7" stroke-linecap="round"
        :stroke-dasharray="`${fraccion * C} ${C}`" transform="rotate(-90 30 30)"
      />
    </svg>
    <b>{{ texto || `${Math.round(fraccion * 100)}%` }}</b>
  </div>
</template>

<style scoped>
.anillo { position: relative; flex-shrink: 0; }
.anillo svg { width: 100%; height: 100%; }
.anillo circle { transition: stroke-dasharray .4s ease; }
.anillo b { position: absolute; inset: 0; display: grid; place-items: center; font-size: 14px; font-weight: 900; color: #14244A; }
</style>
