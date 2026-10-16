<script setup>
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import Icono from '../comunes/Icono.vue';

/**
 * Marco de la bodega. El inicio muestra las tareas; cada tarea se abre a
 * pantalla completa con un botón para volver al inicio.
 */
const route = useRoute();
const auth = useAuthStore();
// Bodega navega con el menú de la izquierda; dirección entra por el inicio de
// bodega y vuelve con este botón.
const conVolver = computed(() => route.name !== 'bodega-inicio' && auth.rol === 'admin');
</script>

<template>
  <div>
    <RouterLink v-if="conVolver" to="/inventario" class="volver-bodega no-imprimir">
      <Icono nombre="volver" :tamano="20" :grosor="2.4" /> Bodega
    </RouterLink>
    <div class="b-hoja">
      <div class="b-cuerpo">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<style scoped>
.volver-bodega {
  display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px; height: 48px; padding: 0 20px 0 14px;
  border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 14px; background: #fff; font-size: 17px; font-weight: 800; color: #172A5A;
  transition: transform .06s;
}
.volver-bodega:hover { border-color: #9FCDEC; }
.volver-bodega:active { transform: translateY(2px); border-bottom-width: 2px; }
</style>
