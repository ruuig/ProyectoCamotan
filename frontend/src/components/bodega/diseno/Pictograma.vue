<script setup>
import { computed } from 'vue';
import { categoriaVisual } from './PiezasBodega';

const props = defineProps({
  categoria: { type: String, required: true },
  grosor: { type: Number, default: 1.8 },
});
const trazo = computed(() => categoriaVisual(props.categoria).trazo);
</script>

<template>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path :d="trazo" fill="none" stroke="currentColor" :stroke-width="grosor" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
