<script setup>
import { computed } from 'vue';
import Icono from '../comunes/Icono.vue';
import { nombrePeriodo, periodoPrevio, periodoActual } from '../../dominio/bodega';

/** ‹ Septiembre de 2026 ›: el mismo selector del cierre del mes. */
const periodo = defineModel({ type: String, required: true });
defineProps({ etiqueta: { type: String, default: 'Mes' } });

function siguiente(p) {
  const [a, m] = p.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}
const puedeAvanzar = computed(() => periodo.value < periodoActual());
const enCurso = computed(() => periodo.value === periodoActual());
const titulo = computed(() => {
  const t = nombrePeriodo(periodo.value);
  return t[0].toUpperCase() + t.slice(1);
});
</script>

<template>
  <div class="flex items-center gap-2">
    <div class="selector-mes" role="group" :aria-label="etiqueta">
      <button type="button" aria-label="Mes anterior" @click="periodo = periodoPrevio(periodo)"><Icono nombre="volver" :tamano="20" :grosor="2.2" /></button>
      <span>{{ titulo }}</span>
      <button type="button" aria-label="Mes siguiente" :disabled="!puedeAvanzar" @click="periodo = siguiente(periodo)"><Icono nombre="irA" :tamano="20" :grosor="2.2" /></button>
    </div>
    <span v-if="enCurso" class="en-curso">En curso</span>
  </div>
</template>

<style scoped>
.selector-mes { display: inline-flex; align-items: center; height: 44px; border: 2px solid #CBD5E1; border-radius: 12px; overflow: hidden; }
.selector-mes span { min-width: 170px; padding: 0 12px; text-align: center; font-weight: 700; font-size: 16px; color: #14244A; }
.selector-mes button { display: grid; place-items: center; width: 40px; height: 100%; color: #172A5A; }
.selector-mes button:hover:not(:disabled) { background: #EEF2FF; }
.selector-mes button:disabled { color: #CBD5E1; cursor: not-allowed; }
.en-curso { padding: 3px 10px; border-radius: 999px; background: #FFF4D6; color: #7A4F05; font-size: 13px; font-weight: 700; }
/* --- Relieve (estilo duo) --- */
.selector-mes { border-color: #E2E8F0; border-bottom-width: 4px; border-radius: 14px; background: #fff; }
</style>
