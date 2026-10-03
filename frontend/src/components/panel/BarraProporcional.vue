<script setup>
import { computed } from 'vue';

/**
 * Barra horizontal de una fila de lista.
 *
 * La usan abastecimiento y comunidades. El color no decora: dice si la
 * situación es crítica, si hay que vigilarla o si está normal, y viene
 * calculado del servidor para que la regla viva en un solo lugar.
 *
 * `umbral` dibuja una marca vertical donde está el límite configurado, para
 * que la barra se lea contra algo y no contra la intuición de cada quien.
 */
const props = defineProps({
  // Entre 0 y 1.
  proporcion: { type: Number, default: 0 },
  // 'empeora' | 'advertencia' | 'marino' | 'neutro' | null
  color: { type: String, default: null },
  // Entre 0 y 1, o null si no hay umbral que marcar.
  umbral: { type: Number, default: null },
});

const CLASE = {
  empeora: 'bg-empeora',
  advertencia: 'bg-advertencia-marca',
  marino: 'bg-marino',
  neutro: 'bg-marino-apagado',
};

const clase = computed(() => CLASE[props.color] ?? 'bg-marino-apagado');

// Una barra en cero no se ve. Se deja una marca minima para que la fila no
// parezca vacia cuando en realidad el valor es cero.
const ancho = computed(() => `${Math.max(props.proporcion * 100, props.color ? 2 : 0)}%`);

const posicionUmbral = computed(() =>
  props.umbral === null ? null : `${props.umbral * 100}%`,
);
</script>

<template>
  <div class="relative h-2 w-full rounded-full bg-linea-suave">
    <div class="h-2 rounded-full transition-[width]" :class="clase" :style="{ width: ancho }" />
    <span
      v-if="posicionUmbral"
      class="absolute top-[-3px] h-[14px] w-px bg-tinta-2"
      :style="{ left: posicionUmbral }"
      aria-hidden="true"
    />
  </div>
</template>
