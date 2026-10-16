<script setup>
// Aviso de version nueva de la app instalada (PWA). No se recarga sola: si la
// enfermera esta llenando una preconsulta, la termina y actualiza cuando quiera.
import { ref } from 'vue';
import { registerSW } from 'virtual:pwa-register';

const hayVersionNueva = ref(false);
const actualizar = registerSW({
  onNeedRefresh() {
    hayVersionNueva.value = true;
  },
  // La app instalada queda abierta todo el día: cada 15 minutos revisa si hay
  // una versión nueva, para que el aviso salga sin recargar la página a mano.
  onRegisteredSW(_url, registro) {
    if (registro) setInterval(() => registro.update(), 15 * 60 * 1000);
  },
});
</script>

<template>
  <div
    v-if="hayVersionNueva"
    role="status"
    class="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl bg-slate-800 px-4 py-3 text-white shadow-lg"
  >
    <span>Hay una versión nueva del sistema.</span>
    <button type="button" class="rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-800" @click="actualizar(true)">
      Actualizar
    </button>
    <button type="button" class="px-2 py-1.5 text-slate-300" aria-label="Después" @click="hayVersionNueva = false">
      Después
    </button>
  </div>
</template>
