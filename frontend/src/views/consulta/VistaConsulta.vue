<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/atenciones';
import { useSincronizacionStore } from '../../stores/sincronizacion';
import Icono from '../../components/comunes/Icono.vue';
import Etiqueta from '../../components/comunes/Etiqueta.vue';
import CodigoPaciente from '../../components/comunes/CodigoPaciente.vue';
import CampoSiNo from '../../components/ficha/CampoSiNo.vue';
import FilaDiagnostico from '../../components/consulta/FilaDiagnostico.vue';
import HojaAnterior from '../../components/consulta/HojaAnterior.vue';
import { equivalencia } from '../../dominio/unidadesPeso';

/**
 * Consulta del médico: la hoja de evolución de cada visita.
 *
 * Sigue el orden en que el médico ya escribe en papel: peso y signos
 * vitales, MC, HE, EF, IC, Tx y próxima cita. Después, los datos del
 * SIGSA 3CS de la visita, sin volver a pedir lo que ya está en la hoja.
 *
 * El médico no llena la ficha del paciente: la ve resumida al lado, y puede
 * abrirla si quiere corregir algo.
 */
const route = useRoute();
const router = useRouter();
const sync = useSincronizacionStore();

const datos = ref(null);
const insumos = ref([]);
const prescripciones = ref([]);
const recetasExternas = ref([]);
const error = ref('');
const erroresCampos = ref([]);
const avisosReceta = ref([]);
const cerrada = ref(null);
const guardando = ref(false);

const hoja = reactive({
  motivoConsulta: '',
  historiaEnfermedad: '',
  examenFisico: '',
  diagnosticos: [{ descripcion: '', cie: '' }],
  tratamiento: '',
  proximaCita: '',
  tipoConsulta: null,
  controlSigsa: 0,
  referenciaViene: 0,
  referenciaFue: 0,
  referidoA: '',
  lugarNotificacion: 0,
  numeroNotificacion: '',
  acompanante: '',
  examenSitios: { sitios: {}, otrosHallazgos: '', hallazgosAnormales: '' },
  otrosProblemas: '',
  laboratorios: '',
  orientacionIntegral: '',
});
// En la receta se elige un insumo del centro o, si no lo hay, se escribe el
// medicamento para que el paciente lo consiga fuera (externo).
const receta = reactive({ insumo: null, externo: '', cantidad: '', indicaciones: '' });
const busquedaReceta = ref('');
const masDeLaFicha = ref(false);
const sugerencia = ref(null);
const tipoElegidoAMano = ref(false);

// --- Borrador -----------------------------------------------------------------
// Si se cierra la pestaña o se va la luz a media consulta, lo escrito vuelve.

const claveBorrador = computed(() => `camotan_consulta_${route.params.id}`);

function guardarBorrador() {
  try {
    localStorage.setItem(claveBorrador.value, JSON.stringify(hoja));
  } catch {
    // Sin almacenamiento local la consulta sigue funcionando.
  }
}

