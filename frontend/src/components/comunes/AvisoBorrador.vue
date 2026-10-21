<script setup>
import Icono from './Icono.vue';

/** Aviso de que se recuperó lo que se dejó a medias, con la opción de empezar de nuevo. */
defineProps({ texto: { type: String, default: 'Se recuperó lo que dejó a medias.' } });
const emit = defineEmits(['descartar']);
</script>

<template>
  <p class="aviso-borrador" role="status">
    <Icono nombre="guardar" :tamano="18" />
    <span>{{ texto }}</span>
    <button type="button" @click="emit('descartar')">Empezar de nuevo</button>
  </p>
</template>

<style scoped>
.aviso-borrador { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; background: #EAF3FB; color: #174E80; font-size: 14px; font-weight: 700; }
.aviso-borrador button { margin-left: auto; padding: 4px 12px; border: 2px solid #9FCDEC; border-radius: 10px; background: #fff; font-size: 13px; font-weight: 800; color: #174E80; }
</style>
