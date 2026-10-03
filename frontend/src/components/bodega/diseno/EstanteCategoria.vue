<script setup>
import Pictograma from './Pictograma.vue';
import { categoriaVisual, estiloCategoria } from './PiezasBodega';

defineProps({ categoria: { type: String, required: true } });
</script>

<template>
  <span class="b-estante" :style="estiloCategoria(categoria)">
    <span class="ojal" />
    <Pictograma :categoria="categoria" :grosor="2" />
    <span>{{ categoriaVisual(categoria).nombre }}</span>
  </span>
</template>
