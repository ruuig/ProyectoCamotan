<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import catalogos from '../../services/catalogos';
import Icono from './Icono.vue';

/**
 * Selector de comunidad sobre el catálogo del municipio.
 *
 * Reemplaza el texto libre: escribir "Shalagua" y "Shalaguá" creaba dos
 * comunidades distintas y partía los listados. Aquí se busca y se elige.
 */
const props = defineProps({
  modelValue: { type: [Number, String], default: null },
  // Nombre ya guardado, para mostrarlo mientras se carga el catálogo.
  nombreActual: { type: String, default: '' },
  id: { type: String, default: 'comunidad' },
});

const emit = defineEmits(['update:modelValue']);

const lugares = ref([]);
const texto = ref('');
const abierto = ref(false);
const cargando = ref(false);

const seleccionado = computed(
  () => lugares.value.find((l) => l.id === Number(props.modelValue)) ?? null,
);

// Lo que se muestra en el campo cuando está cerrado.
const etiqueta = computed(() => {
  if (seleccionado.value) return nombreCompleto(seleccionado.value);
  return props.nombreActual;
});

function nombreCompleto(lugar) {
  // El mismo nombre existe en aldeas distintas: sin la aldea no se distinguen.
  return lugar.sector ? `${lugar.nombre} (${lugar.sector})` : lugar.nombre;
}

const filtrados = computed(() => {
  const busca = texto.value.trim().toLowerCase();
  if (!busca) return lugares.value.slice(0, 40);

  const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const clave = sinTildes(busca);

  return lugares.value
    .filter((l) => sinTildes(nombreCompleto(l)).includes(clave))
    .slice(0, 40);
});

async function cargar() {
  cargando.value = true;
  try {
    lugares.value = (await catalogos.lugares()).lugares;
  } finally {
    cargando.value = false;
  }
}

function elegir(lugar) {
  emit('update:modelValue', lugar.id);
  texto.value = '';
  abierto.value = false;
}

// Al abrirlo se muestra la lista completa, no la última búsqueda.
watch(abierto, (valor) => {
  if (valor) texto.value = '';
});

onMounted(cargar);
</script>

<template>
  <div class="relative">
    <button :id="id" type="button" class="b-campo flex items-center justify-between text-left" :class="abierto ? 'abierto' : ''" @click="abierto = !abierto">
      <span class="truncate" :class="etiqueta ? 'text-tinta' : 'text-[#94A3B8]'">{{ etiqueta || 'Elija la comunidad' }}</span>
      <Icono nombre="buscar" :tamano="18" class="shrink-0 text-[#64748B]" />
    </button>

    <div v-if="abierto" class="lista-comunidades">
      <label class="b-buscar block">
        <Icono nombre="buscar" :tamano="20" />
        <input v-model="texto" type="search" placeholder="Escriba para buscar" class="b-campo" autofocus />
      </label>
      <p v-if="cargando" class="b-vacio">Cargando…</p>
      <p v-else-if="filtrados.length === 0" class="b-vacio">Ninguna comunidad coincide.</p>
      <ul v-else class="mt-2 max-h-64 overflow-y-auto">
        <li v-for="l in filtrados" :key="l.id">
          <button type="button" class="opcion" :class="Number(modelValue) === l.id ? 'on' : ''" @click="elegir(l)">
            <span class="font-semibold">{{ l.nombre }}</span>
            <span v-if="l.sector" class="text-sm text-apagado"> · {{ l.sector }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.abierto { border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.lista-comunidades { position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px); padding: 8px; background: #fff; border: 2px solid #172A5A; border-radius: 12px; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, .35); }
.opcion { display: block; width: 100%; min-height: 40px; padding: 8px 12px; border-radius: 8px; text-align: left; color: #14244A; }
.opcion:hover { background: #F1F5F9; }
.opcion.on { background: #EEF2FA; color: #172A5A; }
/* --- Relieve (estilo duo) --- */
.lista-comunidades { border-bottom-width: 4px; border-radius: 16px; }
.opcion { border-radius: 10px; font-weight: 700; }
</style>
