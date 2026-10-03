<script setup>
import { computed } from 'vue';

/**
 * Línea de tendencia de un indicador.
 *
 * Es un SVG propio y no una gráfica: no tiene ejes, ni valores, ni leyenda.
 * Solo dice si la cosa viene subiendo o bajando. Para eso Chart.js sería
 * mucho peso y mucho ruido.
 *
 * El servidor decide si hay períodos suficientes para dibujarla; si no,
 * manda `null` y aquí no se pinta nada. Una línea de dos puntos sugiere una
 * dirección que nadie ha observado.
 */
const props = defineProps({
  // [n, n, null, n...] o null si no hay períodos suficientes.
  valores: { type: Array, default: null },
  // 'mejora' | 'empeora' | 'neutro' | null. Mismo criterio que la frase.
  sentido: { type: String, default: null },
});

const ANCHO = 112;
const ALTO = 36;
const MARGEN = 3;

const COLOR = {
  mejora: 'var(--mejora)',
  empeora: 'var(--empeora)',
  neutro: 'var(--marino)',
};

const color = computed(() => COLOR[props.sentido] ?? COLOR.neutro);

// Los períodos sin dato no se interpolan: parten la línea en tramos.
const tramos = computed(() => {
  if (!props.valores) return [];

  const medidos = props.valores.filter((v) => v !== null && v !== undefined);
  if (medidos.length < 2) return [];

  const minimo = Math.min(...medidos);
  const maximo = Math.max(...medidos);
  // Una serie plana se dibuja en el centro, no pegada a un borde.
  const rango = maximo - minimo || 1;
  const paso = (ANCHO - MARGEN * 2) / Math.max(1, props.valores.length - 1);

  const puntos = props.valores.map((v, i) =>
    v === null || v === undefined
      ? null
      : {
          x: MARGEN + i * paso,
          y: MARGEN + (ALTO - MARGEN * 2) * (1 - (v - minimo) / rango),
        },
  );

  const partes = [];
  let actual = [];
  for (const p of puntos) {
    if (p) {
      actual.push(p);
    } else if (actual.length > 0) {
      partes.push(actual);
      actual = [];
    }
  }
  if (actual.length > 0) partes.push(actual);

  return partes.filter((t) => t.length >= 2).map((t) => t.map((p) => `${p.x},${p.y}`).join(' '));
});

// El punto marca dónde está hoy, que es lo que se mira primero.
const ultimo = computed(() => {
  if (!props.valores) return null;

  const paso = (ANCHO - MARGEN * 2) / Math.max(1, props.valores.length - 1);
  const medidos = props.valores.filter((v) => v !== null && v !== undefined);
  if (medidos.length < 2) return null;

  const minimo = Math.min(...medidos);
  const maximo = Math.max(...medidos);
  const rango = maximo - minimo || 1;

  for (let i = props.valores.length - 1; i >= 0; i -= 1) {
    const v = props.valores[i];
    if (v === null || v === undefined) continue;
    return {
      x: MARGEN + i * paso,
      y: MARGEN + (ALTO - MARGEN * 2) * (1 - (v - minimo) / rango),
    };
  }
  return null;
});
</script>

<template>
  <svg
    v-if="tramos.length > 0"
    :width="ANCHO"
    :height="ALTO"
    :viewBox="`0 0 ${ANCHO} ${ALTO}`"
    class="shrink-0 overflow-visible"
    aria-hidden="true"
    focusable="false"
  >
    <polyline
      v-for="(tramo, i) in tramos"
      :key="i"
      :points="tramo"
      fill="none"
      :stroke="color"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle v-if="ultimo" :cx="ultimo.x" :cy="ultimo.y" r="3" :fill="color" />
  </svg>
</template>
