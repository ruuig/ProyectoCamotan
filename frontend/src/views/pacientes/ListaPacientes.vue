<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import servicio from '../../services/pacientes';
import catalogos from '../../services/catalogos';
import Icono from '../../components/comunes/Icono.vue';

/**
 * Búsqueda de pacientes.
 *
 * Tolera cómo se busca de verdad: sin tildes, con errores de escritura y por
 * el nombre de la madre. Cada resultado dice por qué apareció.
 *
 * La lista está pensada para recorrerse con la vista: el nombre manda, el
 * resto es una sola línea de apoyo, y las marcas de estado solo aparecen
 * cuando dicen algo. Una fila de tres renglones con la misma advertencia
 * repetida en todas deja de ser una advertencia y se vuelve ruido.
 */
const router = useRouter();
const pacientes = ref([]);
const paginacion = ref(null);
const lugares = ref([]);
const cargando = ref(false);
const error = ref('');

const filtros = reactive({
  buscar: '',
  lugarPobladoId: '',
  sexo: '',
  etapa: '',
  edadMinima: '',
  edadMaxima: '',
  embarazoActivo: '',
  fichaIncompleta: '',
  conAlertas: '',
  pagina: 1,
});

const ETAPAS = [
  { valor: 'lactante_ninez', etiqueta: 'Niñez (menor de 10)', corta: 'Niñez' },
  { valor: 'adolescente_joven', etiqueta: 'Adolescencia y juventud (10 a 29)', corta: 'Adolescencia y juventud' },
  { valor: 'adulto', etiqueta: 'Adultez (30 a 59)', corta: 'Adultez' },
  { valor: 'persona_mayor', etiqueta: 'Persona mayor (60 y más)', corta: 'Persona mayor' },
];

/** Cuántos filtros hay puestos, para avisarlo sin tener que abrir el panel. */
const filtrosActivos = computed(
  () =>
    Object.entries(filtros).filter(
      ([clave, valor]) => clave !== 'buscar' && clave !== 'pagina' && valor !== '',
    ).length,
);

