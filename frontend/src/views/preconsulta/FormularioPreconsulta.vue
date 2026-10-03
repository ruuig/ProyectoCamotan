<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/pacientes';
import { useSincronizacionStore } from '../../stores/sincronizacion';
import Icono from '../../components/comunes/Icono.vue';
import Etiqueta from '../../components/comunes/Etiqueta.vue';
import {
  alternar,
  convertir,
  equivalencia,
  unidadRecordada,
  recordarUnidad,
} from '../../dominio/unidadesPeso';

const route = useRoute();
const router = useRouter();
const sync = useSincronizacionStore();
const encolada = ref(false);

const signos = ref([]);
const seleccionados = ref([]);
const error = ref('');
const detallesError = ref([]);
const guardando = ref(false);
const resultado = ref(null);
const justificacion = ref('');
const gravedadElegida = ref('');

// El motivo se pregunta aqui, que es el mismo momento en que se toman los
// signos. Pedirlo antes obligaba a entrar al expediente primero.
const motivoConsulta = ref('');

const medicion = reactive({
  peso: '', talla: '', temperatura: '', presionSis: '', presionDia: '',
  frecCardiaca: '', frecRespiratoria: '', satOxigeno: '',
  perimetroBraquial: '', perimetroCefalico: '',
});

/*
 * Unidad del peso.
 *
 * No todas las básculas del centro son de kilogramos. Empieza en la última
 * que se usó en esta tablet: si volviera a kilogramos cada vez, quien trabaja
 * con una báscula de libras tendría que tocar el botón en cada paciente.
 */
const unidadPeso = ref(unidadRecordada());

/** Convierte lo ya escrito en lugar de limpiarlo. */
function cambiarUnidadPeso() {
  const destino = alternar(unidadPeso.value);
  medicion.peso = convertir(medicion.peso, unidadPeso.value, destino);
  unidadPeso.value = destino;
  recordarUnidad(destino);
}

// La equivalencia se muestra para poder verificar lo que se va a guardar.
const pesoEquivalente = computed(() => equivalencia(medicion.peso, unidadPeso.value));

// Semaforo: rojo lo que exige accion inmediata, ambar lo que exige seguimiento.
const COLOR_CLASIFICACION = {
  desnutricion_aguda_severa: 'border-urgente-300 bg-slate-50 text-urgente-900',
  desnutricion_aguda_moderada: 'border-orange-300 bg-orange-50 text-orange-900',
  desnutricion_cronica: 'border-atencion-300 bg-slate-50 text-atencion-900',
  riesgo: 'border-yellow-300 bg-yellow-50 text-yellow-900',
  sobrepeso: 'border-sky-300 bg-sky-50 text-sky-900',
  normal: 'border-estable-300 bg-slate-50 text-estable-900',
};

// Agrupados por como se toman en la practica, no como columnas de una tabla.
const GRUPOS_CAMPOS = [
  {
    titulo: 'Antropometría',
    icono: 'crecimiento',
    // El peso se captura aparte, con su selector de unidad.
    campos: [
      { clave: 'talla', etiqueta: 'Talla', unidad: 'cm', paso: '0.1' },
    ],
  },
  {
    titulo: 'Signos vitales',
    icono: 'alerta',
    campos: [
      { clave: 'temperatura', etiqueta: 'Temperatura', unidad: '°C', paso: '0.1' },
      { clave: 'frecCardiaca', etiqueta: 'Frec. cardíaca', unidad: 'lpm', paso: '1' },
      { clave: 'frecRespiratoria', etiqueta: 'Frec. respiratoria', unidad: 'rpm', paso: '1' },
      { clave: 'satOxigeno', etiqueta: 'Saturación O2', unidad: '%', paso: '1' },
      { clave: 'presionSis', etiqueta: 'Presión sistólica', unidad: '', paso: '1' },
      { clave: 'presionDia', etiqueta: 'Presión diastólica', unidad: '', paso: '1' },
    ],
  },
  {
    titulo: 'Solo en menores de 5 años',
    icono: 'pacientes',
    nota: 'El perímetro braquial es el indicador mas directo de desnutrición aguda.',
    campos: [
      { clave: 'perimetroBraquial', etiqueta: 'Perim. braquial', unidad: 'mm', paso: '1' },
      { clave: 'perimetroCefalico', etiqueta: 'Perim. cefálico', unidad: 'cm', paso: '0.1' },
    ],
  },
];

const signoPorCodigo = computed(() => new Map(signos.value.map((s) => [s.codigo, s])));

const gravedadSugerida = computed(() => {
  const marcados = seleccionados.value.map((c) => signoPorCodigo.value.get(c)).filter(Boolean);
  if (marcados.some((s) => s.gravedadSugerida === 'urgente')) return 'urgente';
  return marcados.length > 0 ? 'moderado' : null;
});

