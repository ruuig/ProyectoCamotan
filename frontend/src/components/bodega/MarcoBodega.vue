<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import { useAuthStore } from '../../stores/auth';

/** Marco de la bodega: las pestañas tipo carpeta y la pantalla de cada una. */
const route = useRoute();

const PESTANAS = [
  // Primero lo que se hace (hoy, recibir, entregar, cerrar), después lo que se consulta.
  { clave: 'hoy', texto: 'Hoy', a: '/inventario/hoy', rutas: ['bodega-hoy'] },
  { clave: 'recibir', texto: 'Recibir', a: '/inventario/recibir', rutas: ['recibir'] },
  { clave: 'requisiciones', texto: 'Requisiciones', a: '/inventario/requisiciones', rutas: ['requisiciones'] },
  { clave: 'cierre', texto: 'Cierre del mes', a: '/inventario/reportes', rutas: ['reportes-servicios', 'inventario-cierre', 'bres'] },
  { clave: 'existencias', texto: 'Existencias', a: '/inventario', rutas: ['inventario', 'insumo-detalle', 'lote-detalle', 'insumo-nuevo'] },
  { clave: 'kardex', texto: 'Kardex', a: '/inventario/kardex', rutas: ['kardex'] },
  { clave: 'vencimientos', texto: 'Vencimientos', a: '/inventario/semaforo', rutas: ['semaforo'] },
  { clave: 'trazabilidad', texto: 'Trazabilidad', a: '/inventario/trazabilidad', rutas: ['trazabilidad'] },
];

// Farmacia entra solo a sus requisiciones.
const auth = useAuthStore();
const visibles = computed(() => (auth.rol === 'farmacia' ? PESTANAS.filter((p) => p.clave === 'requisiciones') : PESTANAS));

const activa = computed(() => PESTANAS.find((p) => p.rutas.includes(route.name))?.clave ?? 'hoy');

const porVencer = ref(0);
onMounted(async () => {
  if (auth.rol === 'farmacia') return;
  try {
    const s = await bodega.semaforo({});
    porVencer.value = s.resumen.rojo + s.resumen.vencido;
  } catch {
    // El contador es una ayuda: sin él la pestaña funciona igual.
  }
});
</script>

<template>
  <div class="b-hoja">
    <nav class="b-carpetas" aria-label="Bodega">
      <RouterLink
        v-for="p in visibles"
        :key="p.clave"
        :to="p.a"
        class="b-carpeta"
        :class="activa === p.clave ? 'activa' : ''"
        :aria-current="activa === p.clave ? 'page' : undefined"
      >
        {{ p.texto }}
        <span v-if="p.clave === 'vencimientos' && porVencer" class="b-contador rojo">{{ porVencer }}</span>
      </RouterLink>
    </nav>
    <div class="b-cuerpo">
      <RouterView />
    </div>
  </div>
</template>