function edadLegible(p) {
  const { anios, meses } = p.edad ?? {};
  if (anios == null) return '';
  const texto = anios >= 1
    ? `${anios} ${anios === 1 ? 'año' : 'años'}`
    : `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  return p.fechaNacimientoEstimada ? `${texto} aprox.` : texto;
}

/**
 * Cuánto le falta a la ficha, como número.
 * Un número sí distingue: no es lo mismo que falten dos datos que nueve.
 */
function faltan(p) {
  if (!p.ficha || p.ficha.completa) return null;
  const n = p.ficha.faltantes.length;
  return `faltan ${n} ${n === 1 ? 'dato' : 'datos'}`;
}

async function buscar() {
  cargando.value = true;
  try {
    // Solo viajan los filtros con valor: la API no debe recibir cadenas vacías.
    const parametros = Object.fromEntries(
      Object.entries(filtros).filter(([, v]) => v !== '' && v != null),
    );
    const datos = await servicio.listar(parametros);
    pacientes.value = datos.pacientes;
    paginacion.value = datos.paginacion;
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

// Se busca al escribir, con espera: sin esto cada tecla dispara una consulta.
let temporizador;
watch(
  () => filtros.buscar,
  () => {
    clearTimeout(temporizador);
    filtros.pagina = 1;
    temporizador = setTimeout(buscar, 300);
  },
);

// Los demás filtros se aplican de inmediato.
watch(
  () => [
    filtros.lugarPobladoId, filtros.sexo, filtros.etapa, filtros.edadMinima,
    filtros.edadMaxima, filtros.embarazoActivo, filtros.fichaIncompleta, filtros.conAlertas,
  ],
  () => {
    filtros.pagina = 1;
    buscar();
  },
);

watch(() => filtros.pagina, buscar);

/** Los filtros de sí o no se encienden y se apagan con la misma ficha. */
function alternar(campo) {
  filtros[campo] = filtros[campo] === 'true' ? '' : 'true';
}

function limpiar() {
  Object.assign(filtros, {
    buscar: '', lugarPobladoId: '', sexo: '', etapa: '', edadMinima: '',
    edadMaxima: '', embarazoActivo: '', fichaIncompleta: '', conAlertas: '', pagina: 1,
  });
}

onMounted(async () => {
  await buscar();
  try {
    lugares.value = (await catalogos.lugares()).lugares;
  } catch {
    // El filtro de comunidad queda vacío; la búsqueda por texto sigue sirviendo.
  }
});
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">Pacientes</h1>
        <span v-if="paginacion" class="b-antetitulo">{{ paginacion.total.toLocaleString('en-US') }} {{ paginacion.total === 1 ? 'registrado' : 'registrados' }}</span>
      </div>
      <RouterLink to="/pacientes/nuevo" class="b-btn primario"><Icono nombre="agregar" :tamano="20" /> Registrar paciente</RouterLink>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <!-- Búsqueda y filtros -->
    <div class="b-panel mt-5 p-4">
      <div class="flex flex-wrap gap-3">
        <label class="b-buscar min-w-[260px] flex-1">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="filtros.buscar" type="search" class="b-campo grande" placeholder="Nombre, CUI, expediente o teléfono" aria-label="Buscar paciente" />
        </label>
        <div class="w-full sm:w-[260px]">
          <select v-model="filtros.lugarPobladoId" aria-label="Comunidad" class="b-campo grande">
            <option value="">Todas las comunidades</option>
            <option v-for="l in lugares" :key="l.id" :value="l.id">{{ l.nombre }}{{ l.sector ? ` (${l.sector})` : '' }}</option>
          </select>
        </div>
        <span class="flex items-center gap-2">
          <button type="button" class="b-chip alto" :class="filtros.embarazoActivo === 'true' ? 'on' : ''" @click="alternar('embarazoActivo')">Embarazo</button>
          <button type="button" class="b-chip alto" :class="filtros.conAlertas === 'true' ? 'on' : ''" @click="alternar('conAlertas')">Con alertas</button>
          <button type="button" class="b-chip alto" :class="filtros.fichaIncompleta === 'true' ? 'on' : ''" @click="alternar('fichaIncompleta')">Ficha incompleta</button>
        </span>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <div class="b-segmentado" role="radiogroup" aria-label="Sexo">
          <button v-for="o in [['', 'Todos'], ['F', 'Mujeres'], ['M', 'Hombres']]" :key="o[0]" type="button" role="radio" :aria-checked="filtros.sexo === o[0]" :class="filtros.sexo === o[0] ? 'on' : ''" @click="filtros.sexo = o[0]">{{ o[1] }}</button>
        </div>
        <span class="separador" aria-hidden="true" />
        <button
          v-for="e in ETAPAS"
          :key="e.valor"
          type="button"
          class="b-chip"
          :class="filtros.etapa === e.valor ? 'on' : ''"
          :aria-pressed="filtros.etapa === e.valor"
          @click="filtros.etapa = filtros.etapa === e.valor ? '' : e.valor"
        >
          {{ e.corta }}
        </button>
        <span class="separador" aria-hidden="true" />
        <span class="flex items-center gap-2">
          <span class="text-sm font-bold text-apagado">Edad</span>
          <input v-model="filtros.edadMinima" inputmode="numeric" placeholder="desde" aria-label="Edad desde" class="b-campo num edad" />
          <span class="text-apagado">–</span>
          <input v-model="filtros.edadMaxima" inputmode="numeric" placeholder="hasta" aria-label="Edad hasta" class="b-campo num edad" />
        </span>
        <span class="ml-auto">
          <button v-if="filtrosActivos > 0 || filtros.buscar" type="button" class="b-btn secundario chico" @click="limpiar"><Icono nombre="cerrar" :tamano="16" :grosor="2.2" /> Limpiar</button>
        </span>
      </div>
    </div>

    <!-- Resultados -->
    <div class="b-tabla-marco mt-4">
      <table class="b-tabla resultados">
        <thead>
          <tr>
            <th class="w-[120px]">Código</th>
            <th>Paciente</th>
            <th class="w-[120px]">Edad</th>
            <th class="w-[130px]">Ficha</th>
            <th class="w-[40px]" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pacientes" :key="p.id" class="fila" @click="router.push(`/pacientes/${p.id}`)">
            <td>
              <span class="codigo" :class="p.expedientePapel ? '' : 'sin-papel'">
                <b>{{ p.expedientePapel || p.expediente }}</b>
                <small>{{ p.expedientePapel ? p.expediente : 'sin ficha' }}</small>
              </span>
            </td>
            <td>
              <RouterLink :to="`/pacientes/${p.id}`" class="nombre" @click.stop>{{ p.apellidos }}, {{ p.nombres }}</RouterLink>
              <span v-if="p.embarazoActivo" class="b-estado disponible ml-2">Embarazo</span>
              <span v-if="p.conAlertas" class="b-estado retirado ml-2">Alertas</span>
              <span class="block truncate text-[13px] text-apagado">
                {{ p.comunidad }}<template v-if="p.responsableNombre"> · responsable {{ p.responsableNombre }}</template>
              </span>
              <span v-if="p.razonCoincidencia" class="block truncate text-[13px] font-semibold text-[#1F4FA8]">{{ p.razonCoincidencia }}</span>
            </td>
            <td>
              <span class="block font-semibold tabular-nums text-tinta">{{ edadLegible(p) }}</span>
              <span class="text-[13px] text-apagado">{{ p.sexo === 'M' ? 'Hombre' : 'Mujer' }}</span>
            </td>
            <td>
              <span v-if="faltan(p)" class="b-estado cuarentena">{{ faltan(p) }}</span>
              <span v-else class="b-estado disponible">Completa</span>
            </td>
            <td class="text-apagado"><Icono nombre="irA" :tamano="18" /></td>
          </tr>
          <tr v-if="!cargando && !pacientes.length">
            <td colspan="5" class="b-vacio">Ningún paciente coincide.</td>
          </tr>
          <tr v-if="cargando && !pacientes.length">
            <td colspan="5" class="b-vacio">Buscando…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="paginacion && paginacion.paginas > 1" class="mt-4 flex items-center justify-center gap-3" aria-label="Páginas">
      <button type="button" class="b-btn secundario chico" :disabled="paginacion.pagina <= 1" @click="filtros.pagina -= 1"><Icono nombre="volver" :tamano="16" :grosor="2.2" /> Anterior</button>
      <span class="text-sm font-semibold tabular-nums text-apagado">Página <b class="text-tinta">{{ paginacion.pagina }}</b> de {{ paginacion.paginas }}</span>
      <button type="button" class="b-btn secundario chico" :disabled="paginacion.pagina >= paginacion.paginas" @click="filtros.pagina += 1">Siguiente <Icono nombre="irA" :tamano="16" :grosor="2.2" /></button>
    </nav>
  </section>
</template>

<style scoped>
.grande { height: 52px; font-size: 16px; }
.separador { width: 2px; height: 26px; margin: 0 4px; background: #E2E8F0; }
.edad { width: 76px; height: 38px; }
.b-chip.alto { height: 52px; }
.codigo { display: inline-flex; flex-direction: column; min-width: 92px; padding: 3px 10px; border: 2px solid #172A5A; border-radius: 8px; line-height: 1.15; }
.codigo b { font-size: 18px; font-weight: 700; color: #172A5A; font-variant-numeric: tabular-nums; }
.codigo small { font-size: 11px; font-weight: 600; color: #64748B; font-variant-numeric: tabular-nums; }
.codigo.sin-papel { border-color: #CBD5E1; }
.codigo.sin-papel b { font-size: 14px; }
.resultados .fila { cursor: pointer; }
.resultados td { vertical-align: middle; }
.nombre { font-weight: 700; color: #14244A; }
.nombre:hover { text-decoration: underline; }
</style>
