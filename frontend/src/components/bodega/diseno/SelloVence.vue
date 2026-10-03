<script setup>
import { sello } from './PiezasBodega';

defineProps({
  fecha: { type: [String, Date], default: null },
  semaforo: { type: String, default: 'verde' },
});
</script>

<template>
  <span v-if="semaforo === 'sin_fecha' || !fecha" class="b-sello sin_fecha" title="Sin vencimiento registrado">
    <span class="m">por</span><span class="a text-[13px]">verificar</span>
  </span>
  <span v-else class="b-sello" :class="semaforo" :title="`Vence ${new Date(fecha).toLocaleDateString('es-GT', { timeZone: 'UTC' })}`">
    <span class="m">{{ sello(fecha).mes }}</span>
    <span class="a">{{ sello(fecha).anio }}</span>
  </span>
</template>
