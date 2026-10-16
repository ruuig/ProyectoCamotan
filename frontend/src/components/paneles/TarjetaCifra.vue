<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import Icono from '../comunes/Icono.vue';
import { estiloTono } from '../bodega/diseno/PiezasBodega';

/**
 * Cifra principal de un panel: qué es, el número y una línea que dice por qué
 * importa o contra qué se compara. El tono solo se pinta cuando el número
 * pide hacer algo (atención o crítico); si está bien, se queda tranquilo.
 */
const props = defineProps({
  titulo: { type: String, required: true },
  valor: { type: [String, Number], default: '·' },
  unidad: { type: String, default: '' },
  nota: { type: String, default: '' },
  icono: { type: String, default: '' },
  tono: { type: String, default: 'neutro' },
  a: { type: String, default: '' },
  tendencia: { type: Array, default: null },
});

const puntos = computed(() => {
  const serie = (props.tendencia ?? []).map((v) => (v == null ? null : Number(v)));
  const validos = serie.filter((v) => v != null);
  if (validos.length < 3) return null;
  const max = Math.max(...validos, 1);
  const min = Math.min(...validos, 0);
  const paso = 100 / (serie.length - 1);
  return serie
    .map((v, i) => (v == null ? null : `${(i * paso).toFixed(1)},${(26 - ((v - min) / (max - min || 1)) * 22).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
});
</script>

<template>
  <component :is="a ? RouterLink : 'div'" :to="a" class="cifra" :class="[`t-${tono}`, a ? 'enlace' : '']" :style="estiloTono(tono)">
    <div class="arriba">
      <span class="titulo">{{ titulo }}</span>
      <span v-if="icono" class="ic"><Icono :nombre="icono" :tamano="20" :grosor="2.2" /></span>
    </div>
    <div class="numero">
      <b>{{ valor }}</b><span v-if="unidad" class="unidad">{{ unidad }}</span>
      <svg v-if="puntos" class="linea" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        <polyline :points="puntos" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      </svg>
    </div>
    <p v-if="nota" class="nota">{{ nota }}</p>
    <slot />
  </component>
</template>

<style scoped>
.cifra { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 16px 18px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; color: #14244A; transition: transform .06s, border-color .12s; }
.enlace:hover { border-color: var(--t-borde); }
.enlace:active { transform: translateY(2px); border-bottom-width: 2px; }
.arriba { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.titulo { font-size: 15px; font-weight: 800; color: #334155; }
.ic { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--t-fondo); color: var(--t-hondo); flex-shrink: 0; }
.numero { display: flex; align-items: baseline; gap: 6px; }
.numero b { font-size: 38px; font-weight: 900; line-height: 1.05; font-variant-numeric: tabular-nums; }
.t-critico .numero b { color: var(--t-hondo); }
.t-atencion .numero b { color: var(--t-hondo); }
.unidad { font-size: 16px; font-weight: 800; color: #64748B; }
.linea { flex: 1; height: 28px; max-width: 120px; margin-left: auto; align-self: center; stroke: #9FCDEC; }
.t-critico .linea { stroke: var(--t-borde); }
.nota { font-size: 13px; font-weight: 700; color: #64748B; line-height: 1.35; }
.t-critico .nota, .t-atencion .nota { color: var(--t-tinta); }
</style>
