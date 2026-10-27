<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { RouterLink } from 'vue-router';
import servicio from '../../services/indicadores';
import CodigoPaciente from '../../components/comunes/CodigoPaciente.vue';
import Icono from '../../components/comunes/Icono.vue';
import Etiqueta from '../../components/comunes/Etiqueta.vue';
import EstadoVacio from '../../components/comunes/EstadoVacio.vue';
import CodificarCie from '../../components/consulta/CodificarCie.vue';
import TarjetaCifra from '../../components/paneles/TarjetaCifra.vue';
import { textoEspera, deOtroDia } from '../../dominio/espera';

const fechaCorta = (f) => new Date(f).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', timeZone: 'America/Guatemala' });

const datos = ref(null);
const error = ref('');

// La severidad se marca con un borde y el color del icono, no con un bloque
// de fondo: varias alertas juntas en bloques saturados tapan el resto.
const ESTILO_SEVERIDAD = {
  alta: { borde: 'border-l-urgente-500', icono: 'text-urgente-600' },
  media: { borde: 'border-l-atencion-500', icono: 'text-atencion-600' },
  baja: { borde: 'border-l-slate-300', icono: 'text-slate-400' },
};

const ICONO_ALERTA = {
  signo_vital: 'alerta',
  desnutricion: 'crecimiento',
  patron_clinico: 'consulta',
};

const TONO_GRAVEDAD = { urgente: 'urgente', moderado: 'atencion', leve: 'neutro' };

// Por qué el paciente tiene esa prioridad: lo que encontró la preconsulta.
const motivosSiguiente = computed(() => datos.value?.siguiente?.preconsulta?.triaje?.motivos ?? []);
const clinicos = (e) => e.factores.filter((f) => f.tipo === 'clinico' || f.tipo === 'espera_excedida');
const otros = (e) => e.factores.filter((f) => f.tipo === 'condicion' || f.tipo === 'distancia');
const quitarCodificada = (id) => { datos.value.porCodificar = datos.value.porCodificar.filter((a) => a.id !== id); };

const ETIQUETA_CONDICION = {
  embarazo: 'Embarazo',
  menor_5: 'Menor de 5',
  adulto_mayor: 'Adulto mayor',
  discapacidad: 'Discapacidad',
};

function edad(nacimiento) {
  const dias = (Date.now() - new Date(nacimiento)) / 86400000;
  const anios = Math.floor(dias / 365.25);
  return anios >= 1 ? `${anios} años` : `${Math.floor(dias / 30.4375)} meses`;
}

// Signos vitales como fichas legibles, no como una lista de campos.
const VITALES = [
  { clave: 'temperatura', etiqueta: 'Temp.', unidad: '°C' },
  { clave: 'presion', etiqueta: 'Presión', unidad: '' },
  { clave: 'frecCardiaca', etiqueta: 'F. card.', unidad: 'lpm' },
  { clave: 'frecRespiratoria', etiqueta: 'F. resp.', unidad: 'rpm' },
  { clave: 'satOxigeno', etiqueta: 'SatO2', unidad: '%' },
  { clave: 'peso', etiqueta: 'Peso', unidad: 'kg' },
  { clave: 'talla', etiqueta: 'Talla', unidad: 'cm' },
];

const vitales = computed(() => {
  const p = datos.value?.siguiente?.preconsulta;
  if (!p) return [];

  return VITALES.map((v) => {
    const valor = v.clave === 'presion'
      ? (p.presionSis && p.presionDia ? `${p.presionSis}/${p.presionDia}` : null)
      : p[v.clave];
    return { ...v, valor };
  }).filter((v) => v.valor !== null && v.valor !== undefined);
});

// Los campos que el medico vio marcados en alerta, para resaltarlos.
const camposEnAlerta = computed(() => {
  const alertas = datos.value?.siguiente?.alertas ?? [];
  return new Set(alertas.filter((a) => a.tipo === 'signo_vital').map((a) => a.detalle?.campo));
});

