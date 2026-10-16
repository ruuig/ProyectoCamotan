<script setup>
import { computed } from 'vue';

/**
 * Regla de cobertura: de 0 a 1.5 veces el máximo, con las zonas bajo el
 * mínimo, entre mínimo y máximo, y sobre el máximo. La barra llega a los
 * meses que alcanza la existencia.
 */
const props = defineProps({
  meses: { type: Number, default: null },
  minimo: { type: Number, default: 2 },
  maximo: { type: Number, default: 4 },
  tono: { type: String, default: 'bien' }, // bien | bajo | agotado | sin_consumo
  ancho: { type: Number, default: 136 },
});

const COLOR = { bien: '#22A06B', sobra: '#4A9BD6', bajo: '#E8930C', agotado: '#D64545', sin_consumo: '#94A3B8' };

const r = computed(() => {
  const tope = props.maximo * 1.5;
  const x = (m) => props.ancho * Math.min(1, Math.max(0, m) / tope);
  const meses = props.tono === 'agotado' ? 0 : props.meses ?? 0;
  const tono = props.tono === 'bien' && meses > props.maximo ? 'sobra' : props.tono;
  return { xMin: x(props.minimo), xMax: x(props.maximo), x: x(meses), pasa: meses > tope, meses, color: COLOR[tono] };
});
</script>

<template>
  <svg :viewBox="`0 0 ${ancho} 24`" :width="ancho" height="24" class="shrink-0" aria-hidden="true">
    <!-- Pista gris con la franja sana (entre mínimo y máximo) en verde suave. -->
    <rect x="0" y="5" :width="ancho" height="10" rx="5" fill="#EDF1F6" />
    <rect :x="r.xMin" y="5" :width="r.xMax - r.xMin" height="10" fill="#D5F0E2" />
    <rect v-if="r.meses > 0 && tono !== 'sin_consumo'" x="0" y="5" :width="Math.max(10, r.x)" height="10" rx="5" :fill="r.color" />
    <path v-if="r.pasa" :d="`M${ancho - 9} 7l4 3-4 3`" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <line :x1="r.xMin" :x2="r.xMin" y1="3" y2="17" stroke="#94A3B8" stroke-width="1.5" />
    <line :x1="r.xMax" :x2="r.xMax" y1="3" y2="17" stroke="#94A3B8" stroke-width="1.5" />
    <text :x="r.xMin" y="24" text-anchor="middle" font-size="7.5" font-weight="800" fill="#64748B">{{ minimo }}</text>
    <text :x="r.xMax" y="24" text-anchor="middle" font-size="7.5" font-weight="800" fill="#64748B">{{ maximo }}</text>
  </svg>
</template>
