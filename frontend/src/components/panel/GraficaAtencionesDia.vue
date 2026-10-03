<script setup>
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { COLOR } from '../../design/tokens';

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

/**
 * Atenciones por día, apiladas: lo no urgente abajo y lo urgente encima.
 *
 * El período anterior va en tonos apagados a la izquierda y el actual en
 * tonos plenos a la derecha, con una línea que los separa. Así se compara
 * sin tener que recordar la cifra de la semana pasada.
 */
const props = defineProps({
  // { actual, anterior, totalActual, totalAnterior, dibujable }
  datos: { type: Object, required: true },
  alto: { type: Number, default: 300 },
});

// El período anterior no compite con el actual: mismo tono, menos fuerza.
const MARINO_APAGADO = COLOR.marinoApagado;
const NARANJA_APAGADO = '#F0C4A8';

const barras = computed(() => [...props.datos.anterior, ...props.datos.actual]);
const corte = computed(() => props.datos.anterior.length);

const datosGrafica = computed(() => ({
  labels: barras.value.map((d) => d.etiqueta),
  datasets: [
    {
      label: 'Atenciones',
      data: barras.value.map((d) => d.noUrgentes),
      backgroundColor: barras.value.map((_, i) =>
        i < corte.value ? MARINO_APAGADO : COLOR.marino,
      ),
      borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 },
      borderSkipped: false,
      stack: 'dia',
      categoryPercentage: 0.75,
      barPercentage: 0.8,
    },
    {
      label: 'Urgentes',
      data: barras.value.map((d) => d.urgentes),
      backgroundColor: barras.value.map((_, i) =>
        i < corte.value ? NARANJA_APAGADO : COLOR.empeoraClaro,
      ),
      borderRadius: 4,
      borderSkipped: false,
      stack: 'dia',
      categoryPercentage: 0.75,
      barPercentage: 0.8,
    },
  ],
}));

/**
 * La raya vertical que separa los dos períodos. Se dibuja como complemento
 * de Chart.js porque no es un dato: es el límite entre dos lecturas.
 */
const separador = {
  id: 'separadorPeriodos',
  afterDatasetsDraw(grafica, args, opciones) {
    const eje = grafica.scales.x;
    if (!eje || opciones.corte <= 0) return;

    // Entre la última barra del período anterior y la primera del actual.
    const x = (eje.getPixelForTick(opciones.corte - 1) + eje.getPixelForTick(opciones.corte)) / 2;

    const { ctx, chartArea } = grafica;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLOR.linea;
    ctx.lineWidth = 1;
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

const opciones = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    separadorPeriodos: { corte: corte.value },
    tooltip: {
      backgroundColor: COLOR.marino,
      padding: 10,
      titleFont: { size: 13 },
      bodyFont: { size: 14 },
      callbacks: {
        title: (items) => {
          const i = items[0].dataIndex;
          return i < corte.value ? `${items[0].label} (período anterior)` : items[0].label;
        },
      },
    },
  },
  scales: {
    x: {
      stacked: true,
      grid: { display: false },
      border: { display: false },
      ticks: { color: COLOR.apagado, font: { size: 13 } },
    },
    y: {
      stacked: true,
      beginAtZero: true,
      border: { display: false },
      grid: { color: COLOR.lineaSuave, drawTicks: false },
      ticks: { color: COLOR.apagado, font: { size: 13 }, precision: 0, maxTicksLimit: 5 },
    },
  },
}));
</script>

<template>
  <div>
    <!-- Sin una semana de registros la gráfica sugeriría una tendencia
         que todavía no se ha observado -->
    <div v-if="!datos.dibujable" class="py-8 text-center">
      <p class="cifra-indicador">{{ datos.totalActual }}</p>
      <p class="mt-2 text-apagado">
        Se necesita al menos una semana de registros para ver la tendencia
      </p>
    </div>

    <template v-else>
      <div class="mb-3 flex items-center justify-between gap-4 text-sm">
        <span class="text-apagado">
          Período anterior: <strong class="text-tinta-2">{{ datos.totalAnterior }}</strong>
        </span>
        <span class="text-apagado">
          Este período: <strong class="text-tinta">{{ datos.totalActual }}</strong>
        </span>
      </div>

      <div :style="{ height: `${alto}px` }">
        <Bar :data="datosGrafica" :options="opciones" :plugins="[separador]" />
      </div>
    </template>
  </div>
</template>
