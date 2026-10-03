<script setup>
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { COLOR } from '../../design/tokens';
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Filler,
} from 'chart.js';

ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Filler,
);

/**
 * Curva de tendencia con relleno plano. Sin ejes ni rejilla: aqui la pregunta
 * es "va subiendo o bajando", no "cuanto exactamente"; para eso esta el numero
 * que la acompana.
 */
const props = defineProps({
  // [{ etiqueta, valor }] — valor puede ser null cuando no hay dato.
  datos: { type: Array, required: true },
  unidad: { type: String, default: '' },
  alto: { type: Number, default: 110 },
});

const CELESTE = COLOR.mejora;

const conDato = computed(
  () => props.datos.filter((d) => d.valor !== null && d.valor !== undefined).length,
);

const hayDatos = computed(() => conDato.value > 0);

const datosGrafica = computed(() => ({
  labels: props.datos.map((d) => d.etiqueta),
  datasets: [
    {
      data: props.datos.map((d) => d.valor),
      borderColor: CELESTE,
      borderWidth: 2.5,
      // Color plano, no degradado.
      backgroundColor: COLOR.lineaSuave,
      fill: true,
      tension: 0.4,
      // Con uno o dos meses medidos una linea no se ve: se marcan los puntos.
      pointRadius: conDato.value <= 2 ? 4 : 0,
      pointBackgroundColor: CELESTE,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: CELESTE,
      pointHoverBorderColor: COLOR.superficie,
      pointHoverBorderWidth: 2,
      // Un mes sin dato deja hueco en vez de una linea que cruza inventando.
      spanGaps: false,
    },
  ],
}));

const opciones = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: COLOR.marino,
      padding: 10,
      displayColors: false,
      callbacks: {
        label: (ctx) => `${ctx.parsed.y}${props.unidad ? ` ${props.unidad}` : ''}`,
      },
    },
  },
  scales: {
    x: { display: false },
    y: { display: false, beginAtZero: true },
  },
}));
</script>

<template>
  <div :style="{ height: `${alto}px` }">
    <Line v-if="hayDatos" :data="datosGrafica" :options="opciones" />
    <p v-else class="flex h-full items-center justify-center text-slate-400">
      Sin datos suficientes para la tendencia.
    </p>
  </div>
</template>
