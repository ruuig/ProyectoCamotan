<script setup>
// Botón del menú para instalar el sistema como aplicación en la tablet o la
// computadora. Solo aparece si todavía no está instalada.
import { ref, computed } from 'vue';
import { usarInstalacion } from '../../dominio/instalacion';
import Icono from './Icono.vue';

const { aviso, instalada, esApple, instalar } = usarInstalacion();
const ayuda = ref(false);
const visible = computed(() => !instalada.value && (aviso.value || esApple));

async function tocar() {
  if (!(await instalar())) ayuda.value = true;
}
</script>

<template>
  <div v-if="visible" class="border-t border-linea px-3 py-3">
    <button type="button" class="menu-enlace boton-instalar flex min-h-tocable w-full items-center gap-3 px-3 py-2.5" @click="tocar">
      <Icono nombre="descargar" :tamano="20" class="shrink-0" />
      <span class="truncate">Instalar en este equipo</span>
    </button>

    <div v-if="ayuda" class="fixed inset-0 z-[60] flex items-center justify-center bg-tinta/40 px-4" @click.self="ayuda = false">
      <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
        <h2 class="font-titulo text-lg font-bold text-tinta">Instalar en el iPad</h2>
        <ol class="mt-3 list-decimal space-y-2 pl-5 text-tinta-2">
          <li>Abra el sistema en <strong>Safari</strong>.</li>
          <li>Toque <strong>Compartir</strong> (el cuadro con la flecha hacia arriba).</li>
          <li>Elija <strong>Agregar a inicio</strong> y luego <strong>Agregar</strong>.</li>
        </ol>
        <button type="button" class="boton-primario mt-5 w-full" @click="ayuda = false">Entendido</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.boton-instalar { border-radius: 12px; background: #EEF2FA; color: #172A5A; font-weight: 800; }
.boton-instalar:hover { background: #DCE4F5; }
</style>
