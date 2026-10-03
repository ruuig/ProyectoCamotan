<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import servicio from '../../services/atenciones';
import Icono from '../comunes/Icono.vue';

/**
 * Una fila de la impresión clínica: descripción y CIE-10.
 *
 * Al escribir busca en el catálogo CIE-10 (con sinónimos) y en los
 * diagnósticos que ya se usaron en el centro. Elegir uno llena los dos
 * campos; también se puede escribir a mano, y el código queda pendiente si
 * no se tiene.
 */
const props = defineProps({
  modelValue: { type: Object, required: true },
  numero: { type: Number, required: true },
  quitable: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'quitar']);

const resultados = ref([]);
const abierto = ref(false);
const activo = ref(-1);
let temporizador = null;
let ultimaBusqueda = '';

function actualizar(cambios) {
  emit('update:modelValue', { ...props.modelValue, ...cambios });
}

watch(() => props.modelValue.descripcion, (texto) => {
  clearTimeout(temporizador);
  const q = (texto ?? '').trim();
  if (q.length < 2 || q === ultimaBusqueda) {
    if (q.length < 2) resultados.value = [];
    return;
  }
  temporizador = setTimeout(async () => {
    try {
      ultimaBusqueda = q;
      resultados.value = (await servicio.buscarDiagnostico(q)).resultados;
      activo.value = -1;
    } catch {
      resultados.value = [];
    }
  }, 250);
});

onBeforeUnmount(() => clearTimeout(temporizador));

function elegir(r) {
  ultimaBusqueda = r.descripcion;
  actualizar({ descripcion: r.descripcion, cie: r.codigo ?? '' });
  abierto.value = false;
}

function teclado(e) {
  if (!abierto.value || resultados.value.length === 0) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); activo.value = Math.min(activo.value + 1, resultados.value.length - 1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); activo.value = Math.max(activo.value - 1, 0); }
  if (e.key === 'Enter' && activo.value >= 0) { e.preventDefault(); elegir(resultados.value[activo.value]); }
  if (e.key === 'Escape') abierto.value = false;
}

function cerrarLuego() {
  setTimeout(() => { abierto.value = false; }, 150);
}
</script>

<template>
  <div class="grid items-start gap-3 sm:grid-cols-[2rem,1fr,9rem,auto]">
    <span class="hidden pt-3 text-right font-bold tabular-nums text-apagado sm:block">{{ numero }}.</span>

    <div class="relative">
      <label :for="`dx-${numero}`" class="sr-only">Diagnóstico {{ numero }}</label>
      <input
        :id="`dx-${numero}`"
        :value="modelValue.descripcion"
        autocomplete="off"
        role="combobox"
        :aria-expanded="abierto && resultados.length > 0"
        :aria-controls="`dx-lista-${numero}`"
        :placeholder="numero === 1 ? 'Diagnóstico principal' : 'Otro diagnóstico'"
        maxlength="300"
        class="campo"
        @input="actualizar({ descripcion: $event.target.value }); abierto = true"
        @focus="abierto = true"
        @blur="cerrarLuego"
        @keydown="teclado"
      />
      <ul
        v-if="abierto && resultados.length > 0"
        :id="`dx-lista-${numero}`"
        role="listbox"
        class="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-control border border-linea bg-superficie shadow-lg"
      >
        <li
          v-for="(r, i) in resultados"
          :key="`${r.codigo}-${r.descripcion}`"
          role="option"
          :aria-selected="i === activo"
          class="flex cursor-pointer items-baseline gap-3 px-4 py-2.5"
          :class="i === activo ? 'bg-fondo' : 'hover:bg-fondo'"
          @mousedown.prevent="elegir(r)"
        >
          <span class="w-16 shrink-0 font-mono font-bold text-marino">{{ r.codigo ?? '—' }}</span>
          <span class="min-w-0 flex-1 text-tinta">{{ r.descripcion }}</span>
          <span v-if="r.usos" class="shrink-0 text-xs text-apagado">usado {{ r.usos }} {{ r.usos === 1 ? 'vez' : 'veces' }}</span>
        </li>
      </ul>
    </div>

    <div>
      <label :for="`cie-${numero}`" class="sr-only">CIE-10 del diagnóstico {{ numero }}</label>
      <input
        :id="`cie-${numero}`"
        :value="modelValue.cie"
        placeholder="CIE-10"
        maxlength="7"
        class="campo font-mono uppercase"
        @input="actualizar({ cie: $event.target.value.toUpperCase() })"
      />
    </div>

    <button
      v-if="quitable"
      type="button"
      class="flex min-h-tocable items-center justify-center px-2 text-apagado hover:text-empeora"
      :aria-label="`Quitar diagnóstico ${numero}`"
      @click="emit('quitar')"
    >
      <Icono nombre="quitar" :tamano="18" />
    </button>
    <span v-else class="hidden sm:block" />
  </div>
</template>
