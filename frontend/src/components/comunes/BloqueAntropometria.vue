<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import servicio from '../../services/pacientes';
import CurvaCrecimiento from './CurvaCrecimiento.vue';

const props = defineProps({
  pacienteId: { type: [Number, String], required: true },
  edadMeses: { type: Number, required: true },
});

const mediciones = ref([]);
const curva = ref(null);
const indicador = ref('peso_edad');
const error = ref('');

const INDICADORES = [
  { valor: 'peso_edad', etiqueta: 'Peso para la edad' },
  { valor: 'talla_edad', etiqueta: 'Talla para la edad' },
  { valor: 'peso_talla', etiqueta: 'Peso para la talla' },
  { valor: 'imc_edad', etiqueta: 'IMC para la edad' },
];

// Semaforo: rojo lo que exige accion inmediata, ambar lo que exige seguimiento.
const COLOR_CLASIFICACION = {
  desnutricion_aguda_severa: 'bg-urgente-100 text-urgente-700 border-urgente-200',
  desnutricion_aguda_moderada: 'bg-orange-100 text-orange-900 border-orange-300',
  desnutricion_cronica: 'bg-atencion-100 text-atencion-700 border-atencion-200',
  riesgo: 'bg-yellow-100 text-yellow-900 border-yellow-300',
  sobrepeso: 'bg-sky-100 text-sky-900 border-sky-300',
  normal: 'bg-estable-100 text-estable-700 border-estable-200',
};

const ultima = computed(() => mediciones.value[mediciones.value.length - 1] ?? null);

function fecha(valor) {
  return valor ? new Date(valor).toLocaleDateString('es-GT') : '';
}

function z(valor) {
  return valor == null ? '—' : Number(valor).toFixed(2);
}

async function cargarCurva() {
  try {
    curva.value = await servicio.curva(props.pacienteId, indicador.value);
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function cargar() {
  try {
    const datos = await servicio.antropometria(props.pacienteId);
    mediciones.value = datos.mediciones;
    await cargarCurva();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

watch(indicador, cargarCurva);
onMounted(cargar);
</script>

<template>
  <section class="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <h2 class="font-medium text-slate-800">Crecimiento</h2>
      <select
        v-model="indicador"
        class="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        aria-label="Indicador de la curva"
      >
        <option v-for="i in INDICADORES" :key="i.valor" :value="i.valor">{{ i.etiqueta }}</option>
      </select>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente text-slate-700">
      {{ error }}
    </p>

    <p v-if="edadMeses > 60" class="text-slate-500">
      Fuera de los patrones de la OMS (0 a 60 meses).
    </p>

    <template v-else-if="mediciones.length === 0">
      <p class="text-slate-500">
        Sin mediciones.
      </p>
    </template>

    <template v-else>
      <!-- Medicion que se confirmo pese a ser improbable: no clasifica -->
      <div
        v-if="ultima?.improbable"
        class="tarjeta border-l-4 border-l-atencion-500 px-4 py-3"
        role="alert"
      >
        <p class="font-medium text-slate-900">Medición marcada como improbable</p>
        <p class="text-slate-600">
          No se clasifica el estado nutricional a partir de este dato.
          {{ ultima.motivoImprobable }}
        </p>
      </div>

      <!-- Lo primero que se lee es la clasificacion, no la tabla de numeros -->
      <div
        v-else-if="ultima?.clasificacion"
        class="rounded-md border px-3 py-2"
        :class="COLOR_CLASIFICACION[ultima.clasificacion]"
      >
        <p class="font-medium">{{ ultima.etiquetaClasificacion }}</p>
        <p class="text-sm">Medición del {{ fecha(ultima.fecha) }}</p>
      </div>

      <div v-else class="tarjeta border-l-4 border-l-slate-300 px-4 py-3">
        <p class="font-medium text-slate-900">Sin clasificación</p>
        <p class="text-slate-600">
          Sin puntaje Z.
        </p>
      </div>

      <!--
        Cada indicador con su propio puntaje. Antes se mostraba una sola cifra
        (peso para la talla) junto a una etiqueta que podia venir de otro
        indicador, y quedaba "Sobrepeso" al lado de un guion.
      -->
      <ul v-if="ultima?.indicadores" class="grid gap-3 sm:grid-cols-2">
        <li
          v-for="i in ultima.indicadores"
          :key="i.clave"
          class="border-l-4 pl-3"
          :class="i.clave === indicador ? 'border-l-celeste-400' : 'border-l-slate-200'"
        >
          <p class="text-sm text-slate-500">{{ i.etiqueta }}</p>
          <p v-if="i.calculable" class="font-semibold tabular-nums text-slate-800">
            {{ i.z.toFixed(2) }} DE
            <span v-if="i.etiquetaClasificacion" class="font-normal text-slate-600">
              &middot; {{ i.etiquetaClasificacion }}
            </span>
          </p>
          <p v-else class="text-slate-500">
            No calculable
            <span class="block text-sm">{{ i.motivo }}</span>
          </p>
        </li>
      </ul>

      <CurvaCrecimiento v-if="curva" :curva="curva" />

      <details class="text-sm">
        <summary class="cursor-pointer text-slate-600 hover:text-slate-800">
          Ver las {{ mediciones.length }} mediciones
        </summary>
        <table class="mt-2 w-full text-sm">
          <thead class="text-left text-slate-500">
            <tr>
              <th class="py-1 font-medium">Fecha</th>
              <th class="py-1 font-medium">Edad</th>
              <th class="py-1 font-medium">Peso</th>
              <th class="py-1 font-medium">Talla</th>
              <th class="py-1 font-medium">MUAC</th>
              <th class="py-1 font-medium">Z P/T</th>
              <th class="py-1 font-medium">Z T/E</th>
            </tr>
          </thead>
          <tbody class="lista">
            <tr v-for="m in [...mediciones].reverse()" :key="m.id">
              <td class="py-1">{{ fecha(m.fecha) }}</td>
              <td class="py-1">{{ m.edadMeses }} m</td>
              <td class="py-1">{{ Number(m.peso).toFixed(1) }} kg</td>
              <td class="py-1">{{ Number(m.talla).toFixed(1) }} cm</td>
              <td class="py-1">{{ m.perimetroBraquial ? Number(m.perimetroBraquial) + ' mm' : '—' }}</td>
              <td class="py-1">{{ z(m.zPesoTalla) }}</td>
              <td class="py-1">{{ z(m.zTallaEdad) }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </template>
  </section>
</template>
