<script setup>
import { cronometro } from '../../dominio/cronometro';
import { textoEspera } from '../../dominio/espera';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import servicio from '../../services/indicadores';
import pacientes from '../../services/pacientes';
import CodigoPaciente from '../../components/comunes/CodigoPaciente.vue';
import Icono from '../../components/comunes/Icono.vue';
import EstadoVacio from '../../components/comunes/EstadoVacio.vue';
import GraficaBarras from '../../components/comunes/GraficaBarras.vue';

/**
 * Pantalla de inicio de preconsulta.
 *
 * Se trabaja con una sola tablet y con la fila esperando. Esta pantalla debe
 * ser la más simple y rápida del sistema: atender a un paciente tiene que
 * tomar menos de medio minuto de toques.
 *
 * Por eso lo operativo va primero y a tamaño grande —la fila de hoy, el
 * buscador y el botón de paciente nuevo— y lo que sirve para analizar queda
 * abajo, plegado. No es una versión reducida de una pantalla de escritorio.
 */
const router = useRouter();

const datos = ref(null);
const series = ref(null);
const error = ref('');
const abriendo = ref(null);

// --- Búsqueda --------------------------------------------------------------
// Solo para el caso excepcional de alguien que no aparece en la fila de hoy.
const buscar = ref('');
const resultados = ref([]);
const buscando = ref(false);

// Tiempo de consulta: de la primera tecla hasta elegir al paciente.
const reloj = cronometro('consulta', 'preconsulta');

let temporizadorBusqueda;
function alEscribir() {
  if (buscar.value) reloj.iniciar();
  else reloj.reiniciar();
  clearTimeout(temporizadorBusqueda);
  if (buscar.value.trim().length < 2) {
    resultados.value = [];
    return;
  }
  temporizadorBusqueda = setTimeout(async () => {
    buscando.value = true;
    try {
      const r = await pacientes.listar({ buscar: buscar.value.trim() });
      resultados.value = r.pacientes.slice(0, 8);
    } catch (fallo) {
      error.value = fallo.message;
    } finally {
      buscando.value = false;
    }
  }, 300);
}

/**
 * Lleva a la toma de signos vitales. La atención se abre al guardarla, no
 * aquí: tocar el botón por error ya no deja a nadie en la cola.
 */
function atender(pacienteId) {
  if (buscar.value) reloj.terminar(pacienteId);
  abriendo.value = pacienteId;
  router.push(`/preconsulta/nueva?paciente=${pacienteId}`);
}

// --- Fila de hoy -----------------------------------------------------------

const fila = computed(() => datos.value?.cola ?? []);

/** Una sola señal de color por fila: o urgente, o espera larga, o nada. */
function senal(e) {
  if (e.gravedad === 'urgente') {
    return { texto: 'Urgente', punto: 'bg-urgente-500', color: 'text-urgente-700' };
  }
  if (e.minutosEsperando >= 90) {
    return { texto: 'Espera larga', punto: 'bg-atencion-500', color: 'text-atencion-700' };
  }
  if (!e.tienePreconsulta) {
    return { texto: 'Falta tomar signos', punto: 'bg-celeste-400', color: 'text-celeste-700' };
  }
  return { texto: 'En orden', punto: 'bg-slate-300', color: 'text-slate-500' };
}

// --- Lo que sirve para organizar el día, no para atender -------------------

const verAnalisis = ref(false);

// A qué hora llega la gente, promediado sobre los últimos 30 días.
const llegadas = computed(() =>
  (series.value?.llegadasPorHora.datos ?? []).map((h) => ({
    etiqueta: h.etiqueta.slice(0, 2),
    total: h.promedioDiario,
  })),
);

const horaPico = computed(() => {
  const lista = llegadas.value;
  let mejor = null;
  lista.forEach((h, i) => {
    if (h.total > 0 && (mejor === null || h.total > lista[mejor].total)) mejor = i;
  });
  return mejor;
});

