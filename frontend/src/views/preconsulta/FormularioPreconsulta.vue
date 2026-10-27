<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/pacientes';
import http from '../../services/http';
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

/*
 * /preconsulta/nueva?paciente=ID: la atención todavía no existe. Se crea al
 * guardar, junto con la preconsulta; si se sale sin guardar, no queda nada en
 * la cola. /preconsulta/ID es una atención ya abierta (de antes o del médico).
 */
const esNueva = computed(() => route.params.id === 'nueva');
const paciente = ref(null);
const cancelando = ref(false);
const motivoCancelacion = ref('');
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

// Pueblo y comunidad lingüística: el SIGSA 3C/S los pide en cada consulta y
// el registro rápido no los pregunta. Si faltan en la ficha, se preguntan aquí
// con un toque; en Camotán casi todos son ch'orti' o mestizos.
const OPCIONES_PUEBLO = [
  { clave: 'chorti', texto: "Maya ch'orti'", pueblo: '2', comunidadLinguistica: '4' },
  { clave: 'maya', texto: 'Maya, otra comunidad', pueblo: '2', comunidadLinguistica: null },
  { clave: 'mestizo', texto: 'Mestizo o ladino', pueblo: '1', comunidadLinguistica: null },
  { clave: 'otro', texto: 'Otro', pueblo: '5', comunidadLinguistica: null },
  { clave: 'no_indica', texto: 'No indica', pueblo: '6', comunidadLinguistica: null },
];
const puebloElegido = ref('');
const faltaPueblo = computed(() => Boolean(paciente.value) && !paciente.value.pueblo);
async function guardarPueblo() {
  const o = OPCIONES_PUEBLO.find((x) => x.clave === puebloElegido.value);
  if (!o || !paciente.value) return;
  try {
    await servicio.actualizar(paciente.value.id, { pueblo: o.pueblo, ...(o.comunidadLinguistica ? { comunidadLinguistica: o.comunidadLinguistica } : {}) });
  } catch {
    // No detiene la atención: el dato se puede completar después en la ficha.
  }
}

// El motivo se pregunta aqui, que es el mismo momento en que se toman los
// signos. Pedirlo antes obligaba a entrar al expediente primero.
const motivoConsulta = ref('');

const medicion = reactive({
  peso: '', talla: '', temperatura: '', presionSis: '', presionDia: '',
  frecCardiaca: '', frecRespiratoria: '', satOxigeno: '',
  perimetroBraquial: '', perimetroCefalico: '', dolor: '', glucosa: '',
});
// Nivel de conciencia (AVPU): no es un número, va aparte.
const conciencia = ref('');
const CONCIENCIA = [
  ['alerta', 'Alerta'], ['confuso', 'Confuso'], ['voz', 'Responde a la voz'], ['dolor', 'Solo al dolor'], ['no_responde', 'No responde'],
];

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

// Solo los signos que aplican al paciente: los de menores de 5, embarazadas o
// adultos mayores no se le muestran a quien no lo es.
const signosDelPaciente = computed(() => {
  const edad = triaje.value?.edadMeses;
  if (edad == null) return signos.value;
  return signos.value.filter((s) => {
    if (s.grupoEtario === 'menor_5') return edad < 60;
    if (s.grupoEtario === 'embarazada') return triaje.value.embarazada;
    if (s.grupoEtario === 'adulto_mayor') return edad >= 720;
    return true;
  });
});

const signoPorCodigo = computed(() => new Map(signos.value.map((s) => [s.codigo, s])));

// --- Triaje en vivo ------------------------------------------------------------------
// Mientras se escriben los signos, el servidor evalúa con los criterios del
// centro (los mismos con que se guardará) y la pantalla va guiando.
const triaje = ref(null);
const evaluando = ref(false);
const sinRed = ref(false);
let temporizadorTriaje;