const requiereJustificacion = computed(
  () => gravedadSugerida.value === 'urgente' && gravedadElegida.value && gravedadElegida.value !== 'urgente',
);

function soloConValor() {
  const datos = {};
  for (const [clave, valor] of Object.entries(medicion)) {
    if (valor !== '' && valor !== null) datos[clave] = Number(valor);
  }
  // Se manda el número tal como se escribió y en qué unidad. El servidor lo
  // convierte: así lo que queda grabado no depende de este navegador.
  if (datos.peso !== undefined) datos.unidadPeso = unidadPeso.value;
  datos.motivoConsulta = motivoConsulta.value.trim();
  return datos;
}

async function guardar() {
  error.value = '';
  detallesError.value = [];
  guardando.value = true;

  try {
    // Si cae la red, se encola en lugar de perderse.
    const envio = await sync.enviar({
      metodo: 'POST',
      ruta: `/atenciones/${route.params.id}/preconsulta`,
      cuerpo: {
        ...soloConValor(),
        signosPeligro: seleccionados.value,
        ...(gravedadElegida.value ? { gravedad: gravedadElegida.value } : {}),
        ...(justificacion.value ? { justificacionGravedad: justificacion.value } : {}),
      },
      descripcion: 'Preconsulta',
    });

    if (envio.encolada) {
      encolada.value = true;
      return;
    }
    resultado.value = envio.respuesta;
  } catch (fallo) {
    error.value = fallo.message;
    detallesError.value = Array.isArray(fallo.detalles) ? fallo.detalles : [];
  } finally {
    guardando.value = false;
  }
}

