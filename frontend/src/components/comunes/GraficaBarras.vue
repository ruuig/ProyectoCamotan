<script setup>
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import { COLOR } from '../../design/tokens';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

/**
 * Barras del periodo con una sola barra destacada. El resto queda en un tono
 * atenuado: el ojo va primero al valor que importa y despues al contexto.
 */
const props = defineProps({
  // [{ etiqueta, total, variacion }]
  datos: { type: Array, required: true },
  // Indice de la barra a destacar, o null si no hay ninguna.
  destacado: { type: Number, default: null },
  unidad: { type: String, default: '' },
  alto: { type: Number, default: 240 },
  // El pie de la grafica cambia segun lo que se este midiendo: meses, horas,
  // comunidades. Sin esto una grafica de horas diria "el mes mas alto".
  preposicion: { type: String, default: 'en' },
  descripcionDestacado: { type: String, default: 'el valor mas alto del periodo' },
  mensajeVacio: { type: String, default: 'Sin datos registrados en el periodo.' },
  // Barras acostadas: cuando las etiquetas son palabras y no meses, leerlas
  // en horizontal evita tener que girar la cabeza.
  horizontal: { type: Boolean, default: false },
});

const NAVY = COLOR.marino;
const NAVY_TENUE = COLOR.marinoApagado;

const hayDatos = computed(() => props.datos.some((d) => d.total > 0));

const datosGrafica = computed(() => ({
  labels: props.datos.map((d) => d.etiqueta),
  datasets: [
    {
      data: props.datos.map((d) => d.total),
      backgroundColor: props.datos.map((_, i) => (i === props.destacado ? NAVY : NAVY_TENUE)),
      hoverBackgroundColor: NAVY,
      borderRadius: 10,
      borderSkipped: false,
      // Barras anchas y separadas, como en una ficha impresa.
      categoryPercentage: 0.7,
      barPercentage: 0.85,
    },
  ],
}));

// El eje de categorias y el de valores se intercambian al acostar las barras.
const ejeCategorias = computed(() => ({
  grid: { display: false },
  border: { display: false },
  ticks: { color: COLOR.apagado, font: { size: 13 } },
}));

const ejeValores = computed(() => ({
  beginAtZero: true,
  border: { display: false },
  grid: { color: COLOR.lineaSuave, drawTicks: false },
  ticks: { color: COLOR.apagado, font: { size: 13 }, precision: 0, maxTicksLimit: 5 },
}));

const opciones = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: props.horizontal ? 'y' : 'x',
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: NAVY,
      padding: 10,
      displayColors: false,
      titleFont: { size: 13 },
      bodyFont: { size: 14, weight: '600' },
      callbacks: {
        label: (ctx) => {
          const d = props.datos[ctx.dataIndex];
          const base = `${d.total}${props.unidad ? ` ${props.unidad}` : ''}`;
          // Sin mes previo no se inventa un porcentaje.
          return d.variacion === null || d.variacion === undefined
            ? base
            : `${base} (${d.variacion > 0 ? '+' : ''}${d.variacion}% vs. mes anterior)`;
        },
      },
    },
  },
  scales: {
    x: props.horizontal ? ejeValores.value : ejeCategorias.value,
    y: props.horizontal ? ejeCategorias.value : ejeValores.value,
  },
}));

// La marca del valor destacado va sobre la barra, como en una etiqueta pegada.
const destacada = computed(() =>
  props.destacado === null ? null : props.datos[props.destacado],
);
</script>

<template>
  <div>
    <div v-if="destacada" class="mb-2 flex flex-wrap items-baseline gap-2">
      <span class="text-2xl font-semibold tabular-nums text-mspas-700">
        {{ destacada.total }}<span v-if="unidad" class="ml-1.5 text-base font-normal text-slate-500">
          {{ unidad }}
        </span>
      </span>
      <span class="text-slate-500">
        {{ preposicion }} {{ destacada.etiqueta }}, {{ descripcionDestacado }}
      </span>
      <span
        v-if="destacada.variacion !== null && destacada.variacion !== undefined"
        class="rounded-lg border px-2 py-0.5 text-sm font-medium"
        :class="destacada.variacion >= 0
          ? 'border-slate-200 text-slate-600'
          : 'border-urgente-200 text-urgente-700'"
      >
        {{ destacada.variacion > 0 ? '+' : '' }}{{ destacada.variacion }}%
      </span>
    </div>

    <div :style="{ height: `${alto}px` }">
      <Bar v-if="hayDatos" :data="datosGrafica" :options="opciones" />
      <p v-else class="flex h-full items-center justify-center text-slate-400">
        {{ mensajeVacio }}
      </p>
    </div>
  </div>
</template>
