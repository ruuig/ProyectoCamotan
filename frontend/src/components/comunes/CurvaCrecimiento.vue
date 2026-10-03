<script setup>
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { COLOR } from '../../design/tokens';

ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
);

const props = defineProps({
  curva: { type: Object, required: true },
});

// Gris para las bandas externas, mas oscuro hacia la mediana. La linea 0
// (mediana) se dibuja marcada porque es la referencia de lectura.
const ESTILO_BANDA = {
  '-3': { color: COLOR.empeora, ancho: 1, guion: [4, 3] },
  '-2': { color: COLOR.advertenciaMarca, ancho: 1, guion: [4, 3] },
  '-1': { color: COLOR.marinoApagado, ancho: 1, guion: [2, 3] },
  0: { color: COLOR.apagado, ancho: 1.5, guion: [] },
  1: { color: COLOR.marinoApagado, ancho: 1, guion: [2, 3] },
  2: { color: COLOR.advertenciaMarca, ancho: 1, guion: [4, 3] },
  3: { color: COLOR.empeora, ancho: 1, guion: [4, 3] },
};

const ETIQUETA_EJE = {
  edad_meses: 'Edad (meses)',
  talla_cm: 'Talla (cm)',
};

const ETIQUETA_INDICADOR = {
  peso_edad: 'Peso (kg)',
  talla_edad: 'Talla (cm)',
  peso_talla: 'Peso (kg)',
  peso_longitud: 'Peso (kg)',
  imc_edad: 'IMC',
};

const datos = computed(() => {
  const bandas = props.curva.bandas;
  if (!bandas) return null;

  const series = bandas.desviaciones.map((z, indice) => {
    const estilo = ESTILO_BANDA[String(z)];
    return {
      label: z === 0 ? 'Mediana' : `${z > 0 ? '+' : ''}${z} DE`,
      data: bandas.puntos.map((p) => ({ x: p.x, y: p.valores[indice] })),
      borderColor: estilo.color,
      borderWidth: estilo.ancho,
      borderDash: estilo.guion,
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    };
  });

  // Las mediciones del paciente van encima de las bandas.
  series.push({
    label: 'Paciente',
    data: props.curva.puntos.map((p) => ({ x: p.x, y: p.y })),
    borderColor: COLOR.marino,
    backgroundColor: COLOR.marino,
    borderWidth: 2.5,
    pointRadius: 4,
    fill: false,
  });

  return { datasets: series };
});

const opciones = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'nearest', intersect: false },
  scales: {
    x: {
      type: 'linear',
      title: { display: true, text: ETIQUETA_EJE[props.curva.ejeX] ?? props.curva.ejeX },
    },
    y: {
      title: { display: true, text: ETIQUETA_INDICADOR[props.curva.indicador] ?? '' },
    },
  },
  plugins: {
    legend: { labels: { boxWidth: 18, font: { size: 11 } } },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`,
      },
    },
  },
}));
</script>

<template>
  <div>
    <p v-if="!datos" class="aviso aviso-atencion text-slate-700">
      {{ curva.aviso || 'No hay datos de referencia para dibujar la curva.' }}
    </p>
    <div v-else class="h-80">
      <Line :data="datos" :options="opciones" />
    </div>
  </div>
</template>
