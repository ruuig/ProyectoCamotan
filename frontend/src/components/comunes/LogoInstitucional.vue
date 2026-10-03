<script setup>
/**
 * Logo oficial del Ministerio de Salud Publica y Asistencia Social.
 * Los archivos viven en public/ y se sirven tal cual, sin recortes ni
 * recoloreados: un emblema institucional no se modifica.
 */
defineProps({
  // 'vertical' para la barra lateral, 'horizontal' para cabeceras anchas.
  orientacion: { type: String, default: 'horizontal' },
  alto: { type: Number, default: 44 },
  // Sobre fondo oscuro se usa la version de fondo blanco en una placa.
  sobreFondoOscuro: { type: Boolean, default: false },
});
</script>

<template>
  <div
    v-if="sobreFondoOscuro"
    class="inline-flex items-center justify-center rounded-xl bg-white p-2.5"
  >
    <img
      :src="orientacion === 'vertical' ? '/mspas-vertical.png' : '/mspas-horizontal.png'"
      alt="Ministerio de Salud Publica y Asistencia Social"
      :style="{ height: `${alto}px` }"
      class="w-auto object-contain"
    />
  </div>

  <img
    v-else
    :src="orientacion === 'vertical' ? '/mspas-vertical.png' : '/mspas-horizontal.png'"
    alt="Ministerio de Salud Publica y Asistencia Social"
    :style="{ height: `${alto}px` }"
    class="w-auto object-contain"
  />
</template>
