<script setup>
import { computed } from 'vue';
import Icono from './Icono.vue';

/**
 * Tarjeta de un indicador. Toda tarjeta es blanca: el color se reserva para
 * lo que exige accion, y aun entonces es una sola marca, no un relleno.
 */
const props = defineProps({
  etiqueta: { type: String, required: true },
  valor: { type: [String, Number], required: true },
  unidad: { type: String, default: '' },
  nota: { type: String, default: '' },
  icono: { type: String, default: '' },
  variacion: { type: Object, default: null },
  // Cuando sube es bueno (atenciones) o malo (espera).
  subirEsBueno: { type: Boolean, default: true },
  alerta: { type: Boolean, default: false },
});

const colorVariacion = computed(() => {
  const v = props.variacion;
  if (!v || v.absoluta === 0) return 'text-slate-500';
  return v.absoluta > 0 === props.subirEsBueno ? 'text-slate-600' : 'text-urgente-700';
});

// Sin dato no se dibuja un numero grande que se leeria como un valor real.
const sinDato = computed(
  () => props.valor === null || props.valor === undefined || props.valor === 'sin dato',
);
</script>

<template>
  <!-- Lectura vertical: rotulo, dato, contexto. Uno debajo del otro. -->
  <div
    class="tarjeta border-l-4 px-5 py-4"
    :class="alerta ? 'border-l-urgente-500' : 'border-l-celeste-400'"
  >
    <div class="flex items-center gap-2">
      <Icono v-if="icono" :nombre="icono" :tamano="17" class="shrink-0 text-slate-400" />
      <p class="text-sm font-medium text-slate-500">{{ etiqueta }}</p>
    </div>

    <p
      class="mt-2 font-semibold tabular-nums leading-none"
      :class="[
        sinDato ? 'text-lg text-slate-400' : 'text-4xl',
        alerta && !sinDato ? 'text-urgente-700' : 'text-mspas-700',
      ]"
    >
      {{ sinDato ? 'sin dato' : valor
      }}<span v-if="unidad && !sinDato" class="ml-1.5 text-lg font-normal text-slate-500">
        {{ unidad }}
      </span>
    </p>

    <p v-if="variacion" class="mt-2 text-sm font-medium" :class="colorVariacion">
      {{ variacion.absoluta > 0 ? '▲' : variacion.absoluta < 0 ? '▼' : '—' }}
      {{ Math.abs(variacion.absoluta) }}
      <template v-if="variacion.porcentaje !== null">
        ({{ Math.abs(variacion.porcentaje) }}%)
      </template>
      vs. semana anterior
    </p>

    <p v-if="nota" class="mt-2 text-slate-500">{{ nota }}</p>
  </div>
</template>