async function cargar() {
  try {
    datos.value = await servicio.panel('medico');
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
onUnmounted(() => clearInterval(temporizador));
</script>

<template>
  <section v-if="datos" class="space-y-5">
    <div v-if="datos.jornada.aviso" class="aviso aviso-atencion">
      <Icono nombre="reloj" :tamano="20" class="mt-0.5 shrink-0 text-atencion-600" />
      <p class="text-slate-700">{{ datos.jornada.aviso }}</p>
    </div>

    <div class="grid gap-5 xl:grid-cols-3">
      <!-- COLUMNA PRINCIPAL: el paciente -->
      <div class="space-y-5 xl:col-span-2">
        <template v-if="datos.siguiente">
          <article class="panel">
            <!-- Cabecera del paciente: siempre institucional. La urgencia se
                 dice con palabras, no cambiando el color de media pantalla. -->
            <header class="bg-mspas-700 px-6 py-5 text-white">
              <p class="flex items-center gap-2 font-medium text-celeste-200">
                <span
                  v-if="datos.siguiente.atencion.estado === 'en_atencion'"
                  class="relative flex h-2 w-2"
                >
                  <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span class="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                {{ datos.siguiente.atencion.estado !== 'en_atencion'
                  ? 'Siguiente paciente'
                  : deOtroDia(datos.siguiente.atencion)
                    ? `Consulta abierta desde el ${fechaCorta(datos.siguiente.atencion.registradaEn)}: termínela o cancélela`
                    : 'En consulta ahora' }}
              </p>

              <div class="mt-2 flex flex-wrap items-center gap-4">
                <CodigoPaciente
                  :papel="datos.siguiente.paciente.expedientePapel"
                  :expediente="datos.siguiente.paciente.expediente"
                  invertido
                />
                <div class="min-w-0">
                  <h1 class="text-3xl font-semibold leading-tight text-white">
                    {{ datos.siguiente.paciente.nombreCompleto }}
                  </h1>
                  <p class="mt-1.5 text-celeste-100">
                    {{ edad(datos.siguiente.paciente.fechaNacimiento) }} &middot;
                    {{ datos.siguiente.paciente.comunidad }}
                  </p>
                </div>
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-2">
                <span
                  class="rounded-lg px-2.5 py-1 capitalize"
                  :class="datos.siguiente.atencion.gravedad === 'urgente'
                    ? 'bg-white font-semibold text-urgente-700'
                    : 'border border-white/40 text-white'"
                >
                  {{ datos.siguiente.atencion.gravedad }}
                </span>
                <span
                  v-for="c in datos.siguiente.paciente.condiciones"
                  :key="c"
                  class="rounded-lg border border-white/40 px-2.5 py-1 text-white"
                >
                  {{ ETIQUETA_CONDICION[c] ?? c }}
                </span>
              </div>

              <ul v-if="motivosSiguiente.length" class="mt-3 flex flex-wrap gap-2" aria-label="Por qué tiene esta prioridad">
                <li
                  v-for="m in motivosSiguiente"
                  :key="m.texto"
                  class="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-sm font-bold"
                  :class="m.nivel === 'urgente' ? 'text-urgente-700' : 'text-atencion-700'"
                >
                  <Icono nombre="alerta" :tamano="15" /> {{ m.texto }}
                </li>
              </ul>

              <p class="mt-4 border-t border-white/20 pt-4">
                <span class="text-celeste-200">Motivo: </span>
                <span class="font-medium text-white">{{ datos.siguiente.atencion.motivoConsulta }}</span>
              </p>

              <!-- La accion cierra el bloque: se lee el caso y luego se actua. -->
              <RouterLink
                v-if="datos.siguiente.atencion.estado === 'en_atencion'"
                :to="`/consulta/${datos.siguiente.atencion.id}`"
                class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5
                       font-semibold text-mspas-700 transition hover:bg-celeste-50 sm:w-auto"
              >
                <Icono nombre="consulta" :tamano="19" /> Atender a este paciente
              </RouterLink>
              <RouterLink
                v-else
                to="/cola"
                class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border
                       border-white/40 px-5 py-3.5 font-medium text-white transition
                       hover:bg-white/10 sm:w-auto"
              >
                <Icono nombre="llamar" :tamano="19" /> Llamar desde la cola
              </RouterLink>
            </header>

            <!-- Alertas clinicas -->
            <div v-if="datos.siguiente.alertas.length > 0" class="space-y-2 border-b border-slate-200 p-5">
              <div
                v-for="(a, i) in datos.siguiente.alertas"
                :key="i"
                class="flex items-start gap-3 border-l-4 bg-slate-50 px-4 py-3"
                :class="ESTILO_SEVERIDAD[a.severidad].borde"
                role="alert"
              >
                <Icono
                  :nombre="ICONO_ALERTA[a.tipo] ?? 'alerta'"
                  :tamano="20"
                  class="mt-0.5 shrink-0"
                  :class="ESTILO_SEVERIDAD[a.severidad].icono"
                />
                <p class="font-medium text-slate-800">{{ a.mensaje }}</p>
              </div>
            </div>
            <div v-else class="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
              <Icono nombre="correcto" :tamano="19" class="text-estable-600" />
              <p class="text-slate-600">Sin alertas clínicas.</p>
            </div>

            <!-- Signos vitales -->
            <div class="p-5">
              <p class="mb-3 text-sm font-semibold text-slate-500">Signos vitales de preconsulta</p>
              <div v-if="vitales.length > 0" class="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <div
                  v-for="v in vitales"
                  :key="v.clave"
                  class="border-l-4 pl-3"
                  :class="camposEnAlerta.has(v.clave) ? 'border-l-urgente-500' : 'border-l-slate-200'"
                >
                  <p class="text-sm text-slate-500">{{ v.etiqueta }}</p>
                  <p
                    class="text-xl font-semibold tabular-nums"
                    :class="camposEnAlerta.has(v.clave) ? 'text-urgente-700' : 'text-slate-800'"
                  >
                    {{ v.valor }}<span class="text-sm font-normal text-slate-500">{{ v.unidad }}</span>
                  </p>
                </div>
              </div>
              <div
                v-else
                class="flex items-center gap-2 border-l-4 border-l-atencion-500 bg-slate-50 px-4 py-3"
              >
                <Icono nombre="alerta" :tamano="19" class="shrink-0 text-atencion-600" />
                <p class="text-slate-700">Este paciente aún no tiene preconsulta registrada.</p>
              </div>
            </div>
          </article>
        </template>

        <!-- Cola vacia -->
        <div v-else class="panel">
          <EstadoVacio
            icono="correcto"
            titulo="No hay pacientes esperando"
            descripcion="La jornada esta al día. Abajo, el resumen de lo atendido hoy."
          />
        </div>

        <!-- Resumen del dia: cuánto se ha hecho y cuánto falta -->
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TarjetaCifra titulo="Atendidos hoy" :valor="datos.resumenDia.atendidos" icono="correcto" />
          <TarjetaCifra titulo="Esperando" :valor="datos.enEspera" icono="cola" :tono="datos.superan90 ? 'atencion' : 'neutro'" :nota="datos.enEspera ? `La espera más larga: ${textoEspera(datos.esperaMaxima)}` : 'Nadie en la cola'" a="/cola" />
          <TarjetaCifra titulo="Ausentes" :valor="datos.resumenDia.ausentes" icono="ausente" nota="Llamados que no respondieron" />
          <TarjetaCifra titulo="Consulta promedio" :valor="datos.resumenDia.duracionPromedioMin ?? '—'" :unidad="datos.resumenDia.duracionPromedioMin ? 'min' : ''" icono="reloj" :nota="datos.resumenDia.duracionPromedioMin ? '' : 'Sin consultas cerradas hoy'" />
        </div>

        <!-- Lo ya atendido hoy: contexto de la jornada sin cambiar de pantalla -->
        <div v-if="datos.atendidosHoy.length > 0" class="panel">
          <header class="panel-encabezado">
            <h2 class="panel-titulo">
              <Icono nombre="correcto" :tamano="20" class="text-celeste-400" />
              Consultas cerradas hoy
            </h2>
          </header>
          <ul class="lista">
            <li
              v-for="a in datos.atendidosHoy"
              :key="a.id"
              class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div class="min-w-0">
                <p class="truncate font-medium text-slate-900">{{ a.paciente.nombreCompleto }}</p>
                <p class="truncate text-slate-500">
                  <span v-if="a.diagnosticoCie" class="font-mono">{{ a.diagnosticoCie }}</span>
                  {{ a.diagnosticoTxt }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-3">
                <Etiqueta :tono="TONO_GRAVEDAD[a.gravedad]" punto>{{ a.gravedad }}</Etiqueta>
                <span v-if="a.duracionMin !== null" class="tabular-nums text-slate-500">
                  {{ a.duracionMin }} min
                </span>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <!-- COLUMNA LATERAL: la cola y lo que falta codificar -->
      <div class="space-y-5 self-start">
      <aside class="panel">
        <header class="panel-encabezado">
          <h2 class="panel-titulo">
            <Icono nombre="cola" :tamano="20" class="text-celeste-400" />
            En espera ({{ datos.enEspera }})
          </h2>
          <RouterLink to="/cola" class="enlace">Ver todo</RouterLink>
        </header>

        <EstadoVacio v-if="datos.cola.length === 0" icono="correcto" titulo="Nadie en espera" />
        <ol v-else class="lista">
          <li v-for="(e, i) in datos.cola" :key="e.id" class="en-cola" :class="`nivel-${e.nivel ?? e.gravedad}`">
            <span class="posicion" :class="i === 0 ? 'primero' : ''">{{ i + 1 }}</span>
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-2">
                <span class="nivel">{{ (e.nivel ?? e.gravedad) === 'urgente' ? 'Urgente' : (e.nivel ?? e.gravedad) === 'moderado' ? 'Moderado' : 'Leve' }}</span>
                <span class="truncate font-medium text-slate-900">{{ e.paciente.nombreCompleto }}</span>
              </p>
              <p class="truncate text-sm text-slate-500">{{ e.motivoConsulta }}</p>
              <!-- Por que esta en esa posicion, en palabras -->
              <p v-if="clinicos(e).length" class="mt-0.5 text-sm font-semibold" :class="(e.nivel ?? e.gravedad) === 'urgente' ? 'text-urgente-700' : 'text-atencion-700'">
                {{ clinicos(e).map((f) => f.etiqueta).join(' · ') }}
              </p>
              <p v-if="otros(e).length" class="truncate text-xs font-semibold text-slate-500">{{ otros(e).map((f) => f.etiqueta).join(' · ') }}</p>
            </div>
            <span class="shrink-0 tabular-nums" :class="e.excedido ? 'font-bold text-urgente-700' : 'text-slate-500'" :title="e.excedido ? 'Tiempo máximo excedido' : ''">
              {{ textoEspera(e.minutosEsperando) }}
            </span>
          </li>
        </ol>

        <div
          v-if="datos.superan90 > 0"
          class="flex items-center gap-2 border-t border-slate-200 px-5 py-3.5"
        >
          <Icono nombre="alerta" :tamano="19" class="shrink-0 text-urgente-600" />
          <p class="font-medium text-slate-700">
            {{ datos.superan90 }} esperan más de 90 minutos (la más larga: {{ textoEspera(datos.esperaMaxima) }})
          </p>
        </div>
      </aside>

      <aside v-if="datos.porCodificar?.length" class="panel">
        <header class="panel-encabezado">
          <h2 class="panel-titulo">
            <Icono nombre="consulta" :tamano="20" class="text-celeste-400" />
            Por codificar
          </h2>
          <span class="contador">{{ datos.porCodificar.length }}</span>
        </header>
        <ul class="max-h-[420px] overflow-y-auto">
          <CodificarCie v-for="a in datos.porCodificar" :key="a.id" :atencion="a" @codificada="quitarCodificada" />
        </ul>
      </aside>
      </div>
    </div>
  </section>

  <section v-else>
    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-urgente-600" />
      <span class="text-slate-700">{{ error }}</span>
    </p>
    <p v-else class="text-slate-500">Cargando panel...</p>
  </section>
</template>

<style scoped>
.contador { min-width: 28px; padding: 2px 8px; border-radius: 8px; background: #FFF4D6; color: #8A5A06; font-weight: 800; text-align: center; }
.en-cola { display: flex; align-items: flex-start; gap: 12px; padding: 12px 18px 12px 14px; border-left: 4px solid transparent; }
.en-cola.nivel-urgente { border-left-color: #C03535; }
.en-cola.nivel-moderado { border-left-color: #E8930C; }
.en-cola.nivel-leve { border-left-color: #22A06B; }
.posicion { width: 26px; height: 26px; flex-shrink: 0; display: grid; place-items: center; border-radius: 8px; background: #EEF2F6; font-weight: 800; font-size: 13px; color: #475569; font-variant-numeric: tabular-nums; }
.posicion.primero { background: #172A5A; color: #fff; }
.nivel { flex-shrink: 0; padding: 1px 8px; border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.nivel-urgente .nivel { background: #FDECEC; color: #A52A2A; }
.nivel-moderado .nivel { background: #FFF4D6; color: #8A5A06; }
.nivel-leve .nivel { background: #E2F5EA; color: #145C3C; }
/* --- Relieve (estilo duo) --- */
.posicion { border-radius: 10px; }
.contador { border-radius: 10px; }
</style>