// Lo que el servidor acepta como posible (atenciones.schema). Fuera de esto
// es un error de digitación: se avisa en el campo y no se evalúa.
const POSIBLE = {
  temperatura: [25, 45, '°C'],
  presionSis: [40, 300, 'mmHg'],
  presionDia: [20, 200, 'mmHg'],
  frecCardiaca: [20, 300, 'lpm'],
  frecRespiratoria: [5, 120, 'rpm'],
  satOxigeno: [0, 100, '%'],
  glucosa: [10, 900, 'mg/dL'],
};
function imposible(campo) {
  const rango = POSIBLE[campo];
  const v = medicion[campo];
  if (!rango || v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= rango[0] && n <= rango[1]) return null;
  return `Revise el número: va de ${rango[0]} a ${rango[1]} ${rango[2]}`;
}
const camposImposibles = computed(() => Object.keys(POSIBLE).filter((c) => imposible(c)));

async function evaluarTriaje() {
  const cuerpo = { ...(esNueva.value ? { pacienteId: Number(route.query.paciente) } : { atencionId: Number(route.params.id) }), signosPeligro: seleccionados.value };
  for (const k of ['temperatura', 'presionSis', 'presionDia', 'frecCardiaca', 'frecRespiratoria', 'satOxigeno', 'dolor', 'glucosa']) {
    if (medicion[k] !== '' && medicion[k] !== null && !imposible(k)) cuerpo[k] = Number(medicion[k]);
  }
  if (conciencia.value) cuerpo.conciencia = conciencia.value;
  evaluando.value = true;
  try {
    triaje.value = await http.post('/atenciones/triaje/evaluar', cuerpo);
    sinRed.value = false;
  } catch (fallo) {
    // Sin red o un valor imposible a medio escribir: se sigue con lo último.
    sinRed.value = fallo.codigo === 'error_red';
  } finally {
    evaluando.value = false;
  }
}
watch([() => ({ ...medicion }), conciencia, seleccionados], () => {
  clearTimeout(temporizadorTriaje);
  temporizadorTriaje = setTimeout(evaluarTriaje, 350);
}, { deep: true });

const RANGO = { leve: 0, moderado: 1, urgente: 2 };
const gravedadSugerida = computed(() => triaje.value?.nivel ?? 'leve');
const gravedadFinal = computed(() => gravedadElegida.value || gravedadSugerida.value);
const requiereJustificacion = computed(() => RANGO[gravedadFinal.value] < RANGO[gravedadSugerida.value]);

/** Lo que dice el triaje de un campo: para pintarlo y explicarlo debajo. */
const motivoDe = (campo) => {
  const claves = campo === 'presionDia' ? ['presionDia', 'presionSis'] : campo === 'presionSis' ? ['presionSis', 'presionDia'] : [campo];
  return triaje.value?.motivos.find((m) => claves.includes(m.campo)) ?? null;
};
const hallazgoDe = (campo) => triaje.value?.hallazgos?.find((h) => h.campo === campo) ?? null;
function tonoCampo(campo) {
  if (imposible(campo)) return 'rojo';
  const m = motivoDe(campo);
  if (m) return m.nivel === 'urgente' ? 'rojo' : 'ambar';
  return hallazgoDe(campo) ? 'aviso' : '';
}
const ESTILO_NIVEL = {
  urgente: { texto: 'Urgente', clase: 'urgente' },
  moderado: { texto: 'Moderado', clase: 'moderado' },
  leve: { texto: 'Leve', clase: 'leve' },
};

function soloConValor() {
  const datos = {};
  for (const [clave, valor] of Object.entries(medicion)) {
    if (valor !== '' && valor !== null) datos[clave] = Number(valor);
  }
  // Se manda el número tal como se escribió y en qué unidad. El servidor lo
  // convierte: así lo que queda grabado no depende de este navegador.
  if (datos.peso !== undefined) datos.unidadPeso = unidadPeso.value;
  if (conciencia.value) datos.conciencia = conciencia.value;
  datos.motivoConsulta = motivoConsulta.value.trim();
  return datos;
}

