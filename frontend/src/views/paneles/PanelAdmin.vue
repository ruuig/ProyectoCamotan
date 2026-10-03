<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import servicio from '../../services/indicadores';
import Icono from '../../components/comunes/Icono.vue';
import PanelAlertas from '../../components/comunes/PanelAlertas.vue';
import TarjetaDecision from '../../components/panel/TarjetaDecision.vue';
import PanelIndicadores from '../../components/panel/PanelIndicadores.vue';
import GraficaAtencionesDia from '../../components/panel/GraficaAtencionesDia.vue';
import BarraProporcional from '../../components/panel/BarraProporcional.vue';
import EsqueletoPanel from '../../components/panel/EsqueletoPanel.vue';

/**
 * Panel de dirección.
 *
 * Lo primero que se ve son las decisiones pendientes, porque es lo único de
 * la pantalla sobre lo que hay que hacer algo hoy. Todo lo demás es contexto
 * para decidir mejor.
 *
 * Todo llega en una sola petición: quien entra a ver cómo va el
 * establecimiento no debería esperar a que se completen cuatro.
 */
const datos = ref(null);
const error = ref('');
const cargando = ref(true);

const periodo = ref('semana');
const PERIODOS = [
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
];

async function cargar() {
  cargando.value = true;
  try {
    datos.value = await servicio.panel('admin', periodo.value);
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

async function cambiarPeriodo(valor) {
  if (periodo.value === valor) return;
  periodo.value = valor;
  await cargar();
}

// --- Decisiones ------------------------------------------------------------

const gestionando = ref(null);

/**
 * Registra que alguien ya actuó. No oculta la tarjeta: la causa sigue viva
 * y el sistema la cerrará solo cuando desaparezca.
 */
async function gestionar(decision) {
  gestionando.value = decision.id;
  try {
    await servicio.gestionarAlerta(decision.id, decision.codigoAccion);
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    gestionando.value = null;
  }
}

// --- Diagnósticos ----------------------------------------------------------

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function nombreMes(valor) {
  if (!valor) return '';
  return MESES[new Date(valor).getMonth()];
}

const subtituloDiagnosticos = computed(() => {
  if (!datos.value) return '';
  const actual = nombreMes(datos.value.diagnosticos.desde);
  const anterior = nombreMes(datos.value.diagnosticos.desdeAnterior);
  if (!actual) return '';
  return `${actual[0].toUpperCase()}${actual.slice(1)}, comparado con ${anterior}`;
});

// La marca del umbral va sobre el mismo horizonte que la barra.
const marcaUmbral = computed(() =>
  datos.value ? datos.value.abastecimiento.umbral / datos.value.abastecimiento.horizonte : null,
);

const CLASE_COLOR = {
  empeora: 'text-empeora',
  advertencia: 'text-advertencia',
  marino: 'text-tinta',
  neutro: 'text-tinta-2',
};

function fecha(valor) {
  return valor ? new Date(valor).toLocaleDateString('es-GT') : '';
}

// --- Codificación pendiente ------------------------------------------------

const codigos = ref({});
const codificando = ref(null);

async function codificar(atencionId) {
  const codigo = (codigos.value[atencionId] ?? '').trim().toUpperCase();
  if (!codigo) return;

  codificando.value = atencionId;
  try {
    await servicio.codificar(atencionId, codigo);
    delete codigos.value[atencionId];
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    codificando.value = null;
  }
}

onMounted(cargar);
</script>

<template>
  <section class="space-y-bloque">
    <!-- Encabezado: qué se está mirando y de qué período -->
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="titulo-pagina">Panel de dirección</h1>
        <p class="text-apagado">{{ datos?.periodo.etiqueta ?? '' }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <div
          class="flex rounded-control border border-linea bg-superficie p-1"
          role="group"
          aria-label="Período del panel"
        >
          <button
            v-for="p in PERIODOS"
            :key="p.valor"
            type="button"
            class="min-h-[2.25rem] rounded-[0.375rem] px-5 font-bold transition-colors"
            :class="periodo === p.valor
              ? 'bg-marino text-superficie'
              : 'text-apagado hover:text-tinta'"
            :aria-pressed="periodo === p.valor"
            @click="cambiarPeriodo(p.valor)"
          >
            {{ p.etiqueta }}
          </button>
        </div>

        <RouterLink to="/consolidado" class="boton-secundario">
          <Icono nombre="consolidado" :tamano="19" /> Ver consolidado
        </RouterLink>
      </div>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-empeora" />
      <span class="text-tinta-2">{{ error }}</span>
    </p>

    <!-- FILA 1. Requiere su decisión -->
    <section class="space-y-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">Requiere su decisión</h2>
        <a v-if="datos && datos.totalAlertas > 0" href="#alertas" class="enlace">
          Ver las {{ datos.totalAlertas }} alertas
        </a>
      </div>

      <EsqueletoPanel v-if="cargando && !datos" forma="decisiones" />

      <div
        v-else-if="datos && datos.decisiones.length > 0"
        class="grid gap-tarjeta panel:grid-cols-3"
      >
        <TarjetaDecision
          v-for="(d, i) in datos.decisiones"
          :key="d.id"
          :decision="d"
          :destacada="i === 0"
          :registrando="gestionando === d.id"
          @gestionar="gestionar"
        />
      </div>

      <!-- Sin decisiones no se dejan tarjetas vacías ocupando la fila -->
      <p v-else-if="datos" class="tarjeta px-relleno py-5 text-apagado">
        No hay decisiones pendientes.
      </p>
    </section>

    <!-- FILA 2. Indicadores -->
    <EsqueletoPanel v-if="cargando && !datos" forma="indicadores" />
    <PanelIndicadores v-else-if="datos" :indicadores="datos.indicadores" />

    <!-- FILA 3. Atenciones por día y diagnósticos del mes -->
    <div class="grid gap-tarjeta panel:grid-cols-3">
      <EsqueletoPanel v-if="cargando && !datos" forma="grafica" class="panel:col-span-2" />
      <div v-else-if="datos" class="panel p-relleno panel:col-span-2">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">
              Atenciones por día
            </h2>
            <p class="text-sm text-apagado">
              {{ periodo === 'mes' ? 'Últimas ocho semanas' : 'Últimas dos semanas' }}
            </p>
          </div>
          <div class="flex items-center gap-4 text-sm text-apagado">
            <span class="flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-[2px] bg-marino" /> Atenciones
            </span>
            <span class="flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-[2px] bg-empeora-claro" /> Urgentes
            </span>
          </div>
        </div>

        <GraficaAtencionesDia :datos="datos.atencionesPorDia" />
      </div>

      <EsqueletoPanel v-if="cargando && !datos" forma="lista" />
      <div v-else-if="datos" class="panel p-relleno">
        <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">
          Diagnósticos del mes
        </h2>
        <p class="text-sm text-apagado">{{ subtituloDiagnosticos }}</p>

        <p v-if="datos.diagnosticos.lista.length === 0" class="mt-5 text-apagado">
          Sin diagnósticos codificados este mes.
        </p>

        <ul v-else class="mt-5 space-y-4">
          <li v-for="d in datos.diagnosticos.lista" :key="d.codigo">
            <div class="flex items-baseline justify-between gap-3">
              <span class="min-w-0 truncate text-tinta-2">{{ d.nombre ?? d.codigo }}</span>
              <span class="flex shrink-0 items-baseline gap-2">
                <span v-if="d.repunte" class="text-sm font-bold text-empeora">
                  subió {{ d.subida }} %
                </span>
                <strong class="tabular-nums text-tinta">{{ d.casos }}</strong>
              </span>
            </div>
            <BarraProporcional
              class="mt-1.5"
              :proporcion="d.proporcion"
              :color="d.repunte ? 'empeora' : 'marino'"
            />
          </li>
        </ul>
      </div>
    </div>

    <!-- FILA 4. Abastecimiento y comunidades -->
    <div class="grid gap-tarjeta panel:grid-cols-2">
      <EsqueletoPanel v-if="cargando && !datos" forma="lista" />
      <div v-else-if="datos" class="panel p-relleno">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">Abastecimiento</h2>
            <p class="text-sm text-apagado">Días que alcanza cada insumo al consumo actual</p>
          </div>
          <p class="flex items-center gap-1.5 text-sm text-apagado">
            <span class="h-3.5 w-px bg-tinta-2" />
            Mínimo de {{ datos.abastecimiento.umbral }} días
          </p>
        </div>

        <p v-if="datos.abastecimiento.lista.length === 0" class="mt-5 text-apagado">
          No hay insumos activos registrados.
        </p>

        <ul v-else class="mt-5 space-y-4">
          <li
            v-for="i in datos.abastecimiento.lista"
            :key="i.insumoId"
            class="flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <RouterLink :to="`/inventario/${i.insumoId}`" class="min-w-0 flex-1">
              <span class="block truncate text-tinta-2 hover:text-tinta hover:underline">
                {{ i.nombre }}
              </span>
              <span class="block text-sm text-apagado">
                {{ i.sinExistencia ? 'Sin existencia' : `${i.saldo} ${i.unidad}` }}
              </span>
            </RouterLink>

            <BarraProporcional
              class="w-full min-w-[8rem] shrink-0 sm:w-40"
              :proporcion="i.proporcion"
              :color="i.color"
              :umbral="marcaUmbral"
            />

            <!-- Sin historial de consumo no se afirma un número de días -->
            <span
              class="w-28 shrink-0 text-right font-bold tabular-nums"
              :class="CLASE_COLOR[i.color] ?? 'text-apagado'"
            >
              {{ i.sinConsumo ? 'Sin datos de consumo' : `${i.dias} días` }}
            </span>
          </li>
        </ul>
      </div>

      <EsqueletoPanel v-if="cargando && !datos" forma="lista" />
      <div v-else-if="datos" class="panel p-relleno">
        <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">
          Comunidades con rezago
        </h2>
        <p class="text-sm text-apagado">Días desde la última atención registrada</p>

        <p v-if="datos.comunidades.lista.length === 0" class="mt-5 text-apagado">
          Ninguna comunidad con pacientes registrados.
        </p>

        <ul v-else class="mt-5 space-y-4">
          <li
            v-for="c in datos.comunidades.lista"
            :key="c.lugarId"
            class="flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <div class="min-w-0 flex-1">
              <span class="block truncate font-bold text-tinta">{{ c.nombre }}</span>
              <span class="block text-sm text-apagado">
                {{ c.pacientes }} {{ c.pacientes === 1 ? 'paciente' : 'pacientes' }}
              </span>
            </div>

            <BarraProporcional
              class="w-full min-w-[8rem] shrink-0 sm:w-40"
              :proporcion="c.proporcion"
              :color="c.color"
            />

            <span
              class="w-28 shrink-0 text-right font-bold tabular-nums"
              :class="CLASE_COLOR[c.color] ?? 'text-apagado'"
            >
              {{ c.dias === null ? 'Nunca atendida' : `${c.dias} días` }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Consultas sin código CIE-10 -->
    <div v-if="datos && datos.pendientesDeCodificar.length > 0" class="panel">
      <div class="border-b border-linea px-relleno py-4">
        <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">
          Pendientes de codificar ({{ datos.pendientesDeCodificar.length }})
        </h2>
        <p class="text-sm text-apagado">
          El consolidado SIGSA no las incluye hasta que se les asigne un código.
        </p>
      </div>

      <ul class="lista">
        <li
          v-for="a in datos.pendientesDeCodificar"
          :key="a.id"
          class="flex flex-wrap items-end justify-between gap-4 px-relleno py-4"
        >
          <div class="min-w-0">
            <RouterLink
              :to="`/pacientes/${a.paciente.id}`"
              class="font-bold text-tinta hover:underline"
            >
              {{ a.paciente.apellidos }}, {{ a.paciente.nombres }}
            </RouterLink>
            <p class="text-tinta-2">{{ a.diagnosticoTxt }}</p>
            <p class="text-sm text-apagado">
              Exp. {{ a.paciente.expediente }} &middot; cerrada el {{ fecha(a.cerradaEn) }}
            </p>
          </div>

          <form class="flex shrink-0 items-end gap-2" @submit.prevent="codificar(a.id)">
            <div>
              <label :for="`cie-${a.id}`" class="etiqueta-campo">Código CIE-10</label>
              <input
                :id="`cie-${a.id}`"
                v-model="codigos[a.id]"
                placeholder="J06.9"
                class="campo w-36 font-mono uppercase"
              />
            </div>
            <button
              type="submit"
              class="boton-secundario"
              :disabled="codificando === a.id || !(codigos[a.id] ?? '').trim()"
            >
              {{ codificando === a.id ? 'Guardando...' : 'Asignar' }}
            </button>
          </form>
        </li>
      </ul>
    </div>

    <!-- Todas las alertas abiertas, incluidas las clínicas -->
    <div v-if="datos" id="alertas" class="scroll-mt-24">
      <PanelAlertas :alertas="datos.alertas" />
    </div>
  </section>
</template>
