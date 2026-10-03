<script setup>
import { computed } from 'vue';

/**
 * El código con el que el personal identifica al paciente.
 *
 * El de papel (M-1, R-483) es el que está escrito en la ficha física del
 * estante: es el que se busca con la vista, así que va grande. El expediente
 * del sistema lo acompaña debajo. Quien no tiene ficha de papel se identifica
 * por el expediente.
 */
const props = defineProps({
  papel: { type: String, default: null },
  expediente: { type: String, required: true },
  // grande: encabezado del expediente o la consulta. mediano: filas de lista.
  tamano: { type: String, default: 'grande' },
  // Sobre fondo oscuro (encabezado de la consulta).
  invertido: { type: Boolean, default: false },
});

const principal = computed(() => props.papel || props.expediente);
const secundario = computed(() => (props.papel ? `Exp. ${props.expediente}` : 'Sin ficha de papel'));
const etiqueta = computed(() => (props.papel ? 'Ficha' : 'Expediente'));
</script>

<template>
  <div
    class="inline-flex shrink-0 flex-col items-center justify-center rounded-control border-2 text-center"
    :class="[
      tamano === 'grande' ? 'min-w-[8.5rem] px-4 py-2' : 'min-w-[5.75rem] px-2 py-1',
      invertido ? 'border-superficie/60 bg-superficie/10' : 'border-marino bg-superficie',
    ]"
    :aria-label="`${etiqueta} ${principal}. ${secundario}`"
  >
    <span
      class="text-[0.7rem] font-bold uppercase tracking-widest"
      :class="invertido ? 'text-superficie/80' : 'text-apagado'"
      aria-hidden="true"
    >
      {{ etiqueta }}
    </span>
    <span
      class="font-titulo font-bold leading-none tabular-nums"
      :class="[
        tamano === 'grande' ? 'text-[2.4rem]' : (papel ? 'text-2xl' : 'text-base'),
        invertido ? 'text-superficie' : 'text-marino',
      ]"
      aria-hidden="true"
    >
      {{ principal }}
    </span>
    <span
      class="mt-1 whitespace-nowrap tabular-nums"
      :class="[
        tamano === 'grande' ? 'text-sm' : 'text-xs',
        invertido ? 'text-superficie/80' : 'text-apagado',
      ]"
      aria-hidden="true"
    >
      {{ secundario }}
    </span>
  </div>
</template>