async function guardar() {
  error.value = '';
  detallesError.value = [];
  if (camposImposibles.value.length) {
    error.value = 'Hay un signo vital con un número que no es posible. Revíselo antes de registrar.';
    return;
  }
  guardando.value = true;

  try {
    // Si cae la red, se encola en lugar de perderse.
    const envio = await sync.enviar({
      metodo: 'POST',
      ruta: esNueva.value ? '/atenciones/con-preconsulta' : `/atenciones/${route.params.id}/preconsulta`,
      cuerpo: {
        ...(esNueva.value ? { pacienteId: Number(route.query.paciente) } : {}),
        ...soloConValor(),
        signosPeligro: seleccionados.value,
        gravedad: gravedadFinal.value,
        ...(justificacion.value ? { justificacionGravedad: justificacion.value } : {}),
      },
      descripcion: 'Preconsulta',
    });

    if (envio.encolada) {
      encolada.value = true;
      return;
    }
    resultado.value = envio.respuesta;
    await guardarPueblo();
  } catch (fallo) {
    error.value = fallo.message;
    detallesError.value = Array.isArray(fallo.detalles) ? fallo.detalles : [];
  } finally {
    guardando.value = false;
  }
}

/** Cancela una atención abierta por error: sale de la cola con su motivo. */
async function cancelarAtencion() {
  error.value = '';
  try {
    await servicio.cancelarAtencion(route.params.id, motivoCancelacion.value.trim());
    router.push('/cola');
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const volver = () => (window.history.length > 1 ? router.back() : router.push('/cola'));

onMounted(async () => {
  try {
    const [datos, p] = await Promise.all([
      servicio.signosPeligroConCache(),
      esNueva.value && route.query.paciente ? servicio.obtenerConCache(route.query.paciente) : null,
    ]);
    signos.value = datos.signos;
    paciente.value = p?.paciente ?? null;
    evaluarTriaje();
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
            Sin conexión: se envía al volver la red.
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
              Signos vitales, estabilizar, registrar y boleta de referencia.
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
    <form v-else class="rejilla-pre" @submit.prevent="guardar">
      <div class="min-w-0 space-y-4">
      <div>
        <h1 class="titulo-pagina">Registrar preconsulta</h1>
        <p v-if="paciente" class="mt-1 text-lg font-semibold text-tinta">
          {{ paciente.nombres }} {{ paciente.apellidos }}
          <span class="font-normal text-apagado">· Exp. {{ paciente.expedientePapel || paciente.expediente }}</span>
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <button v-if="esNueva" type="button" class="b-btn secundario chico" @click="volver">Salir sin abrir la atención</button>
          <button v-else-if="!cancelando" type="button" class="b-btn secundario chico" @click="cancelando = true">Cancelar atención</button>
        </div>
        <div v-if="cancelando" class="tarjeta mt-2 flex flex-wrap items-end gap-3 p-4">
          <div class="min-w-[16rem] flex-1">
            <label for="motivo-cancelar" class="etiqueta-campo">Por qué se cancela</label>
            <input id="motivo-cancelar" v-model="motivoCancelacion" minlength="5" placeholder="Ej.: se abrió por error" class="campo" />
          </div>
          <button type="button" class="b-btn secundario" @click="cancelando = false">No cancelar</button>
          <button type="button" class="b-btn primario" :disabled="motivoCancelacion.trim().length < 5" @click="cancelarAtencion">Cancelar atención</button>
        </div>
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

      <!-- Pueblo: solo si falta en la ficha -->
      <div v-if="faltaPueblo" class="tarjeta p-5">
        <h2 class="panel-titulo">Pueblo</h2>
        <p class="mb-3 text-sm text-apagado">Dato que pide el SIGSA; queda en la ficha.</p>
        <div class="pueblos" role="radiogroup" aria-label="Pueblo">
          <button v-for="o in OPCIONES_PUEBLO" :key="o.clave" type="button" role="radio" :aria-checked="puebloElegido === o.clave" :class="{ on: puebloElegido === o.clave }" @click="puebloElegido = puebloElegido === o.clave ? '' : o.clave">{{ o.texto }}</button>
        </div>
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

        <div class="grid gap-3 sm:grid-cols-3">
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
              class="campo-signo w-full rounded-lg border px-3 py-2.5 text-lg tabular-nums
                     text-slate-900 outline-none transition focus:ring-2 focus:ring-mspas-200"
              :class="tonoCampo(campo.clave)"
            />
            <p v-if="imposible(campo.clave)" class="nota-signo rojo">{{ imposible(campo.clave) }}</p>
            <p v-else-if="motivoDe(campo.clave)" class="nota-signo" :class="tonoCampo(campo.clave)">{{ motivoDe(campo.clave).etiqueta }}</p>
            <p v-else-if="hallazgoDe(campo.clave)" class="nota-signo aviso">{{ hallazgoDe(campo.clave).mensaje }}</p>
          </div>
        </div>
      </div>

      <!-- Estado general: también decide la prioridad -->
      <div class="tarjeta p-5">
        <h2 class="panel-titulo mb-3">
          <Icono nombre="pacientes" :tamano="19" class="text-celeste-400" />
          Estado general
        </h2>
        <div class="space-y-4">
          <fieldset>
            <legend class="etiqueta-campo">Dolor <span class="font-normal text-slate-400">(0 sin dolor · 10 el peor)</span></legend>
            <div class="escala" role="radiogroup" aria-label="Dolor de 0 a 10">
              <button
                v-for="n in 11"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="String(medicion.dolor) === String(n - 1)"
                :class="[String(medicion.dolor) === String(n - 1) ? 'on' : '', n - 1 >= 8 ? 'alto' : n - 1 >= 5 ? 'medio' : '']"
                @click="medicion.dolor = String(medicion.dolor) === String(n - 1) ? '' : n - 1"
              >{{ n - 1 }}</button>
            </div>
            <p v-if="motivoDe('dolor')" class="nota-signo" :class="tonoCampo('dolor')">{{ motivoDe('dolor').etiqueta }}</p>
          </fieldset>
          <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <fieldset>
              <legend class="etiqueta-campo">Nivel de conciencia</legend>
              <div class="b-segmentado flex-wrap" role="radiogroup" aria-label="Nivel de conciencia">
                <button
                  v-for="[valor, texto] in CONCIENCIA"
                  :key="valor"
                  type="button"
                  role="radio"
                  :aria-checked="conciencia === valor"
                  :class="conciencia === valor ? 'on' : ''"
                  @click="conciencia = conciencia === valor ? '' : valor"
                >{{ texto }}</button>
              </div>
              <p v-if="motivoDe('conciencia')" class="nota-signo" :class="tonoCampo('conciencia')">{{ motivoDe('conciencia').etiqueta }}</p>
            </fieldset>
            <div>
              <label for="glucosa" class="etiqueta-campo">Glucosa <span class="font-normal text-slate-400">(mg/dL, si se midió)</span></label>
              <input
                id="glucosa"
                v-model="medicion.glucosa"
                type="number"
                step="1"
                inputmode="numeric"
                class="campo-signo w-full rounded-lg border px-3 py-2.5 text-lg tabular-nums text-slate-900 outline-none transition focus:ring-2 focus:ring-mspas-200"
                :class="tonoCampo('glucosa')"
              />
              <p v-if="imposible('glucosa')" class="nota-signo rojo">{{ imposible('glucosa') }}</p>
              <p v-else-if="motivoDe('glucosa')" class="nota-signo" :class="tonoCampo('glucosa')">{{ motivoDe('glucosa').etiqueta }}</p>
            </div>
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
          Cada signo sube la prioridad.
        </p>

        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="signo in signosDelPaciente"
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

      </div>

      <!-- Prioridad: se ve todo el tiempo mientras se llena -->
      <aside class="prioridad">
        <div class="triaje" :class="`nivel-${gravedadSugerida}`">
          <div class="triaje-cabeza">
            <div class="flex items-center justify-between gap-2">
              <span class="triaje-sello">Triaje</span>
              <span v-if="evaluando" class="triaje-estado">calculando</span>
              <span v-else-if="sinRed" class="triaje-estado">sin conexión</span>
            </div>
            <p class="triaje-nivel" aria-live="polite">{{ ESTILO_NIVEL[gravedadSugerida].texto }}</p>
            <div class="medidor" aria-hidden="true">
              <span v-for="n in ['leve', 'moderado', 'urgente']" :key="n" :class="{ lleno: RANGO[n] <= RANGO[gravedadSugerida] }" />
            </div>
          </div>

          <ul v-if="triaje?.motivos.length" class="hallazgos">
            <li v-for="m in triaje.motivos" :key="m.campo + m.etiqueta" :class="m.nivel">
              <span class="marca"><Icono nombre="alerta" :tamano="15" /></span>
              <span>{{ m.texto }}</span>
            </li>
          </ul>
          <p v-else class="sin-hallazgos"><Icono nombre="correcto" :tamano="18" /> Sin señales de alarma</p>

          <div class="registrar-como">
            <span class="etiqueta-campo">Registrar como</span>
            <div class="niveles" role="radiogroup" aria-label="Gravedad a registrar">
              <button
                v-for="n in ['urgente', 'moderado', 'leve']"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="gravedadFinal === n"
                :class="[n, { on: gravedadFinal === n }]"
                @click="gravedadElegida = n === gravedadSugerida ? '' : n"
              >
                {{ ESTILO_NIVEL[n].texto }}
                <small v-if="n === gravedadSugerida">sugerido</small>
              </button>
            </div>
          </div>
          <label v-if="requiereJustificacion" class="mx-4 mb-4 block">
            <span class="etiqueta-campo">Motivo para bajarlo</span>
            <textarea v-model="justificacion" rows="2" required minlength="10" class="campo" />
          </label>
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

      <div class="mt-3">
        <button type="submit" :disabled="guardando" class="boton-primario w-full">
          <Icono nombre="guardar" :tamano="19" />
          {{ guardando ? 'Guardando...' : `Registrar · ${ESTILO_NIVEL[gravedadFinal].texto}` }}
        </button>
      </div>
      </aside>
    </form>
  </section>
</template>

<style scoped>
.triaje { overflow: hidden; background: #fff; border: 2px solid #E2E8F0; border-radius: 16px; }
.triaje-cabeza { padding: 14px 18px 16px; color: #fff; background: #1E8E5E; transition: background .2s; }
.nivel-moderado .triaje-cabeza { background: #C77A06; }
.nivel-urgente .triaje-cabeza { background: #B42F2F; }
.triaje-sello { padding: 2px 8px; border: 2px solid rgba(255,255,255,.55); border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.triaje-estado { font-size: 12px; font-weight: 700; opacity: .85; }
.triaje-nivel { margin-top: 8px; font-size: 34px; font-weight: 800; line-height: 1; letter-spacing: -.01em; }
.medidor { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 12px; }
.medidor span { height: 7px; border-radius: 4px; background: rgba(255,255,255,.28); }
.medidor span.lleno { background: #fff; }
.hallazgos { display: grid; gap: 6px; padding: 14px 14px 4px; }
.hallazgos li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; font-size: 14px; font-weight: 700; }
.hallazgos .marca { display: grid; place-items: center; flex-shrink: 0; width: 26px; height: 26px; border-radius: 8px; color: #fff; }
.hallazgos li.urgente { background: #FDECEC; color: #8C1D1D; }
.hallazgos li.urgente .marca { background: #C03535; }
.hallazgos li.moderado { background: #FFF4DE; color: #7A4F05; }
.hallazgos li.moderado .marca { background: #E8930C; }
.sin-hallazgos { display: flex; align-items: center; gap: 8px; margin: 14px 14px 4px; padding: 10px 12px; border-radius: 10px; background: #EAF7F0; color: #145C3C; font-size: 14px; font-weight: 700; }
.registrar-como { padding: 12px 14px 14px; }
.niveles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 4px; }
.niveles button { display: grid; justify-items: center; gap: 1px; padding: 8px 4px; border: 2px solid #E2E8F0; border-radius: 10px; background: #fff; font-size: 14px; font-weight: 800; color: #475569; }
.niveles button small { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; opacity: .75; }
.niveles button.urgente:hover, .niveles button.urgente.on { border-color: #C03535; }
.niveles button.moderado:hover, .niveles button.moderado.on { border-color: #E8930C; }
.niveles button.leve:hover, .niveles button.leve.on { border-color: #1E8E5E; }
.niveles button.urgente.on { background: #C03535; color: #fff; }
.niveles button.moderado.on { background: #E8930C; color: #fff; }
.niveles button.leve.on { background: #1E8E5E; color: #fff; }

.rejilla-pre { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
@media (max-width: 1023px) { .rejilla-pre { grid-template-columns: 1fr; } }
.prioridad { position: sticky; top: 88px; }
.campo-signo { border-color: #CBD5E1; }
.campo-signo:focus { border-color: #38BDF8; }
.campo-signo.rojo { border: 2px solid #C03535; background: #FDECEC; }
.campo-signo.ambar { border: 2px solid #E8930C; background: #FFF7E6; }
.campo-signo.aviso { border-color: #F5D58A; }
.nota-signo { margin-top: 4px; font-size: 13px; font-weight: 700; }
.nota-signo.rojo { color: #A52A2A; }
.nota-signo.ambar { color: #9A5A06; }
.nota-signo.aviso { color: #7A4F05; font-weight: 600; }
.escala { display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 4px; }
.escala button { height: 42px; border: 2px solid #E2E8F0; border-radius: 9px; font-weight: 700; color: #334155; background: #fff; }
.escala button.medio { border-color: #F5D58A; }
.escala button.alto { border-color: #F3BDBD; }
.escala button.on { background: #172A5A; border-color: #172A5A; color: #fff; }
.escala button.on.medio { background: #B7710A; border-color: #B7710A; }
.escala button.on.alto { background: #C03535; border-color: #C03535; }
/* --- Relieve (estilo duo) --- */
.triaje { border-bottom-width: 4px; border-radius: 20px; }
.niveles button { border-bottom-width: 4px; border-radius: 12px; }
.niveles button:active { transform: translateY(2px); border-bottom-width: 2px; }
.niveles button.urgente.on { border-bottom-color: #8F1D1F; }
.niveles button.moderado.on { border-bottom-color: #A35D00; }
.niveles button.leve.on { border-bottom-color: #0D5634; }
.escala button { border-bottom-width: 4px; border-radius: 12px; }
.escala button:active { transform: translateY(2px); border-bottom-width: 2px; }
.escala button.on { border-bottom-color: #0B163A; }
.escala button.on.medio { border-bottom-color: #7A4F05; }
.escala button.on.alto { border-bottom-color: #8F1D1F; }
.pueblos { display: flex; flex-wrap: wrap; gap: 8px; }
.pueblos button { min-height: 52px; padding: 0 18px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 14px; background: #fff; font-size: 16px; font-weight: 800; color: #334155; }
.pueblos button:hover { border-color: #9FCDEC; }
.pueblos button.on { border-color: #2F83C4; background: #EAF3FB; color: #174E80; }
</style>
