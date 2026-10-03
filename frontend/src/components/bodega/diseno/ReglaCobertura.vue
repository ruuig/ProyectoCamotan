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

const COLOR = { bien: '#22A06B', sobra: '#3D7BE0', bajo: '#E8930C', agotado: '#D64545', sin_consumo: '#94A3B8' };

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
    <rect x="0" y="4" :width="r.xMin" height="12" fill="#FBE3BF" />
    <rect :x="r.xMin" y="4" :width="r.xMax - r.xMin" height="12" fill="#CDEEDD" />
    <rect :x="r.xMax" y="4" :width="ancho - r.xMax" height="12" fill="#DDE7F6" />
    <template v-if="r.meses > 0 && tono !== 'sin_consumo'">
      <rect x="0" y="7" :width="r.x" height="6" :fill="r.color" />
      <rect :x="Math.max(0, r.x - 3)" y="1" width="3" height="18" :fill="r.color" />
    </template>
    <path v-if="r.pasa" :d="`M${ancho - 8} 5l5 5-5 5`" fill="none" stroke="#fff" stroke-width="2" />
    <text :x="r.xMin" y="24" text-anchor="middle" font-size="7.5" font-weight="700" fill="#475569">{{ minimo }}</text>
    <text :x="r.xMax" y="24" text-anchor="middle" font-size="7.5" font-weight="700" fill="#475569">{{ maximo }}</text>
  </svg>
</template>