function leerBorrador() {
  try {
    const texto = localStorage.getItem(claveBorrador.value);
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}

function borrarBorrador() {
  try {
    localStorage.removeItem(claveBorrador.value);
  } catch {
    // Nada que hacer.
  }
}

watch(hoja, () => { if (datos.value && !yaCerrada.value) guardarBorrador(); }, { deep: true });

// --- Signos vitales --------------------------------------------------------------

const VITALES = [
  { clave: 'peso', etiqueta: 'Peso', unidad: 'kg' },
  { clave: 'temperatura', etiqueta: 'Temp.', unidad: '°C' },
  { clave: 'presion', etiqueta: 'P/A', unidad: '' },
  { clave: 'frecCardiaca', etiqueta: 'F. card.', unidad: 'lpm' },
  { clave: 'frecRespiratoria', etiqueta: 'F. resp.', unidad: 'rpm' },
  { clave: 'satOxigeno', etiqueta: 'SatO₂', unidad: '%' },
  { clave: 'talla', etiqueta: 'Talla', unidad: 'cm' },
];

const vitales = computed(() => {
  const p = datos.value?.atencion?.preconsulta;
  if (!p) return [];
  return VITALES.map((v) => {
    const valor = v.clave === 'presion'
      ? (p.presionSis && p.presionDia ? `${p.presionSis}/${p.presionDia}` : null)
      : p[v.clave];
    // Pesado en libras: la equivalencia permite verificar la conversión.
    const nota = v.clave === 'peso' && p.unidadPeso === 'lb' ? equivalencia(valor, 'kg') : null;
    return { ...v, valor, nota };
  }).filter((v) => v.valor !== null && v.valor !== undefined);
});

// Lo que preconsulta encontró: el porqué de la prioridad, arriba de todo.
const motivosTriaje = computed(() => {
  const t = datos.value?.atencion?.preconsulta?.triaje;
  const motivos = (t?.motivos ?? []).map((m) => ({ texto: m.texto ?? m.etiqueta, nivel: m.nivel }));
  for (const s of datos.value?.signosPeligro ?? []) {
    if (!motivos.some((m) => m.texto === s.descripcion)) motivos.push({ texto: s.descripcion, nivel: s.gravedadSugerida });
  }
  return motivos;
});
const triajeBajado = computed(() => {
  const t = datos.value?.atencion?.preconsulta?.triaje;
  return t?.justificacion && t.sugerido !== t.elegido ? t : null;
});

// Consulta anterior abierta en el panel lateral.
const hojaAbierta = ref(null);
function copiarTratamiento(texto) {
  hoja.tratamiento = hoja.tratamiento ? `${hoja.tratamiento}\n${texto}` : texto;
  hojaAbierta.value = null;
}

const camposEnAlerta = computed(
  () => new Set((datos.value?.alertas ?? []).filter((a) => a.tipo === 'signo_vital').map((a) => a.detalle?.campo)),
);

// Corregir un signo vital no sobrescribe en silencio: queda constancia.
const corrigiendo = ref(null);
const correccion = reactive({ valorNuevo: '', motivo: '' });
const correcciones = ref([]);

function abrirCorreccion(vital) {
  if (vital.clave === 'presion') return;
  corrigiendo.value = corrigiendo.value?.clave === vital.clave ? null : vital;
  correccion.valorNuevo = vital.valor;
  correccion.motivo = '';
}

async function guardarCorreccion() {
  try {
    await servicio.corregirSignoVital(route.params.id, {
      campo: corrigiendo.value.clave,
      valorNuevo: Number(correccion.valorNuevo),
      ...(correccion.motivo ? { motivo: correccion.motivo } : {}),
    });
    corrigiendo.value = null;
    await cargar();
    await cargarCorrecciones();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function cargarCorrecciones() {
  try {
    correcciones.value = (await servicio.correcciones(route.params.id)).correcciones;
  } catch {
    // El historial es contexto: si no carga, la consulta sigue sirviendo.
  }
}

// --- Contexto del paciente --------------------------------------------------------

const paciente = computed(() => datos.value?.atencion?.paciente ?? null);
const yaCerrada = computed(() => datos.value?.atencion?.estado === 'atendido');
const cat = computed(() => datos.value?.catalogos3cs ?? {});

const ETIQUETA_CONDICION = {
  menor_5: 'Menor de 5 años',
  adulto_mayor: 'Persona mayor',
  discapacidad: 'Discapacidad',
  desnutricion: 'Desnutrición',
  cronico: 'Enfermedad crónica',
};

const condiciones = computed(() => {
  const p = paciente.value;
  if (!p) return [];
  const lista = (p.condiciones ?? []).map((c) => ({
    texto: ETIQUETA_CONDICION[c.tipo] ?? c.tipo,
    urgente: c.tipo === 'desnutricion',
  }));
  if ((p.embarazos ?? []).length > 0) lista.unshift({ texto: 'Embarazo activo', urgente: true });
  return lista;
});

const CLASIFICACION = {
  desnutricion_aguda_severa: { texto: 'Desnutrición aguda severa', tono: 'urgente' },
  desnutricion_aguda_moderada: { texto: 'Desnutrición aguda moderada', tono: 'atencion' },
  desnutricion_cronica: { texto: 'Desnutrición crónica', tono: 'atencion' },
  riesgo: { texto: 'En riesgo', tono: 'atencion' },
  sobrepeso: { texto: 'Sobrepeso', tono: 'informativo' },
  normal: { texto: 'Estado nutricional normal', tono: 'estable' },
};
const antropometria = computed(() => datos.value?.antropometria ?? null);
const clasificacion = computed(() => {
  const c = antropometria.value?.clasificacion;
  return c ? (CLASIFICACION[c] ?? { texto: c, tono: 'informativo' }) : null;
});

const ESTILO_SEVERIDAD = {
  alta: 'border-l-empeora',
  media: 'border-l-advertencia-marca',
  baja: 'border-l-linea',
};

const antecedentesRegistrados = computed(() => (datos.value?.antecedentes ?? []).filter((s) => s.registrada));
const antecedentesPendientes = computed(() => (datos.value?.antecedentes ?? []).filter((s) => !s.registrada));

function fecha(valor) {
  return valor ? new Date(valor).toLocaleDateString('es-GT') : '';
}
function fechaHora(valor) {
  return valor ? new Date(valor).toLocaleString('es-GT') : '';
}
function edad(nacimiento) {
  const dias = (Date.now() - new Date(nacimiento)) / 86400000;
  const anios = Math.floor(dias / 365.25);
  if (anios >= 1) return `${anios} ${anios === 1 ? 'año' : 'años'}`;
  const meses = Math.floor(dias / 30.4375);
  return meses >= 1 ? `${meses} ${meses === 1 ? 'mes' : 'meses'}` : `${Math.floor(dias)} días`;
}
const etiquetaDe = (lista, valor) => (lista ?? []).find((o) => o.valor === valor)?.etiqueta ?? '';

// --- Tipo de consulta sugerido ---------------------------------------------------

const principal = computed(() => hoja.diagnosticos[0]);

let temporizadorSugerencia = null;
watch(() => [principal.value?.cie, principal.value?.descripcion], () => {
  if (yaCerrada.value || !datos.value) return;
  clearTimeout(temporizadorSugerencia);
  temporizadorSugerencia = setTimeout(async () => {
    try {
      sugerencia.value = await servicio.sugerenciaTipo(route.params.id, {
        cie: principal.value?.cie?.trim(),
        descripcion: principal.value?.descripcion?.trim(),
      });
      // Mientras el médico no lo cambie a mano, sigue la sugerencia.
      if (!tipoElegidoAMano.value) hoja.tipoConsulta = sugerencia.value.valor;
    } catch {
      sugerencia.value = null;
    }
  }, 400);
});

function elegirTipo(valor) {
  hoja.tipoConsulta = valor;
  tipoElegidoAMano.value = true;
}

// --- Diagnósticos --------------------------------------------------------------------

function agregarDiagnostico() {
  if (hoja.diagnosticos.length < 10) hoja.diagnosticos.push({ descripcion: '', cie: '' });
}

function quitarDiagnostico(i) {
  hoja.diagnosticos.splice(i, 1);
}

// --- Carga ------------------------------------------------------------------------------

async function cargar() {
  try {
    datos.value = await servicio.obtener(route.params.id);
    prescripciones.value = datos.value.atencion.prescripciones ?? [];
    recetasExternas.value = datos.value.atencion.recetasExternas ?? [];
    insumos.value = (await servicio.insumos()).insumos;

    const a = datos.value.atencion;
    if (a.estado === 'atendido') {
      borrarBorrador();
      return;
    }
    // MC precargado desde preconsulta; lo demás, del borrador si lo hay.
    const borrador = leerBorrador();
    if (borrador) {
      Object.assign(hoja, borrador);
    } else {
      hoja.motivoConsulta = a.motivoConsulta ?? '';
      for (const s of datos.value.sitiosExamen ?? []) hoja.examenSitios.sitios[s.clave] = null;
    }
  } catch (fallo) {
    error.value = fallo.message;
  }
}

// --- Receta ---------------------------------------------------------------------------

// Sin tildes ni mayúsculas: «acetaminofen» encuentra «Acetaminofén».
const normalizar = (texto) => String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const MAX_RESULTADOS = 8;

const resultadosReceta = computed(() => {
  const palabras = normalizar(busquedaReceta.value).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  return insumos.value
    .filter((i) => {
      const texto = normalizar(`${i.nombreGenerico} ${i.nombreComercial ?? ''} ${i.presentacion ?? ''} ${i.codigoMspas ?? ''}`);
      return palabras.every((p) => texto.includes(p));
    })
    // Primero lo que hay para entregar hoy.
    .sort((a, b) => Number(b.saldoFarmacia > 0) - Number(a.saldoFarmacia > 0) || a.nombreGenerico.localeCompare(b.nombreGenerico, 'es'))
    .slice(0, MAX_RESULTADOS);
});

function elegirInsumo(insumo) {
  receta.insumo = insumo;
  receta.externo = '';
  busquedaReceta.value = '';
}

function recetarFuera() {
  receta.insumo = null;
  receta.externo = busquedaReceta.value.trim();
  busquedaReceta.value = '';
}

// Enter elige el primero de la lista; si no hay ninguno, lo receta para fuera.
function elegirConEnter() {
  if (resultadosReceta.value.length) elegirInsumo(resultadosReceta.value[0]);
  else if (busquedaReceta.value.trim().length >= 2) recetarFuera();
}

function cambiarMedicamento() {
  busquedaReceta.value = receta.insumo?.nombreGenerico ?? receta.externo;
  receta.insumo = null;
  receta.externo = '';
}

const recetaLista = computed(() => {
  if (receta.insumo) return Number(receta.cantidad) > 0;
  // Para lo que se consigue fuera la cantidad es opcional.
  return receta.externo.trim().length >= 2;
});

async function agregarReceta() {
  error.value = '';
  avisosReceta.value = [];
  try {
    if (receta.insumo) {
      const r = await servicio.prescribir(route.params.id, {
        insumoId: receta.insumo.id,
        cantidad: Number(receta.cantidad),
        indicaciones: receta.indicaciones || null,
      });
      prescripciones.value.push(r.prescripcion);
      avisosReceta.value = r.avisos ?? [];
    } else {
      const r = await servicio.recetarFuera(route.params.id, {
        medicamento: receta.externo.trim(),
        cantidad: receta.cantidad ? Number(receta.cantidad) : null,
        indicaciones: receta.indicaciones || null,
      });
      recetasExternas.value.push(r.receta);
    }
    receta.insumo = null;
    receta.externo = '';
    receta.cantidad = '';
    receta.indicaciones = '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const vacioANulo = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

async function cerrar() {
  error.value = '';
  erroresCampos.value = [];
  const diagnosticos = hoja.diagnosticos
    .filter((d) => d.descripcion.trim())
    .map((d) => ({ descripcion: d.descripcion.trim(), cie: d.cie.trim() || null }));
  if (diagnosticos.length === 0) {
    error.value = 'Registre al menos un diagnóstico en la impresión clínica.';
    document.getElementById('dx-1')?.focus();
    return;
  }

  guardando.value = true;
  try {
    const cuerpo = {
      motivoConsulta: hoja.motivoConsulta.trim() || undefined,
      historiaEnfermedad: vacioANulo(hoja.historiaEnfermedad),
      examenFisico: vacioANulo(hoja.examenFisico),
      diagnosticos,
      tratamiento: vacioANulo(hoja.tratamiento),
      proximaCita: hoja.proximaCita || null,
      tipoConsulta: hoja.tipoConsulta,
      controlSigsa: hoja.controlSigsa,
      referenciaViene: hoja.referenciaViene,
      referenciaFue: hoja.referenciaFue,
      referidoA: hoja.referenciaFue > 0 ? vacioANulo(hoja.referidoA) : null,
      lugarNotificacion: hoja.lugarNotificacion,
      numeroNotificacion: hoja.lugarNotificacion > 0 ? vacioANulo(hoja.numeroNotificacion) : null,
      acompanante: vacioANulo(hoja.acompanante),
      otrosProblemas: vacioANulo(hoja.otrosProblemas),
      laboratorios: vacioANulo(hoja.laboratorios),
      orientacionIntegral: vacioANulo(hoja.orientacionIntegral),
    };
    // El examen por sitio solo se envía si se usó.
    const sitiosMarcados = Object.values(hoja.examenSitios.sitios).some((v) => v !== null);
    if (sitiosMarcados || hoja.examenSitios.otrosHallazgos || hoja.examenSitios.hallazgosAnormales) {
      cuerpo.examenSitios = {
        sitios: hoja.examenSitios.sitios,
        otrosHallazgos: vacioANulo(hoja.examenSitios.otrosHallazgos),
        hallazgosAnormales: vacioANulo(hoja.examenSitios.hallazgosAnormales),
      };
    }

    // Cerrar cambia el estado clínico: sin red se rechaza, no se encola.
    const envio = await sync.enviar({
      metodo: 'PATCH',
      ruta: `/atenciones/${route.params.id}/consulta`,
      descripcion: 'Cierre de consulta',
      cuerpo,
    });
    borrarBorrador();
    cerrada.value = envio.respuesta;
  } catch (fallo) {
    error.value = fallo.message;
    erroresCampos.value = fallo.detalles ?? [];
  } finally {
    guardando.value = false;
  }
}

const sitiosNoNormales = computed(() => Object.values(hoja.examenSitios.sitios).some((v) => v === false));

onMounted(() => {
  cargar();
  cargarCorrecciones();
});
</script>

<template>
  <!-- Consulta recién cerrada -->
  <section v-if="cerrada" class="mx-auto max-w-2xl">
    <div class="panel border-l-4 border-l-mejora p-relleno">
      <div class="flex items-start gap-3">
        <Icono nombre="correcto" :tamano="28" class="mt-0.5 text-mejora" />
        <div>
          <p class="font-titulo text-2xl font-bold text-tinta">Consulta cerrada</p>
          <p class="mt-1 text-tinta-2">
            {{ cerrada.atencion.diagnosticoTxt }}
            <strong v-if="cerrada.atencion.diagnosticoCie" class="font-mono">{{ cerrada.atencion.diagnosticoCie }}</strong>
            <span v-if="cerrada.duracionMin"> · duración {{ cerrada.duracionMin }} minutos</span>
          </p>
          <div class="mt-5 flex flex-wrap gap-3">
            <button type="button" class="boton-primario" @click="router.push('/cola')">
              <Icono nombre="cola" :tamano="18" /> Volver a la cola
            </button>
            <RouterLink :to="`/imprimir/ficha/${route.params.id}`" target="_blank" class="boton-secundario">
              <Icono nombre="consulta" :tamano="18" /> Imprimir ficha
            </RouterLink>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section v-else-if="datos" class="space-y-bloque">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <RouterLink to="/cola" class="enlace inline-flex items-center gap-1.5">
        <Icono nombre="volver" :tamano="17" /> Volver a la cola
      </RouterLink>
      <div class="flex flex-wrap gap-2">
        <RouterLink :to="`/pacientes/${paciente.id}`" target="_blank" class="boton-secundario">
          <Icono nombre="pacientes" :tamano="18" /> Ver expediente
        </RouterLink>
        <RouterLink :to="`/imprimir/ficha/${route.params.id}`" target="_blank" class="boton-secundario">
          <Icono nombre="consulta" :tamano="18" /> Imprimir ficha
        </RouterLink>
        <RouterLink :to="`/consulta/${route.params.id}/referencia`" class="boton-secundario">
          <Icono nombre="irA" :tamano="18" /> Boleta de referencia
        </RouterLink>
      </div>
    </div>

    <!-- Quién es -->
    <header class="panel overflow-hidden">
      <div class="flex flex-wrap items-center gap-5 bg-marino px-relleno py-5 text-superficie">
        <CodigoPaciente :papel="paciente.expedientePapel" :expediente="paciente.expediente" invertido />
        <div class="min-w-0 flex-1">
          <h1 class="font-titulo text-titulo-pagina font-medium leading-tight text-superficie">
            {{ paciente.apellidos }}, {{ paciente.nombres }}
          </h1>
          <p class="mt-1 text-superficie/85">
            {{ edad(paciente.fechaNacimiento) }}<span v-if="paciente.fechaNacimientoEstimada"> (aproximada)</span>
            · {{ paciente.sexo === 'M' ? 'Masculino' : 'Femenino' }} · {{ paciente.comunidad }}
          </p>
          <p class="mt-1 text-sm text-superficie/75">{{ datos.fichaPaciente?.nombre }} · {{ datos.fichaPaciente?.rango }}</p>
        </div>
        <ul class="flex flex-wrap gap-2">
          <li
            class="rounded-control px-3 py-1 text-sm font-bold capitalize"
            :class="datos.atencion.gravedad === 'urgente' ? 'bg-superficie text-empeora' : 'border border-superficie/40'"
          >
            {{ datos.atencion.gravedad }}
          </li>
          <li
            v-for="c in condiciones"
            :key="c.texto"
            class="rounded-control px-3 py-1 text-sm font-bold"
            :class="c.urgente ? 'bg-superficie text-empeora' : 'border border-superficie/40'"
          >
            {{ c.texto }}
          </li>
        </ul>
      </div>
    </header>

    <div v-if="motivosTriaje.length || triajeBajado" class="franja-triaje" :class="`nivel-${datos.atencion.gravedad}`" role="alert">
      <div class="sello">
        <Icono nombre="alerta" :tamano="22" />
        <span>{{ datos.atencion.gravedad }}</span>
      </div>
      <div class="min-w-0 flex-1 py-3 pr-4">
        <ul class="flex flex-wrap gap-2">
          <li v-for="m in motivosTriaje" :key="m.texto" class="motivo" :class="m.nivel">{{ m.texto }}</li>
        </ul>
        <p v-if="triajeBajado" class="franja-nota">
          <b>Bajado de {{ triajeBajado.sugerido }}:</b> {{ triajeBajado.justificacion }}
        </p>
      </div>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-empeora" />
      <span class="text-tinta-2">
        {{ error }}
        <span v-if="erroresCampos.length" class="block text-sm">
          {{ erroresCampos.map((e) => e.mensaje).join(' · ') }}
        </span>
      </span>
    </p>

    <div class="grid items-start gap-bloque xl:grid-cols-[1fr,22rem]">
      <!-- ===================== Hoja de evolución ===================== -->
      <div class="space-y-bloque">
        <!-- Peso y signos vitales: vienen de preconsulta -->
        <article class="panel">
          <header class="panel-encabezado">
            <h2 class="panel-titulo">Peso y signos vitales</h2>
          </header>
          <div class="p-relleno">
            <p v-if="vitales.length === 0" class="text-apagado">Preconsulta no registró signos vitales en esta visita.</p>
            <div v-else class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <div
                v-for="v in vitales"
                :key="v.clave"
                class="border-l-4 pl-3"
                :class="camposEnAlerta.has(v.clave) ? 'border-l-empeora' : 'border-l-linea'"
              >
                <p class="flex items-center justify-between gap-1 text-sm text-apagado">
                  {{ v.etiqueta }}
                  <button
                    v-if="v.clave !== 'presion' && !yaCerrada"
                    type="button"
                    class="text-mejora underline-offset-2 hover:underline"
                    :aria-label="`Corregir ${v.etiqueta}`"
                    @click="abrirCorreccion(v)"
                  >
                    corregir
                  </button>
                </p>
                <p class="font-titulo text-2xl font-bold tabular-nums" :class="camposEnAlerta.has(v.clave) ? 'text-empeora' : 'text-tinta'">
                  {{ v.valor }}<span class="ml-0.5 text-sm font-normal text-apagado">{{ v.unidad }}</span>
                </p>
                <p v-if="v.nota" class="text-sm text-apagado">({{ v.nota }})</p>
              </div>
            </div>

            <form v-if="corrigiendo" class="mt-4 grid gap-3 border-t border-linea pt-4 sm:grid-cols-[10rem,1fr,auto]" @submit.prevent="guardarCorreccion">
              <div>
                <label for="valorNuevo" class="etiqueta-campo">{{ corrigiendo.etiqueta }} correcto</label>
                <input id="valorNuevo" v-model="correccion.valorNuevo" type="number" step="0.01" required class="campo tabular-nums" />
              </div>
              <div>
                <label for="motivoCorreccion" class="etiqueta-campo">Por qué se corrige</label>
                <input id="motivoCorreccion" v-model="correccion.motivo" minlength="5" maxlength="500" class="campo" />
              </div>
              <div class="flex items-end gap-2">
                <button type="submit" class="boton-primario">Corregir</button>
                <button type="button" class="boton-secundario" @click="corrigiendo = null">Cancelar</button>
              </div>
            </form>
          </div>
        </article>

        <!-- ===== Consulta cerrada: se lee, no se vuelve a cerrar ===== -->
        <article v-if="yaCerrada" class="panel">
          <header class="panel-encabezado">
            <h2 class="panel-titulo"><Icono nombre="correcto" :tamano="19" class="text-mejora" /> Consulta cerrada</h2>
            <span class="text-sm text-apagado">{{ fechaHora(datos.atencion.cerradaEn) }}</span>
          </header>
          <dl class="space-y-4 p-relleno">
            <div><dt class="etiqueta-campo">MC · Motivo de consulta</dt><dd class="text-tinta">{{ datos.atencion.motivoConsulta }}</dd></div>
            <div v-if="datos.atencion.historiaEnfermedad"><dt class="etiqueta-campo">HE · Historia de la enfermedad actual</dt><dd class="whitespace-pre-line text-tinta">{{ datos.atencion.historiaEnfermedad }}</dd></div>
            <div v-if="datos.atencion.examenFisico"><dt class="etiqueta-campo">EF · Examen físico</dt><dd class="whitespace-pre-line text-tinta">{{ datos.atencion.examenFisico }}</dd></div>
            <div>
              <dt class="etiqueta-campo">IC · Impresión clínica</dt>
              <dd>
                <ol class="space-y-1">
                  <li v-for="d in datos.atencion.diagnosticos" :key="d.id" class="text-tinta">
                    <span class="font-mono font-bold text-marino">{{ d.cie ?? 'sin código' }}</span> · {{ d.descripcion }}
                  </li>
                  <li v-if="!datos.atencion.diagnosticos?.length" class="text-tinta">
                    <span class="font-mono font-bold text-marino">{{ datos.atencion.diagnosticoCie ?? 'sin código' }}</span> · {{ datos.atencion.diagnosticoTxt }}
                  </li>
                </ol>
              </dd>
            </div>
            <div v-if="datos.atencion.tratamiento"><dt class="etiqueta-campo">Tx · Tratamiento</dt><dd class="whitespace-pre-line text-tinta">{{ datos.atencion.tratamiento }}</dd></div>
            <div v-if="datos.atencion.proximaCita"><dt class="etiqueta-campo">Próxima cita</dt><dd class="text-tinta">{{ fecha(datos.atencion.proximaCita) }}</dd></div>
            <div v-if="datos.atencion.tipoConsulta" class="border-t border-linea pt-4">
              <dt class="etiqueta-campo">SIGSA 3CS</dt>
              <dd class="text-tinta">
                {{ etiquetaDe(cat.tipoConsulta, datos.atencion.tipoConsulta) }}
                · Control: {{ etiquetaDe(cat.controlSigsa, datos.atencion.controlSigsa) }}
                <span v-if="datos.atencion.semanasGestacion !== null"> · {{ datos.atencion.semanasGestacion }} semanas de gestación</span>
                <span v-if="datos.atencion.referenciaFue"> · {{ etiquetaDe(cat.referenciaFue, datos.atencion.referenciaFue) }} a {{ datos.atencion.referidoA }}</span>
              </dd>
            </div>
          </dl>
          <p class="border-t border-linea px-relleno py-3 text-sm text-apagado">
            Los datos de una consulta cerrada ya no se editan. Una corrección queda registrada aparte, con su motivo.
          </p>
        </article>

        <!-- ===== Hoja de evolución en curso ===== -->
        <form v-else class="space-y-bloque" @submit.prevent="cerrar">
          <article class="panel">
            <header class="panel-encabezado">
              <h2 class="panel-titulo">Hoja de evolución</h2>
              <span class="text-sm text-apagado">{{ new Date().toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric' }) }}</span>
            </header>
            <div class="space-y-6 p-relleno">
              <div>
                <label for="mc" class="etiqueta-campo"><abbr title="Motivo de consulta" class="no-underline">MC</abbr> · Motivo de consulta</label>
                <textarea id="mc" v-model="hoja.motivoConsulta" rows="2" maxlength="500" class="campo" />
                <p class="mt-1 text-sm text-apagado">Viene de preconsulta; puede precisarlo.</p>
              </div>

              <div>
                <label for="he" class="etiqueta-campo"><abbr title="Historia de la enfermedad actual" class="no-underline">HE</abbr> · Historia de la enfermedad actual</label>
                <textarea id="he" v-model="hoja.historiaEnfermedad" rows="4" maxlength="4000" class="campo" />
              </div>

              <div>
                <label for="ef" class="etiqueta-campo"><abbr title="Examen físico" class="no-underline">EF</abbr> · Examen físico</label>
                <textarea id="ef" v-model="hoja.examenFisico" rows="4" maxlength="4000" class="campo" />
              </div>

              <!-- IC: filas repetibles con buscador de CIE-10 -->
              <fieldset>
                <legend class="etiqueta-campo flex w-full flex-wrap items-baseline justify-between gap-2">
                  <span><abbr title="Impresión clínica" class="no-underline">IC</abbr> · Impresión clínica (diagnóstico) y CIE-10</span>
                  <span class="text-sm font-normal normal-case tracking-normal text-apagado">
                    Busque por nombre, código o sinónimo. Sin código, queda pendiente de codificar.
                  </span>
                </legend>
                <div class="space-y-3">
                  <FilaDiagnostico
                    v-for="(d, i) in hoja.diagnosticos"
                    :key="i"
                    v-model="hoja.diagnosticos[i]"
                    :numero="i + 1"
                    :quitable="hoja.diagnosticos.length > 1"
                    @quitar="quitarDiagnostico(i)"
                  />
                </div>
                <button
                  v-if="hoja.diagnosticos.length < 10"
                  type="button"
                  class="enlace mt-3 inline-flex items-center gap-1.5"
                  @click="agregarDiagnostico"
                >
                  <Icono nombre="agregar" :tamano="16" /> Agregar otro diagnóstico
                </button>
              </fieldset>

              <!-- Tx: texto libre y receta estructurada que pasa a farmacia -->
              <div>
                <label for="tx" class="etiqueta-campo"><abbr title="Tratamiento" class="no-underline">Tx</abbr> · Tratamiento y plan</label>
                <textarea id="tx" v-model="hoja.tratamiento" rows="3" maxlength="4000" class="campo" />
              </div>

              <div class="rounded-control border border-linea bg-fondo p-4">
                <p class="flex items-center gap-2 font-bold text-tinta">
                  <Icono nombre="dispensacion" :tamano="18" class="text-marino" /> Receta
                  <span v-if="prescripciones.length + recetasExternas.length" class="font-normal text-apagado">({{ prescripciones.length + recetasExternas.length }})</span>
                </p>
                <ul v-if="prescripciones.length || recetasExternas.length" class="mt-3 space-y-1.5">
                  <li
                    v-for="p in prescripciones"
                    :key="p.id"
                    class="flex flex-wrap items-center justify-between gap-3 rounded-control bg-superficie px-4 py-2.5"
                  >
                    <span class="font-bold text-tinta">{{ p.insumo.nombreGenerico }} <span class="font-normal text-apagado">{{ p.insumo.presentacion }}</span></span>
                    <span class="text-tinta-2"><strong class="tabular-nums">{{ p.cantidad }}</strong><span v-if="p.indicaciones"> · {{ p.indicaciones }}</span></span>
                  </li>
                  <li
                    v-for="r in recetasExternas"
                    :key="`fuera-${r.id}`"
                    class="flex flex-wrap items-center justify-between gap-3 rounded-control border border-dashed border-linea bg-superficie px-4 py-2.5"
                  >
                    <span class="font-bold text-tinta">{{ r.medicamento }} <span class="ml-1 text-sm font-normal text-advertencia">Conseguir fuera del centro</span></span>
                    <span class="text-tinta-2"><strong v-if="r.cantidad" class="tabular-nums">{{ r.cantidad }}</strong><span v-if="r.indicaciones"><template v-if="r.cantidad"> · </template>{{ r.indicaciones }}</span></span>
                  </li>
                </ul>
                <p v-for="a in avisosReceta" :key="a" role="alert" class="mt-2 flex items-start gap-2 text-sm text-advertencia">
                  <Icono nombre="inventario" :tamano="16" class="mt-0.5 shrink-0" /> {{ a }}
                </p>
                <!-- 1. Buscar el medicamento -->
                <div v-if="!receta.insumo && !receta.externo" class="relative mt-3">
                  <label for="buscar-medicamento" class="sr-only">Buscar medicamento</label>
                  <Icono nombre="buscar" :tamano="18" class="pointer-events-none absolute left-3 top-3 text-apagado" />
                  <input
                    id="buscar-medicamento"
                    v-model="busquedaReceta"
                    type="search"
                    autocomplete="off"
                    placeholder="Buscar medicamento por nombre"
                    class="campo pl-10"
                    @keydown.enter.prevent="elegirConEnter"
                  />
                  <ul v-if="busquedaReceta.trim()" class="lista-receta" aria-label="Medicamentos encontrados">
                    <li v-for="i in resultadosReceta" :key="i.id">
                      <button type="button" class="opcion-receta" @click="elegirInsumo(i)">
                        <span class="min-w-0">
                          <b class="text-tinta">{{ i.nombreGenerico }}</b>
                          <span v-if="i.nombreComercial" class="text-apagado"> · {{ i.nombreComercial }}</span>
                        </span>
                        <span v-if="i.saldoFarmacia > 0" class="shrink-0 text-sm text-mejora">Hay {{ i.saldoFarmacia }}</span>
                        <span v-else class="shrink-0 text-sm text-advertencia">No hay en farmacia</span>
                      </button>
                    </li>
                    <li v-if="!resultadosReceta.length" class="px-4 py-2.5 text-sm text-apagado">No está en la lista del centro.</li>
                    <li v-if="busquedaReceta.trim().length >= 2">
                      <button type="button" class="opcion-receta fuera" @click="recetarFuera">
                        <Icono nombre="agregar" :tamano="16" class="shrink-0" />
                        <span class="min-w-0 flex-1">Recetar «{{ busquedaReceta.trim() }}» para conseguir fuera del centro</span>
                      </button>
                    </li>
                  </ul>
                </div>

                <!-- 2. Cantidad e indicaciones del elegido -->
                <div v-else class="mt-3 space-y-3">
                  <div class="flex flex-wrap items-center gap-3 rounded-control bg-superficie px-4 py-2.5">
                    <span class="min-w-0 flex-1">
                      <template v-if="receta.insumo">
                        <b class="text-tinta">{{ receta.insumo.nombreGenerico }}</b>
                        <span class="ml-2 text-sm" :class="receta.insumo.saldoFarmacia > 0 ? 'text-mejora' : 'text-advertencia'">
                          {{ receta.insumo.saldoFarmacia > 0 ? `Hay ${receta.insumo.saldoFarmacia} en farmacia` : 'No hay en farmacia: quedará como demanda no atendida' }}
                        </span>
                      </template>
                      <template v-else>
                        <b class="text-tinta">{{ receta.externo }}</b>
                        <span class="ml-2 text-sm text-advertencia">Lo consigue fuera del centro</span>
                      </template>
                    </span>
                    <button type="button" class="enlace text-sm" @click="cambiarMedicamento">Cambiar</button>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-[8rem,1fr,auto]">
                    <input
                      v-model="receta.cantidad"
                      type="number" min="1"
                      aria-label="Cantidad recetada"
                      :placeholder="receta.insumo ? 'Cantidad' : 'Cantidad (opc.)'"
                      class="campo tabular-nums"
                    />
                    <input v-model="receta.indicaciones" aria-label="Indicaciones" placeholder="Indicaciones" class="campo" />
                    <button type="button" class="boton-secundario" :disabled="!recetaLista" @click="agregarReceta">
                      <Icono nombre="agregar" :tamano="18" /> Agregar
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label for="cita" class="etiqueta-campo">Próxima cita</label>
                <input id="cita" v-model="hoja.proximaCita" type="date" class="campo w-56" />
              </div>
            </div>
          </article>

          <!-- ===== Datos del SIGSA 3CS de la visita ===== -->
          <article class="panel">
            <header class="panel-encabezado">
              <h2 class="panel-titulo">Datos del SIGSA 3CS</h2>
              <span class="text-sm text-apagado">El motivo, el diagnóstico y el tratamiento salen de la hoja</span>
            </header>
            <div class="grid gap-x-6 gap-y-5 p-relleno sm:grid-cols-2">
              <fieldset class="sm:col-span-2">
                <legend class="etiqueta-campo">Tipo de consulta</legend>
                <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de consulta">
                  <button
                    v-for="t in cat.tipoConsulta"
                    :key="t.valor"
                    type="button"
                    role="radio"
                    :aria-checked="hoja.tipoConsulta === t.valor"
                    class="min-h-tocable rounded-control border px-4 font-bold transition"
                    :class="hoja.tipoConsulta === t.valor
                      ? 'border-marino bg-marino text-superficie'
                      : 'border-linea bg-superficie text-tinta-2 hover:bg-fondo'"
                    @click="elegirTipo(t.valor)"
                  >
                    {{ t.valor }} · {{ t.etiqueta }}
                    <span v-if="sugerencia?.valor === t.valor" class="ml-1 text-xs font-normal opacity-80">sugerido</span>
                  </button>
                </div>
                <p v-if="sugerencia" class="mt-1 text-sm text-apagado">{{ sugerencia.razon }}.</p>
              </fieldset>

              <div>
                <label for="control" class="etiqueta-campo">Control</label>
                <select id="control" v-model="hoja.controlSigsa" class="campo">
                  <option v-for="c in cat.controlSigsa" :key="c.valor" :value="c.valor">{{ c.valor }} · {{ c.etiqueta }}</option>
                </select>
              </div>

              <div>
                <p class="etiqueta-campo">Semana de gestación</p>
                <p class="flex min-h-tocable items-center rounded-control bg-fondo px-4 text-tinta">
                  {{ datos.semanasGestacion !== null && datos.semanasGestacion !== undefined
                    ? `${datos.semanasGestacion} semanas`
                    : 'No aplica: sin embarazo activo' }}
                </p>
              </div>

              <div>
                <label for="viene" class="etiqueta-campo">Referencia: viene</label>
                <select id="viene" v-model="hoja.referenciaViene" class="campo">
                  <option v-for="c in cat.referenciaViene" :key="c.valor" :value="c.valor">{{ c.valor }} · {{ c.etiqueta }}</option>
                </select>
              </div>

              <div>
                <label for="fue" class="etiqueta-campo">Referencia: fue</label>
                <select id="fue" v-model="hoja.referenciaFue" class="campo">
                  <option v-for="c in cat.referenciaFue" :key="c.valor" :value="c.valor">{{ c.valor }} · {{ c.etiqueta }}</option>
                </select>
                <input
                  v-if="hoja.referenciaFue > 0"
                  v-model="hoja.referidoA"
                  required
                  maxlength="200"
                  placeholder="Referido a (establecimiento)"
                  aria-label="Referido a"
                  class="campo mt-2"
                />
              </div>

              <div>
                <label for="notificacion" class="etiqueta-campo flex items-center gap-2">
                  Lugar de notificación
                  <span class="inline-flex items-center gap-1 text-sm font-normal normal-case tracking-normal text-apagado">
                    <Icono nombre="escudo" :tamano="14" /> Dato sensible
                  </span>
                </label>
                <select id="notificacion" v-model="hoja.lugarNotificacion" class="campo">
                  <option v-for="c in cat.lugarNotificacion" :key="c.valor" :value="c.valor">{{ c.valor }} · {{ c.etiqueta }}</option>
                </select>
                <input
                  v-if="hoja.lugarNotificacion > 0"
                  v-model="hoja.numeroNotificacion"
                  required
                  maxlength="40"
                  placeholder="Número"
                  aria-label="Número de la notificación"
                  class="campo mt-2"
                />
              </div>

              <div>
                <label for="acompanante" class="etiqueta-campo">Nombre del acompañante</label>
                <input id="acompanante" v-model="hoja.acompanante" maxlength="160" class="campo" />
              </div>
            </div>
          </article>

          <!-- ===== Lo que el papel trae y no es obligatorio ===== -->
          <article class="panel">
            <h2>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-4 px-relleno py-4 text-left hover:bg-fondo"
                :aria-expanded="masDeLaFicha"
                @click="masDeLaFicha = !masDeLaFicha"
              >
                <span>
                  <span class="block font-titulo text-lg font-bold text-tinta">Más de la ficha (opcional)</span>
                  <span class="text-sm text-apagado">Examen físico por sitio, otros problemas, laboratorios y orientación integral</span>
                </span>
                <Icono nombre="irA" :tamano="20" class="shrink-0 text-apagado transition-transform" :class="masDeLaFicha ? 'rotate-90' : ''" />
              </button>
            </h2>
            <div v-if="masDeLaFicha" class="space-y-6 border-t border-linea p-relleno">
              <fieldset>
                <legend class="etiqueta-campo">Examen físico por sitio anatómico · Normal</legend>
                <ul class="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                  <li
                    v-for="s in datos.sitiosExamen"
                    :key="s.clave"
                    class="flex min-h-[3rem] items-center justify-between gap-3 border-b border-linea-suave py-1"
                  >
                    <span class="text-tinta">{{ s.etiqueta }}</span>
                    <CampoSiNo v-model="hoja.examenSitios.sitios[s.clave]" :etiqueta="`${s.etiqueta} normal`" compacto />
                  </li>
                </ul>
              </fieldset>
              <div>
                <label for="otrosHallazgos" class="etiqueta-campo">Otros hallazgos, especifique</label>
                <textarea id="otrosHallazgos" v-model="hoja.examenSitios.otrosHallazgos" rows="2" class="campo" />
              </div>
              <div>
                <label for="anormales" class="etiqueta-campo">
                  Describa hallazgos anormales
                  <span v-if="sitiosNoNormales" class="text-sm font-bold normal-case tracking-normal text-advertencia">· hay sitios marcados como no normales</span>
                </label>
                <textarea id="anormales" v-model="hoja.examenSitios.hallazgosAnormales" rows="2" class="campo" />
              </div>
              <div>
                <label for="otrosProblemas" class="etiqueta-campo">Otros problemas identificados</label>
                <textarea id="otrosProblemas" v-model="hoja.otrosProblemas" rows="2" class="campo" />
              </div>
              <div>
                <label for="labs" class="etiqueta-campo">Laboratorios a realizar según normas, resultados y otros estudios complementarios</label>
                <textarea id="labs" v-model="hoja.laboratorios" rows="2" class="campo" />
              </div>
              <div>
                <label for="orientacion" class="etiqueta-campo">Orientación integral</label>
                <textarea id="orientacion" v-model="hoja.orientacionIntegral" rows="2" class="campo" />
              </div>
            </div>
          </article>

          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" :disabled="guardando" class="boton-primario">
              <Icono nombre="correcto" :tamano="19" />
              {{ guardando ? 'Cerrando…' : 'Cerrar consulta' }}
            </button>
            <p class="text-sm text-apagado">Lo escrito se guarda en este equipo mientras la consulta está abierta.</p>
          </div>
        </form>
      </div>

      <!-- ===================== Contexto ===================== -->
      <aside class="space-y-bloque xl:sticky xl:top-24">
        <div v-if="datos.alertas.length" class="panel">
          <header class="panel-encabezado"><h2 class="panel-titulo">Alertas clínicas</h2></header>
          <ul class="space-y-2 p-4">
            <li
              v-for="(a, i) in datos.alertas"
              :key="i"
              role="alert"
              class="border-l-4 bg-fondo px-4 py-2.5 font-bold text-tinta"
              :class="ESTILO_SEVERIDAD[a.severidad]"
            >
              {{ a.mensaje }}
            </li>
          </ul>
        </div>

        <div v-if="antropometria" class="panel p-4">
          <p class="text-etiqueta font-bold uppercase tracking-wide text-apagado">Estado nutricional</p>
          <Etiqueta v-if="clasificacion" :tono="clasificacion.tono" class="mt-2">{{ clasificacion.texto }}</Etiqueta>
          <p v-else class="mt-2 text-apagado">Sin clasificación: no hubo indicador suficiente.</p>
          <p v-if="antropometria.improbable" class="mt-2 text-sm text-advertencia">
            Medición biológicamente improbable, no clasifica. {{ antropometria.motivoImprobable }}
          </p>
          <p class="mt-2 text-sm text-apagado">
            Medición del {{ fecha(antropometria.fecha) }}<span v-if="paciente.fechaNacimientoEstimada"> · edad aproximada, el puntaje Z también</span>
          </p>
        </div>

        <!-- Resumen de antecedentes: los ve, puede editarlos, no es su flujo -->
        <div class="panel">
          <header class="panel-encabezado">
            <h2 class="panel-titulo">Antecedentes</h2>
            <RouterLink :to="`/pacientes/${paciente.id}/ficha`" target="_blank" class="enlace text-sm">Abrir ficha</RouterLink>
          </header>
          <div class="space-y-3 p-4">
            <p v-if="antecedentesRegistrados.length === 0" class="text-apagado">
              Sin antecedentes registrados
            </p>
            <div v-for="s in antecedentesRegistrados" :key="s.clave">
              <p class="text-sm font-bold text-tinta">{{ s.titulo }}</p>
              <p v-if="s.positivos.length" class="text-sm text-tinta">
                <span class="font-bold text-marino">Sí:</span> {{ s.positivos.join(' · ') }}
              </p>
              <p v-for="d in s.datos" :key="d" class="text-sm text-tinta-2">{{ d }}</p>
              <p v-if="!s.positivos.length && !s.datos.length" class="text-sm text-apagado">
                {{ s.negativos ? `Todo en No (${s.negativos})` : 'Registrada sin datos' }}
              </p>
            </div>
            <p v-if="antecedentesPendientes.length" class="border-t border-linea pt-3 text-sm text-apagado">
              Sin registrar: {{ antecedentesPendientes.map((s) => s.titulo).join(', ') }}
            </p>
          </div>
        </div>

        <div v-if="datos.ficha && !datos.ficha.completa" class="aviso aviso-atencion">
          <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-advertencia" />
          <div>
            <p class="font-bold text-tinta">Faltan {{ datos.ficha.faltantes.length }} datos mínimos para el SIGSA</p>
            <p class="text-sm text-tinta-2">{{ datos.ficha.faltantes.map((f) => f.etiqueta).join(' · ') }}</p>
          </div>
        </div>

        <div v-if="correcciones.length" class="panel">
          <header class="panel-encabezado"><h2 class="panel-titulo">Correcciones ({{ correcciones.length }})</h2></header>
          <ul class="lista">
            <li v-for="c in correcciones" :key="c.id" class="px-4 py-3 text-sm">
              <p class="text-tinta">
                <strong>{{ c.etiqueta }}</strong>:
                <span class="text-apagado line-through">{{ c.valorAnterior ?? 'vacío' }}</span> → {{ c.valorNuevo }}
              </p>
              <p class="text-tinta-2">{{ c.motivo }}</p>
              <p class="text-apagado">{{ c.usuario }} · {{ fechaHora(c.registradaEn) }}</p>
            </li>
          </ul>
        </div>

        <div v-if="datos.historial.length" class="panel">
          <header class="panel-encabezado"><h2 class="panel-titulo">Consultas anteriores</h2></header>
          <ul class="lista">
            <li v-for="h in datos.historial" :key="h.id">
              <button type="button" class="anterior" @click="hojaAbierta = h.id">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-bold text-tinta">{{ h.diagnosticoTxt || h.motivoConsulta || 'Sin diagnóstico' }}</span>
                  <span class="block text-sm text-apagado">
                    <span v-if="h.diagnosticoCie" class="font-mono">{{ h.diagnosticoCie }} · </span>{{ fecha(h.registradaEn) }}
                    <span v-if="h.prescripciones?.length"> · {{ h.prescripciones.length }} med.</span>
                  </span>
                </span>
                <span class="ver">Ver hoja <Icono nombre="irA" :tamano="14" /></span>
              </button>
            </li>
          </ul>
        </div>
      </aside>
    </div>

    <HojaAnterior :atencion-id="hojaAbierta" :puede-copiar="!yaCerrada" @cerrar="hojaAbierta = null" @copiar-tratamiento="copiarTratamiento" />
  </section>

  <section v-else class="mx-auto max-w-3xl">
    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-empeora" />
      <span class="text-tinta-2">{{ error }}</span>
    </p>
    <p v-else class="text-apagado">Cargando consulta…</p>
  </section>
</template>

<style scoped>
.franja-triaje { display: flex; align-items: stretch; gap: 16px; overflow: hidden; border: 2px solid #F3BDBD; border-radius: 14px; background: #fff; }
.franja-triaje.nivel-moderado { border-color: #F5D58A; }
.franja-triaje.nivel-leve { border-color: #B5E2CB; }
.sello { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; flex-shrink: 0; width: 112px; padding: 10px; color: #fff; background: #C03535; font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.nivel-moderado .sello { background: #E8930C; }
.nivel-leve .sello { background: #1E8E5E; }
.motivo { padding: 5px 12px; border-radius: 8px; font-size: 15px; font-weight: 700; }
.motivo.urgente { background: #FDECEC; color: #8C1D1D; }
.motivo.moderado { background: #FFF1D6; color: #7A4F05; }
.franja-nota { margin-top: 8px; font-size: 14px; color: #475569; }
.anterior { display: flex; width: 100%; align-items: center; gap: 10px; padding: 10px 16px; text-align: left; }
.anterior:hover { background: #F2F4F7; }
.anterior .ver { flex-shrink: 0; display: inline-flex; align-items: center; gap: 2px; padding: 4px 10px; border: 2px solid #CBD5E1; border-radius: 8px; font-size: 12px; font-weight: 800; color: #172A5A; background: #fff; }
.anterior:hover .ver { border-color: #172A5A; }
.lista-receta { margin-top: 6px; overflow: hidden; border: 1px solid var(--linea, #DDE3EC); border-radius: 10px; background: #fff; }
.opcion-receta { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; text-align: left; border-top: 1px solid var(--linea-suave, #EDF0F5); }
li:first-child > .opcion-receta { border-top: none; }
.opcion-receta:hover, .opcion-receta:focus-visible { background: #F2F4F7; outline: none; }
.opcion-receta.fuera { justify-content: flex-start; color: #172A5A; font-weight: 700; }
/* --- Relieve (estilo duo) --- */
.franja-triaje { border-bottom-width: 4px; border-radius: 18px; }
.anterior .ver { border-bottom-width: 3px; border-radius: 10px; }
</style>
