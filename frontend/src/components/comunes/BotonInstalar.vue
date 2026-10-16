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
    <button type="button" class="boton-instalar" @click="tocar">
      <span class="ic"><Icono nombre="descargar" :tamano="17" /></span>
      <span><strong>Instalar la app</strong><small>Acceso directo, pantalla completa</small></span>
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
.boton-instalar { display: flex; align-items: center; gap: .7rem; width: 100%; padding: .65rem .8rem; border-radius: 12px; text-align: left;
  border: 1px dashed #4A9BD6; background: #EAF4FB; color: #172A5A; }
.boton-instalar:hover { background: #DCECF8; }
.boton-instalar .ic { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border-radius: 10px; background: #172A5A; color: #fff; }
.boton-instalar strong { display: block; font-size: .9rem; font-weight: 800; }
.boton-instalar small { font-size: .78rem; color: #64748B; font-weight: 600; }
</style>