onMounted(async () => {
  try {
    const datos = await servicio.signosPeligro();
    signos.value = datos.signos;
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <section class="mx-auto max-w-5xl space-y-4">
    <!-- Guardada sin conexion -->
    <div
      v-if="encolada"
      class="rounded-xl border-l-4 border-slate-500 bg-white p-6 border border-slate-200"
      role="status"
    >
      <div class="flex items-start gap-3">
        <Icono nombre="sinConexion" :tamano="26" class="mt-0.5 text-slate-500" />
        <div>
          <p class="text-lg font-semibold text-slate-800">Guardada en este equipo</p>
          <p class="mt-1 text-slate-600">
            No hay conexión. Se enviara sola al volver la red. El puntaje Z y las alertas se
            calcularan al enviarse.
          </p>
          <button
            type="button"
            class="mt-4 flex items-center gap-2 rounded-lg bg-mspas-700 px-4 py-2.5
                   text-sm font-semibold text-white transition hover:bg-mspas-700"
            @click="router.push('/cola')"
          >
            <Icono nombre="cola" :tamano="17" /> Volver a la cola
          </button>
        </div>
      </div>
    </div>

    <!-- Resultado: la informacion derivada aparece donde se toma la decision -->
    <template v-else-if="resultado">
      <div class="rounded-xl border-l-4 border-estable-500 bg-white p-5 border border-slate-200">
        <div class="flex items-center gap-3">
          <Icono nombre="correcto" :tamano="26" class="text-estable-600" />
          <div>
            <p class="text-lg font-semibold text-estable-900">Preconsulta registrada</p>
            <p class="text-slate-600">
              Gravedad asignada:
              <strong class="uppercase">{{ resultado.gravedad }}</strong>
            </p>
          </div>
        </div>
      </div>

      <!--
        Regla de las fichas oficiales: ante un signo de peligro, además de la
        gravedad urgente, el sistema ofrece abrir la boleta de referencia.
        Ofrece, no obliga: quien atiende decide si refiere.
      -->
      <div
        v-if="seleccionados.length > 0"
        class="tarjeta border-l-4 border-l-urgente-500 p-5"
      >
        <div class="flex items-start gap-3">
          <Icono nombre="alerta" :tamano="26" class="mt-0.5 shrink-0 text-urgente-600" />
          <div class="min-w-0 flex-1">
            <p class="text-lg font-semibold text-urgente-900">
              Se marcó {{ seleccionados.length }} signo(s) de peligro
            </p>
            <p class="mt-1 text-slate-700">
              Las fichas oficiales indican tomar signos vitales, estabilizar, registrar y
              llenar la boleta de referencia.
            </p>
            <RouterLink
              :to="`/imprimir/referencia/${$route.params.id}`"
              target="_blank"
              class="boton-primario mt-3"
            >
              <Icono nombre="irA" :tamano="18" /> Abrir boleta de referencia
            </RouterLink>
          </div>
        </div>
      </div>

      <!-- Puntaje Z al momento de capturar peso y talla -->
      <div
        v-if="resultado.antropometria?.clasificacion"
        class="rounded-xl border-l-4 p-5 border border-slate-200"
        :class="COLOR_CLASIFICACION[resultado.antropometria.clasificacion]"
      >
        <div class="flex items-start gap-3">
          <Icono nombre="crecimiento" :tamano="26" class="mt-0.5 shrink-0" />
          <div class="min-w-0">
            <p class="text-lg font-bold">{{ resultado.antropometria.etiquetaClasificacion }}</p>
            <div class="mt-2 flex flex-wrap gap-4 text-sm">
              <span>
                Peso para la talla:
                <strong class="tabular-nums">
                  {{ resultado.antropometria.registro.zPesoTalla ?? '—' }} DE
                </strong>
              </span>
              <span>
                Talla para la edad:
                <strong class="tabular-nums">
                  {{ resultado.antropometria.registro.zTallaEdad ?? '—' }} DE
                </strong>
              </span>
            </div>
            <p v-if="resultado.antropometria.comparacion?.descensoRelevante" class="mt-2 font-semibold">
              Descenso de {{ Math.abs(resultado.antropometria.comparacion.diferencia) }} DE
              respecto a la medición anterior.
            </p>
            <p v-for="aviso in resultado.antropometria.avisos" :key="aviso" class="mt-1 text-sm italic">
              {{ aviso }}
            </p>
          </div>
        </div>
      </div>

      <div
        v-if="resultado.hallazgos.length > 0"
        class="tarjeta p-5"
      >
        <p class="mb-3 flex items-center gap-2 font-semibold text-slate-800">
          <Icono nombre="alerta" :tamano="20" class="text-atencion-600" />
          Valores fuera de rango para la edad
        </p>
        <ul class="space-y-1.5">
          <li
            v-for="h in resultado.hallazgos"
            :key="h.campo"
            class="flex items-start gap-2.5 rounded-r-lg border-l-4 px-3.5 py-2 text-sm font-medium"
            :class="h.severidad === 'alta'
              ? 'border-urgente-500 bg-slate-50 text-urgente-900'
              : 'border-atencion-500 bg-slate-50 text-atencion-900'"
          >
            <Icono nombre="alerta" :tamano="17" class="mt-0.5 shrink-0" />
            {{ h.mensaje }}
          </li>
        </ul>
      </div>
      <div
        v-else
        class="flex items-center gap-2 rounded-xl bg-white px-5 py-4 border border-slate-200"
      >
        <Icono nombre="correcto" :tamano="20" class="text-estable-600" />
        <p class="text-slate-700">Todos los signos vitales están dentro de rango para la edad.</p>
      </div>

      <button
        type="button"
        class="flex items-center gap-2 rounded-lg bg-mspas-700 px-5 py-3 font-semibold
               text-white transition hover:bg-mspas-700"
        @click="router.push('/cola')"
      >
        <Icono nombre="cola" :tamano="18" /> Volver a la cola
      </button>
    </template>

    <!-- Formulario -->
    <form v-else class="space-y-4" @submit.prevent="guardar">
      <div>
        <h1 class="titulo-pagina">Registrar preconsulta</h1>
        <p class="text-slate-500">
          Deje en blanco lo que no se midió.
        </p>
      </div>

      <!-- Motivo: lo primero que se pregunta al paciente -->
      <div class="tarjeta p-5">
        <label for="motivoConsulta" class="etiqueta-campo">Motivo de consulta</label>
        <input
          id="motivoConsulta"
          v-model="motivoConsulta"
          required
          maxlength="500"
          placeholder="Por qué viene hoy"
          class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-lg text-slate-900
                 outline-none transition focus:border-celeste-400 focus:ring-2 focus:ring-mspas-200"
        />
      </div>

      <!-- Peso: la báscula puede ser de libras o de kilogramos -->
      <div class="tarjeta p-5">
        <h2 class="panel-titulo mb-3">
          <Icono nombre="crecimiento" :tamano="19" class="text-celeste-400" />
          Peso
        </h2>

        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[9rem] flex-1">
            <label for="peso" class="etiqueta-campo">
              Peso <span class="font-normal text-slate-400">({{ unidadPeso }})</span>
            </label>
            <input
              id="peso"
              v-model="medicion.peso"
              type="number"
              step="0.01"
              inputmode="decimal"
              class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-lg tabular-nums
                     text-slate-900 outline-none transition focus:border-celeste-400
                     focus:ring-2 focus:ring-mspas-200"
            />
          </div>

          <!-- Al cambiar de unidad se convierte lo escrito, no se borra -->
          <button
            type="button"
            class="min-h-tocable shrink-0 rounded-control border border-linea bg-superficie px-5
                   font-bold text-tinta transition hover:border-marino-apagado"
            :aria-label="`Cambiar a ${alternar(unidadPeso)}`"
            @click="cambiarUnidadPeso"
          >
            {{ unidadPeso }} &rarr; {{ alternar(unidadPeso) }}
          </button>

          <p v-if="pesoEquivalente" class="min-h-tocable shrink-0 self-end py-2.5 text-apagado">
            = {{ pesoEquivalente }}
          </p>
        </div>

        <p class="mt-2 text-sm text-apagado">
          Se guarda siempre en kilogramos.
        </p>
      </div>

      <div
        v-for="grupo in GRUPOS_CAMPOS"
        :key="grupo.titulo"
        class="tarjeta p-5"
      >
        <div class="mb-3">
          <h2 class="panel-titulo">
            <Icono :nombre="grupo.icono" :tamano="19" class="text-celeste-400" />
            {{ grupo.titulo }}
          </h2>
          <p v-if="grupo.nota" class="mt-0.5 text-slate-500">{{ grupo.nota }}</p>
        </div>

        <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div v-for="campo in grupo.campos" :key="campo.clave">
            <label :for="campo.clave" class="etiqueta-campo">
              {{ campo.etiqueta }}
              <span v-if="campo.unidad" class="font-normal text-slate-400">({{ campo.unidad }})</span>
            </label>
            <input
              :id="campo.clave"
              v-model="medicion[campo.clave]"
              type="number"
              :step="campo.paso"
              inputmode="decimal"
              class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-lg tabular-nums
                     text-slate-900 outline-none transition focus:border-celeste-400
                     focus:ring-2 focus:ring-mspas-200"
            />
          </div>
        </div>
      </div>

      <!-- Signos de peligro: el catalogo viene de la tabla configurable -->
      <div class="tarjeta p-5">
        <h2 class="mb-1 flex items-center gap-2 font-semibold text-mspas-700">
          <Icono nombre="escudo" :tamano="20" class="text-celeste-400" />
          Signos de peligro
          <span v-if="seleccionados.length > 0" class="ml-1">
            <Etiqueta tono="urgente">{{ seleccionados.length }} marcado(s)</Etiqueta>
          </span>
        </h2>
        <p class="mb-3 text-slate-500">
          Marque todo lo que observe. Los urgentes elevan la prioridad automáticamente.
        </p>

        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="signo in signos"
            :key="signo.id"
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition"
            :class="seleccionados.includes(signo.codigo)
              ? 'border-mspas-700 bg-slate-50'
              : 'border-slate-200 hover:border-mspas-300 hover:bg-slate-50'"
          >
            <input
              v-model="seleccionados"
              type="checkbox"
              :value="signo.codigo"
              class="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-mspas-700
                     focus:ring-celeste-300"
            />
            <span class="min-w-0">
              <span class="font-medium text-slate-800">{{ signo.descripcion }}</span>
              <span v-if="signo.grupoEtario !== 'todos'" class="block text-sm text-slate-500">
                solo en {{ signo.grupoEtario.replace('_', ' ') }}
              </span>
            </span>
          </label>
        </div>
      </div>

      <!-- Gravedad propuesta -->
      <div v-if="gravedadSugerida" class="tarjeta border-l-4 border-l-atencion-500 p-5">
        <p class="flex items-center gap-2 font-semibold text-slate-900">
          <Icono nombre="alerta" :tamano="20" class="text-atencion-600" />
          Gravedad propuesta:
          <span class="capitalize text-atencion-700">{{ gravedadSugerida }}</span>
        </p>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label>
            <span class="etiqueta-campo">Gravedad a registrar</span>
            <select v-model="gravedadElegida" class="campo">
              <option value="">Usar la propuesta ({{ gravedadSugerida }})</option>
              <option value="urgente">Urgente</option>
              <option value="moderado">Moderado</option>
              <option value="leve">Leve</option>
            </select>
          </label>

          <label v-if="requiereJustificacion">
            <span class="etiqueta-campo">Justificación obligatoria (mínimo 10 caracteres)</span>
            <textarea v-model="justificacion" rows="2" required class="campo" />
          </label>
        </div>
      </div>

      <div v-if="error" role="alert" class="aviso aviso-urgente">
        <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-urgente-600" />
        <div>
          <p class="font-medium text-slate-900">{{ error }}</p>
          <ul
            v-if="detallesError.length && detallesError[0].campo"
            class="mt-1.5 list-inside list-disc text-slate-600"
          >
            <li v-for="d in detallesError" :key="d.campo">{{ d.campo }}: {{ d.mensaje }}</li>
          </ul>
        </div>
      </div>

      <div class="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button type="submit" :disabled="guardando" class="boton-primario w-full sm:w-auto">
          <Icono nombre="guardar" :tamano="19" />
          {{ guardando ? 'Guardando...' : 'Registrar preconsulta' }}
        </button>
      </div>
    </form>
  </section>
</template>
