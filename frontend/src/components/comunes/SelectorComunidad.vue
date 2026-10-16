<script setup>
import { ref, computed, onMounted } from 'vue';
import catalogos from '../../services/catalogos';
import Icono from './Icono.vue';

/**
 * Selector de comunidad sobre el catálogo del municipio.
 *
 * Reemplaza el texto libre: escribir "Shalagua" y "Shalaguá" creaba dos
 * comunidades distintas y partía los listados. Se escribe en el mismo campo y
 * las coincidencias aparecen debajo; primero las de Camotán, al final las de
 * otros municipios (pacientes que vienen de fuera).
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
const enfocado = ref(false);
const marcado = ref(0);
const cargando = ref(false);

// Lugares de otros municipios o de Honduras: el catálogo los trae con el nombre del municipio.
const FUERA = /jocot[aá]n|olopa|esquipulas|chiquimula|zacapa|quezaltepeque|san juan ermita|ipala|concepci[oó]n las minas|honduras|cop[aá]n|guatemala/i;
const deFuera = (l) => FUERA.test(l.nombre);

const seleccionado = computed(
  () => lugares.value.find((l) => l.id === Number(props.modelValue)) ?? null,
);

// Lo que se muestra en el campo cuando no se está escribiendo.
const etiqueta = computed(() => {
  if (seleccionado.value) return nombreCompleto(seleccionado.value);
  return props.nombreActual;
});

function nombreCompleto(lugar) {
  // El mismo nombre existe en aldeas distintas: sin la aldea no se distinguen.
  return lugar.sector ? `${lugar.nombre} (${lugar.sector})` : lugar.nombre;
}

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const filtrados = computed(() => {
  const clave = sinTildes(texto.value.trim());
  if (!clave) return [];
  return lugares.value
    .map((l) => ({ l, n: sinTildes(nombreCompleto(l)) }))
    .filter((x) => x.n.includes(clave))
    // Camotán antes que fuera; dentro de cada grupo, lo que empieza con lo escrito primero.
    .sort((a, b) => (deFuera(a.l) - deFuera(b.l)) || (!a.n.startsWith(clave) - !b.n.startsWith(clave)) || a.n.localeCompare(b.n))
    .slice(0, 40)
    .map((x) => x.l);
});

const abierto = computed(() => enfocado.value && texto.value.trim().length > 0);

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
  enfocado.value = false;
}

function alEnfocar() {
  enfocado.value = true;
  texto.value = '';
  marcado.value = 0;
}

// Se espera un momento para que el toque sobre una opción alcance a elegirla.
function alSalir() {
  setTimeout(() => { enfocado.value = false; texto.value = ''; }, 150);
}

function teclado(e) {
  if (!abierto.value || filtrados.value.length === 0) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); marcado.value = Math.min(marcado.value + 1, filtrados.value.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); marcado.value = Math.max(marcado.value - 1, 0); }
  else if (e.key === 'Enter') { e.preventDefault(); elegir(filtrados.value[marcado.value]); }
  else if (e.key === 'Escape') { enfocado.value = false; }
}

onMounted(cargar);
</script>

<template>
  <div class="relative">
    <label class="b-buscar block">
      <Icono nombre="buscar" :tamano="20" />
      <input
        :id="id"
        :value="enfocado ? texto : etiqueta"
        type="text"
        autocomplete="off"
        :placeholder="enfocado && etiqueta ? etiqueta : 'Escriba la comunidad'"
        class="b-campo"
        :class="enfocado ? 'abierto' : ''"
        @focus="alEnfocar"
        @blur="alSalir"
        @input="texto = $event.target.value; marcado = 0"
        @keydown="teclado"
      />
    </label>

    <div v-if="abierto" class="lista-comunidades">
      <p v-if="cargando" class="b-vacio">Cargando…</p>
      <p v-else-if="filtrados.length === 0" class="b-vacio">Ninguna comunidad coincide.</p>
      <ul v-else class="max-h-64 overflow-y-auto">
        <li v-for="(l, i) in filtrados" :key="l.id">
          <button
            type="button"
            class="opcion"
            :class="{ on: Number(modelValue) === l.id, marcado: i === marcado }"
            @mousedown.prevent="elegir(l)"
          >
            <span class="font-semibold">{{ l.nombre }}</span>
            <span v-if="l.sector" class="text-sm text-apagado"> · {{ l.sector }}</span>
            <span v-if="deFuera(l)" class="fuera">otro municipio</span>
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
.opcion:hover, .opcion.marcado { background: #F1F5F9; }
.opcion.on { background: #EEF2FA; color: #172A5A; }
.fuera { margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: #F1F5F9; color: #64748B; font-size: .75rem; font-weight: 700; }
/* --- Relieve (estilo duo) --- */
.lista-comunidades { border-bottom-width: 4px; border-radius: 16px; }
.opcion { border-radius: 10px; font-weight: 700; }
</style>
