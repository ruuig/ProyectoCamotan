<script setup>
import { ref, computed } from 'vue';
import Icono from '../../comunes/Icono.vue';
import Pictograma from './Pictograma.vue';
import { estiloCategoria, miles } from './PiezasBodega';

/**
 * Buscador de insumo con lista de coincidencias: reemplaza el desplegable de
 * cientos de opciones. Flechas para moverse, Enter para elegir.
 */
const props = defineProps({
  insumos: { type: Array, required: true }, // [{ id, nombreGenerico, categoria, saldoTotal }]
  placeholder: { type: String, default: 'Buscar insumo' },
});
const emit = defineEmits(['elegir']);

const texto = ref('');
const abierto = ref(false);
const activo = ref(0);

const sinTildes = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const coincidencias = computed(() => {
  const clave = sinTildes(texto.value.trim());
  if (!clave) return [];
  return props.insumos.filter((i) => sinTildes(`${i.nombreGenerico} ${i.codigoInterno ?? ''}`).includes(clave)).slice(0, 8);
});

function elegir(i) {
  emit('elegir', i);
  texto.value = '';
  abierto.value = false;
  activo.value = 0;
}

function cerrarLuego() {
  window.setTimeout(() => { abierto.value = false; }, 150);
}

function tecla(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); activo.value = Math.min(activo.value + 1, coincidencias.value.length - 1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); activo.value = Math.max(activo.value - 1, 0); }
  if (e.key === 'Enter' && coincidencias.value[activo.value]) { e.preventDefault(); elegir(coincidencias.value[activo.value]); }
  if (e.key === 'Escape') abierto.value = false;
}
</script>

<template>
  <div class="relative">
    <label class="b-buscar block">
      <Icono nombre="buscar" :tamano="20" />
      <input
        v-model="texto"
        type="search"
        class="b-campo"
        :placeholder="placeholder"
        :aria-label="placeholder"
        autocomplete="off"
        @focus="abierto = true"
        @input="abierto = true; activo = 0"
        @keydown="tecla"
        @blur="cerrarLuego"
      />
    </label>
    <ul v-if="abierto && coincidencias.length" class="lista" role="listbox">
      <li v-for="(i, k) in coincidencias" :key="i.id" role="option" :aria-selected="k === activo">
        <button type="button" class="opcion" :class="k === activo ? 'on' : ''" :style="estiloCategoria(i.categoria)" @mousedown.prevent="elegir(i)" @mouseenter="activo = k">
          <span class="cat-mini"><Pictograma :categoria="i.categoria ?? 'medicamentos'" :grosor="2" /></span>
          <span class="min-w-0 flex-1 nombre-completo font-semibold text-tinta">{{ i.nombreGenerico }}</span>
          <span class="whitespace-nowrap text-[13px] font-semibold tabular-nums text-apagado">hay {{ miles(i.saldoTotal) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.lista { position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px); max-height: 340px; overflow-y: auto; padding: 4px; background: #fff; border: 2px solid #172A5A; border-radius: 12px; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, .35); }
.opcion { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 10px; border-radius: 8px; text-align: left; }
.opcion.on { background: #EEF2FF; }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 26px; height: 26px; border-radius: 7px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 16px; height: 16px; }
/* --- Relieve (estilo duo) --- */
.lista { border-bottom-width: 4px; border-radius: 16px; }
.opcion { border-radius: 10px; }
</style>
