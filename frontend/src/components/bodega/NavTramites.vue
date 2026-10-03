<script setup>
import { RouterLink, useRoute } from 'vue-router';

/** Cambio entre bajas y retiros sanitarios dentro de la pestaña. */
const route = useRoute();
</script>

<template>
  <nav class="b-segmentado" aria-label="Trámite">
    <RouterLink to="/inventario/bajas" :class="route.name === 'bajas' ? 'on' : ''">Bajas</RouterLink>
    <RouterLink to="/inventario/retiros" :class="String(route.name).startsWith('retiro') ? 'on' : ''">Retiros sanitarios</RouterLink>
  </nav>
</template>
