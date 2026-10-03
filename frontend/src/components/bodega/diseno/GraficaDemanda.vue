<script setup>
import { computed } from 'vue';
import { miles } from './PiezasBodega';

/**
 * Demanda de los últimos meses en barras. Los meses que entran al promedio
 * van en color lleno; el mes en curso, punteado; la línea es el promedio.
 */
const props = defineProps({
  demanda: { type: Array, required: true }, // [{ periodo, total, abierto }]
  promedio: { type: Number, default: 0 },
  mesesPromedio: { type: Number, default: 4 },
});

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ANCHO = 640;
const ALTO = 170;
const BASE = 140;

const g = computed(() => {
  const lista = props.demanda;
  const tope = Math.max(1, props.promedio, ...lista.map((d) => d.total ?? 0)) * 1.12;
  const paso = ANCHO / lista.length;
  const cerrados = lista.filter((d) => !d.abierto && d.total !== null).map((d) => d.periodo);
  const enPromedio = new Set(cerrados.slice(-props.mesesPromedio));
  const y = (v) => BASE - (BASE - 16) * (v / tope);
  return {
    paso,
    yProm: y(props.promedio),
    barras: lista.map((d, i) => ({
      ...d,
      x: i * paso + paso * 0.18,
      ancho: paso * 0.64,
      y: d.total === null ? BASE : y(d.total),
      enPromedio: enPromedio.has(d.periodo),
      mes: MESES[Number(d.periodo.slice(5)) - 1],
      anio: d.periodo.slice(2, 4),
    })),
  };
});
</script>

<template>
  <svg :viewBox="`0 0 ${ANCHO} ${ALTO}`" class="w-full" role="img" aria-label="Demanda mensual">
    <line x1="0" :x2="ANCHO" :y1="BASE" :y2="BASE" stroke="#CBD5E1" stroke-width="1.5" />
    <g v-for="b in g.barras" :key="b.periodo">
      <rect
        v-if="b.total !== null"
        :x="b.x" :y="b.y" :width="b.ancho" :height="Math.max(0, BASE - b.y)" rx="3"
        :fill="b.abierto ? '#fff' : b.enPromedio ? '#3D7BE0' : '#C9D7EE'"
        :stroke="b.abierto ? '#3D7BE0' : 'none'" :stroke-dasharray="b.abierto ? '4 3' : null" stroke-width="1.5"
      />
      <text v-if="b.total" :x="b.x + b.ancho / 2" :y="b.y - 5" text-anchor="middle" font-size="10.5" font-weight="700" :fill="b.enPromedio ? '#1F4FA8' : '#64748B'">{{ miles(b.total) }}</text>
      <text :x="b.x + b.ancho / 2" :y="BASE + 15" text-anchor="middle" font-size="11" font-weight="700" fill="#475569">{{ b.mes }}</text>
      <text :x="b.x + b.ancho / 2" :y="BASE + 27" text-anchor="middle" font-size="9" fill="#94A3B8">{{ b.anio }}</text>
    </g>
    <template v-if="promedio > 0">
      <line x1="0" :x2="ANCHO" :y1="g.yProm" :y2="g.yProm" stroke="#C2410C" stroke-width="1.5" stroke-dasharray="6 4" />
      <rect :x="ANCHO - 112" :y="g.yProm - 19" width="112" height="16" rx="4" fill="#FFF7ED" />
      <text :x="ANCHO - 6" :y="g.yProm - 7" text-anchor="end" font-size="10.5" font-weight="700" fill="#C2410C">Promedio {{ miles(promedio) }}</text>
    </template>
  </svg>
</template>
