<script setup>
// Aviso de version nueva de la app instalada (PWA). No se recarga sola: si la
// enfermera esta llenando una preconsulta, la termina y actualiza cuando quiera.
import { ref } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import Icono from './Icono.vue';

const hayVersionNueva = ref(false);
const actualizar = registerSW({
  onNeedRefresh() {
    hayVersionNueva.value = true;
  },
  // La app instalada queda abierta todo el día: cada 15 minutos revisa si hay
  // una versión nueva, para que el aviso salga sin recargar la página a mano.
  onRegisteredSW(_url, registro) {
    if (registro) setInterval(() => registro.update().catch(() => {}), 15 * 60 * 1000);
  },
});
</script>

<template>
  <div v-if="hayVersionNueva" class="aviso-version" role="status">
    <Icono nombre="actualizar" :tamano="18" class="shrink-0" />
    <span>Hay una nueva versión del sistema.</span>
    <button type="button" class="boton-actualizar" @click="actualizar(true)">Actualizar</button>
    <button type="button" class="cerrar" aria-label="Más tarde" @click="hayVersionNueva = false">✕</button>
  </div>
</template>

<style scoped>
.aviso-version { position: fixed; right: 1.25rem; bottom: 1.25rem; z-index: 210; display: flex; align-items: center; gap: .7rem;
  max-width: min(400px, calc(100% - 2.5rem)); padding: .85rem 1rem; border-radius: 12px; background: #172A5A; color: #fff;
  box-shadow: 0 16px 32px -12px rgba(15, 23, 42, .45); font-weight: 600; animation: subir .2s ease-out; }
.boton-actualizar { margin-left: .25rem; padding: .35rem .8rem; border-radius: 8px; background: #fff; color: #172A5A; font-weight: 800; white-space: nowrap; }
.cerrar { margin-left: auto; padding: 0 .2rem; color: #fff; opacity: .7; font-size: 1rem; }
.cerrar:hover { opacity: 1; }
@keyframes subir { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
