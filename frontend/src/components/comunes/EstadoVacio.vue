<script setup>
import Icono from './Icono.vue';

// Un espacio sin datos debe decir por que esta vacio y que hacer, no
// quedarse en blanco ni mostrar un cero que se leeria como un valor.
defineProps({
  icono: { type: String, default: 'informacion' },
  titulo: { type: String, required: true },
  descripcion: { type: String, default: '' },
  tono: { type: String, default: 'neutro' },
});
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-12 text-center">
    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
      <Icono :nombre="icono" :tamano="26" />
    </div>
    <p class="font-semibold text-slate-700">{{ titulo }}</p>
    <p v-if="descripcion" class="mt-1.5 max-w-sm text-slate-500">{{ descripcion }}</p>
    <div class="mt-5"><slot /></div>
  </div>
</template>
