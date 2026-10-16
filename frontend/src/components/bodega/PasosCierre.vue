<script setup>
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import Icono from '../comunes/Icono.vue';
import { cierre, nombrePeriodo, periodoPrevio, periodoActual } from '../../dominio/bodega';

/** Encabezado del cierre del mes: el mes que se cierra y sus tres pasos. */
defineProps({ estado: { type: Object, default: () => ({}) } }); // { informes: '18/30' }

const route = useRoute();
const PASOS = [
  { ruta: 'informes-servicios', a: '/inventario/informes', texto: 'Informes de servicios', clave: 'informes' },
  { ruta: 'inventario-cierre', a: '/inventario/cierre', texto: 'Inventario de cierre', clave: 'inventario' },
  { ruta: 'bres', a: '/inventario/bres', texto: 'BRES', clave: 'bres' },
];

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
  <div class="space-y-4">
    <header class="b-cabecera">
      <div class="flex items-center gap-3">
        <h1 class="b-titulo">Cierre del mes</h1>
        <div class="selector-mes" role="group" aria-label="Mes que se cierra">
          <button type="button" aria-label="Mes anterior" @click="cierre.periodo = periodoPrevio(cierre.periodo)"><Icono nombre="volver" :tamano="20" :grosor="2.2" /></button>
          <span>{{ titulo }}</span>
          <button type="button" aria-label="Mes siguiente" :disabled="!puedeAvanzar" @click="cierre.periodo = siguiente(cierre.periodo)"><Icono nombre="irA" :tamano="20" :grosor="2.2" /></button>
        </div>
      </div>
      <div class="b-acciones"><slot name="acciones" /></div>
    </header>

    <nav class="b-pasos" aria-label="Pasos del cierre">
      <RouterLink
        v-for="(p, i) in PASOS"
        :key="p.ruta"
        :to="p.a"
        class="b-paso"
        :class="route.name === p.ruta ? 'on' : ''"
        :aria-current="route.name === p.ruta ? 'step' : undefined"
      >
        <span class="num">{{ i + 1 }}</span>
        <span class="txt">
          <b>{{ p.texto }}</b>
          <small v-if="estado[p.clave]">{{ estado[p.clave] }}</small>
        </span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.selector-mes { display: inline-flex; align-items: center; height: 44px; border: 2px solid #CBD5E1; border-radius: 12px; overflow: hidden; }
.selector-mes span { min-width: 170px; padding: 0 12px; text-align: center; font-weight: 700; font-size: 16px; color: #14244A; }
.selector-mes button { display: grid; place-items: center; width: 40px; height: 100%; color: #172A5A; }
.selector-mes button:hover:not(:disabled) { background: #EEF2FF; }
.selector-mes button:disabled { color: #CBD5E1; cursor: not-allowed; }
</style>
