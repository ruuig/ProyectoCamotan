<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Icono from '../comunes/Icono.vue';
import { cierre, nombrePeriodo, periodoPrevio, periodoActual } from '../../dominio/bodega';

/**
 * Encabezado de Consumo de puestos, Inventario de cierre y BRES: el nombre, su
 * estado y el mes que se cierra (el mismo mes para las tres). Cada una tiene su
 * entrada en el menú; aquí no se repiten como pasos.
 */
const props = defineProps({ estado: { type: Object, default: () => ({}) } }); // { informes: '18 de 30' }

const route = useRoute();
const PANTALLAS = {
  'informes-servicios': { titulo: 'Consumo de puestos', clave: 'informes' },
  'inventario-cierre': { titulo: 'Inventario de cierre', clave: 'inventario' },
  bres: { titulo: 'BRES', clave: 'bres' },
};
const pantalla = computed(() => PANTALLAS[route.name] ?? { titulo: 'Cierre del mes', clave: '' });
const estadoTexto = computed(() => props.estado[pantalla.value.clave] ?? '');

function siguiente(p) {
  const [a, m] = p.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}
const puedeAvanzar = computed(() => cierre.periodo < periodoActual());
const titulo = computed(() => {
  const t = nombrePeriodo(cierre.periodo);
  return t[0].toUpperCase() + t.slice(1);
});
</script>

<template>
  <div>
    <header class="b-cabecera">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="b-titulo">{{ pantalla.titulo }}</h1>
        <div class="selector-mes" role="group" aria-label="Mes que se cierra">
          <button type="button" aria-label="Mes anterior" @click="cierre.periodo = periodoPrevio(cierre.periodo)"><Icono nombre="volver" :tamano="20" :grosor="2.2" /></button>
          <span>{{ titulo }}</span>
          <button type="button" aria-label="Mes siguiente" :disabled="!puedeAvanzar" @click="cierre.periodo = siguiente(cierre.periodo)"><Icono nombre="irA" :tamano="20" :grosor="2.2" /></button>
        </div>
        <span v-if="estadoTexto" class="estado">{{ estadoTexto }}</span>
      </div>
      <div class="b-acciones"><slot name="acciones" /></div>
    </header>
  </div>
</template>

<style scoped>
.estado { padding: 4px 12px; border-radius: 10px; background: #EAF3FB; color: #174E80; font-size: 14px; font-weight: 800; }
.selector-mes { display: inline-flex; align-items: center; height: 44px; border: 2px solid #CBD5E1; border-radius: 12px; overflow: hidden; }
.selector-mes span { min-width: 170px; padding: 0 12px; text-align: center; font-weight: 700; font-size: 16px; color: #14244A; }
.selector-mes button { display: grid; place-items: center; width: 40px; height: 100%; color: #172A5A; }
.selector-mes button:hover:not(:disabled) { background: #EEF2FF; }
.selector-mes button:disabled { color: #CBD5E1; cursor: not-allowed; }
</style>