async function cargar() {
  try {
    const [panel, tendencias] = await Promise.all([
      servicio.panel('preconsulta'),
      servicio.series(),
    ]);
    datos.value = panel;
    series.value = tendencias;
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

let temporizador;
onMounted(() => {
  cargar();
  temporizador = setInterval(cargar, 60000);
});
onUnmounted(() => {
  clearInterval(temporizador);
  clearTimeout(temporizadorBusqueda);
});
</script>

<template>
  <section class="mx-auto max-w-3xl space-y-5">
    <div>
      <h1 class="titulo-pagina">Preconsulta</h1>
      <p class="text-apagado">Toque un paciente para tomarle los signos vitales.</p>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-empeora" />
      <span class="text-tinta-2">{{ error }}</span>
    </p>

    <!-- Lo que no puede esperar -->
    <p v-if="datos?.advertencia" class="aviso aviso-atencion">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-advertencia" />
      <span class="text-tinta-2">{{ datos.resumen.superan90 }} {{ datos.resumen.superan90 === 1 ? 'paciente lleva' : 'pacientes llevan' }} más de 90 minutos esperando. La espera más larga: {{ textoEspera(datos.resumen.esperaMaxima) }}.</span>
    </p>

    <!-- Buscador grande: solo si el paciente no aparece en la fila -->
    <div class="tarjeta p-3">
      <div class="relative">
        <Icono
          nombre="buscar"
          :tamano="24"
          class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-apagado"
        />
        <input
          v-model="buscar"
          type="search"
          placeholder="Buscar paciente que no está en la fila"
          class="h-14 w-full rounded-control border-0 pl-14 pr-4 text-lg text-tinta outline-none
                 placeholder:text-apagado focus:ring-2 focus:ring-mejora/20"
          @input="alEscribir"
        />
      </div>

      <p v-if="buscando" class="px-4 py-3 text-apagado">Buscando...</p>

      <ul v-else-if="resultados.length > 0" class="mt-2 divide-y divide-linea-suave">
        <li v-for="p in resultados" :key="p.id">
          <button
            type="button"
            class="flex min-h-[72px] w-full items-center gap-4 px-2 text-left transition hover:bg-fondo"
            :disabled="abriendo === p.id"
            @click="atender(p.id)"
          >
            <CodigoPaciente :papel="p.expedientePapel" :expediente="p.expediente" tamano="mediano" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-lg font-bold text-tinta">
                {{ p.apellidos }}, {{ p.nombres }}
              </span>
              <span class="block truncate text-apagado">
                {{ p.comunidad }}
              </span>
            </span>
            <Icono nombre="irA" :tamano="22" class="shrink-0 text-apagado" />
          </button>
        </li>
      </ul>

      <p v-else-if="buscar.trim().length >= 2" class="px-4 py-3 text-apagado">
        Sin coincidencias. Revise la escritura.
      </p>
    </div>

    <!-- Fila de hoy: lo que de verdad se usa -->
    <div class="panel">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-linea px-relleno py-4">
        <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">
          Fila de hoy
          <span v-if="fila.length > 0" class="font-normal text-apagado">({{ fila.length }})</span>
        </h2>
        <RouterLink to="/cola" class="enlace">Ver la cola completa &rarr;</RouterLink>
      </div>

      <EstadoVacio
        v-if="fila.length === 0"
        icono="correcto"
        titulo="No hay nadie esperando"
        descripcion="Cuando llegue un paciente, regístrelo y aparecerá aquí."
      />

      <ul v-else class="lista">
        <li v-for="e in fila" :key="e.id">
          <RouterLink
            :to="e.tienePreconsulta ? `/cola` : `/preconsulta/${e.id}`"
            class="flex min-h-[72px] items-center gap-4 px-relleno py-3 transition hover:bg-fondo"
          >
            <CodigoPaciente :papel="e.paciente.expedientePapel" :expediente="e.paciente.expediente" tamano="mediano" />

            <span class="min-w-0 flex-1">
              <span class="block truncate text-lg font-bold text-tinta">
                {{ e.paciente.nombreCompleto }}
              </span>
              <span class="block truncate text-apagado">
                {{ e.paciente.comunidad }} · esperando {{ textoEspera(e.minutosEsperando) }}
              </span>
            </span>

            <span class="flex shrink-0 items-center gap-2 text-sm" :class="senal(e).color">
              <span class="h-2.5 w-2.5 rounded-full" :class="senal(e).punto" />
              {{ senal(e).texto }}
            </span>
          </RouterLink>
        </li>
      </ul>
    </div>

    <!-- Citados que todavía no llegan -->
    <div v-if="datos && datos.citasDeHoySinLlegar.length > 0" class="panel">
      <div class="border-b border-linea px-relleno py-4">
        <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">
          Citados para hoy que no han llegado ({{ datos.citasDeHoySinLlegar.length }})
        </h2>
      </div>
      <ul class="lista">
        <li
          v-for="c in datos.citasDeHoySinLlegar"
          :key="c.pacienteId"
          class="flex min-h-[64px] flex-wrap items-center justify-between gap-3 px-relleno py-3"
        >
          <div class="min-w-0">
            <p class="truncate font-bold text-tinta">
              <span class="mr-2 font-titulo text-xl text-marino tabular-nums">{{ c.expedientePapel || c.expediente }}</span>
              {{ c.nombreCompleto }}
            </p>
            <p class="truncate text-apagado">{{ c.comunidad }}</p>
          </div>
          <button
            type="button"
            class="boton-secundario shrink-0"
            :disabled="abriendo === c.pacienteId"
            @click="atender(c.pacienteId)"
          >
            {{ abriendo === c.pacienteId ? 'Abriendo...' : 'Ya llegó' }}
          </button>
        </li>
      </ul>
    </div>

    <!-- Paciente nuevo: ancho completo, al fondo -->
    <RouterLink
      to="/pacientes/nuevo"
      class="boton-primario flex min-h-[64px] w-full text-lg"
    >
      <Icono nombre="agregar" :tamano="24" /> Paciente nuevo
    </RouterLink>

    <!-- Para organizar el día, no para atender: va plegado -->
    <div v-if="series" class="panel">
      <button
        type="button"
        class="flex min-h-tocable w-full items-center justify-between gap-2 px-relleno py-4 text-left"
        @click="verAnalisis = !verAnalisis"
      >
        <span class="font-titulo text-titulo-seccion font-medium text-tinta">
          A qué hora llega la gente
        </span>
        <Icono :nombre="verAnalisis ? 'volver' : 'irA'" :tamano="20" class="text-apagado" />
      </button>

      <div v-if="verAnalisis" class="border-t border-linea p-relleno">
        <p class="mb-3 text-sm text-apagado">
          Promedio de los últimos 30 días. Sirve para decidir a qué hora reforzar preconsulta.
        </p>
        <GraficaBarras
          :datos="llegadas"
          :destacado="horaPico"
          unidad="llegadas"
          preposicion="a las"
          descripcion-destacado="la hora con más llegadas"
          mensaje-vacio="Aún no hay suficientes registros para ver el patrón de llegadas."
        />
      </div>
    </div>
  </section>
</template>
