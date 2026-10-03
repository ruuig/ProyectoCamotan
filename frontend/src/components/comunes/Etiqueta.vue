<script setup>
import { computed } from 'vue';
import Icono from './Icono.vue';

/**
 * Etiqueta de estado. Solo lo urgente se pinta con fondo; lo demas se lee
 * como texto con un punto, para que en una lista destaque una sola cosa.
 */
const props = defineProps({
  tono: {
    type: String,
    default: 'neutro',
    validator: (v) => ['urgente', 'atencion', 'estable', 'institucional', 'neutro'].includes(v),
  },
  icono: { type: String, default: '' },
  punto: { type: Boolean, default: false },
});

const TONOS = {
  urgente: 'border-urgente-200 bg-urgente-50 text-urgente-700',
  atencion: 'border-atencion-200 bg-white text-atencion-800',
  estable: 'border-slate-200 bg-white text-slate-600',
  institucional: 'border-slate-200 bg-white text-mspas-700',
  neutro: 'border-slate-200 bg-white text-slate-600',
};

const PUNTOS = {
  urgente: 'bg-urgente-500',
  atencion: 'bg-atencion-500',
  estable: 'bg-estable-500',
  institucional: 'bg-celeste-400',
  neutro: 'bg-slate-300',
};

const clases = computed(() => TONOS[props.tono] ?? TONOS.neutro);
const clasePunto = computed(() => PUNTOS[props.tono] ?? PUNTOS.neutro);
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1
           text-sm font-medium"
    :class="clases"
  >
    <span v-if="punto" class="h-2 w-2 shrink-0 rounded-full" :class="clasePunto" />
    <Icono v-if="icono" :nombre="icono" :tamano="14" class="shrink-0" />
    <slot />
  </span>
</template>
