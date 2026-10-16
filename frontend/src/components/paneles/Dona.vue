<script setup>
import { computed, ref } from 'vue';

/**
 * Dona con leyenda a la par. Cada parte lleva su número y su nombre en la
 * leyenda: el color nunca es la única forma de leerla.
 * partes: [{ clave, texto, valor, color, a? }]
 */
const props = defineProps({
  partes: { type: Array, required: true },
  centro: { type: [String, Number], default: null },
  bajoCentro: { type: String, default: '' },
  porcentaje: { type: Boolean, default: false },
});

const total = computed(() => props.partes.reduce((t, p) => t + (p.valor || 0), 0));
const encima = ref(null);

const R = 52;
const C = 2 * Math.PI * R;
// Separación de 2 px entre partes, en unidades del círculo.
const HUECO = 2.5;

const arcos = computed(() => {
  let inicio = 0;
  const visibles = props.partes.filter((p) => p.valor > 0);
  return visibles.map((p) => {
    const largo = (p.valor / (total.value || 1)) * C;
    const trazo = Math.max(largo - (visibles.length > 1 ? HUECO : 0), 0.5);
    const a = { ...p, dash: `${trazo} ${C - trazo}`, offset: -inicio };
    inicio += largo;
    return a;
  });
});

const pct = (v) => (total.value ? Math.round((v / total.value) * 100) : 0);
</script>

<template>
  <div class="dona">
    <ul class="leyenda">
      <li v-for="p in partes" :key="p.clave" :class="{ apagado: encima && encima !== p.clave }" @mouseenter="encima = p.clave" @mouseleave="encima = null">
        <component :is="p.a ? 'RouterLink' : 'span'" :to="p.a" class="fila">
          <i :style="{ background: p.color }" />
          <b>{{ porcentaje ? `${pct(p.valor)}%` : p.valor.toLocaleString('es-GT') }}</b>
          <span>{{ p.texto }}</span>
        </component>
      </li>
    </ul>
    <div class="grafica" role="img" :aria-label="partes.map((p) => `${p.texto}: ${p.valor}`).join(', ')">
      <svg viewBox="0 0 128 128">
        <circle cx="64" cy="64" :r="R" fill="none" stroke="#EEF2F6" stroke-width="18" />
        <circle
          v-for="a in arcos"
          :key="a.clave"
          cx="64" cy="64" :r="R" fill="none"
          :stroke="a.color" stroke-width="18"
          :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset"
          transform="rotate(-90 64 64)"
          :class="{ apagado: encima && encima !== a.clave }"
          @mouseenter="encima = a.clave" @mouseleave="encima = null"
        >
          <title>{{ a.texto }}: {{ a.valor }}</title>
        </circle>
      </svg>
      <div v-if="centro !== null" class="centro">
        <b>{{ centro }}</b>
        <small v-if="bajoCentro">{{ bajoCentro }}</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dona { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.leyenda { flex: 1; display: grid; gap: 6px; min-width: 0; }
.fila { display: flex; align-items: center; gap: 8px; padding: 3px 6px; margin-left: -6px; border-radius: 8px; font-size: 14px; color: #475569; font-weight: 700; }
a.fila:hover { background: #F1F5F9; }
.fila i { width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0; }
.fila b { min-width: 30px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.leyenda li { transition: opacity .12s; }
.apagado { opacity: .35; }
.grafica { position: relative; width: 124px; height: 124px; flex-shrink: 0; }
.grafica svg { width: 100%; height: 100%; }
.grafica circle { transition: opacity .12s; }
.centro { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
.centro b { font-size: 26px; font-weight: 900; line-height: 1; color: #14244A; }
.centro small { margin-top: 2px; font-size: 11px; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: .04em; }
</style>
