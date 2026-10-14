<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/pacientes';
import inventario from '../../services/inventario';
import { useAuthStore } from '../../stores/auth';
import BloqueAntropometria from '../../components/comunes/BloqueAntropometria.vue';
import Icono from '../../components/comunes/Icono.vue';
import HojaAnterior from '../../components/consulta/HojaAnterior.vue';

/**
 * Expediente del paciente.
 *
 * El orden responde a lo que se necesita saber, en ese orden: quién es, qué
 * cambia cómo se le atiende, qué hay que hacer hoy, y después la historia.
 *
 * Antes la pantalla abría con dos botones sueltos y tres avisos antes de
 * decir siquiera el nombre del paciente.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const paciente = ref(null);
const atenciones = ref([]);
// La hoja completa de una consulta: la leen médico, preconsulta y dirección.
const hojaAbierta = ref(null);
const puedeVerHoja = computed(() => ['admin', 'medico', 'preconsulta'].includes(auth.rol));
const insumos = ref(null);
const error = ref('');
const abriendo = ref(false);

const puedeRegistrar = computed(() => ['admin', 'preconsulta', 'medico'].includes(auth.rol));

// --- Cómo se lee cada cosa -------------------------------------------------

const ETIQUETA_CONDICION = {
  menor_5: 'Menor de 5 años',
  adulto_mayor: 'Persona mayor',
  discapacidad: 'Discapacidad',
  desnutricion: 'Desnutrición',
};

// Solo la desnutrición pide actuar; el resto es contexto.
const CONDICION_URGENTE = ['desnutricion'];

const ESTADO_ATENCION = {
  atendido: { texto: 'Atendida', clase: 'text-apagado' },
  en_espera: { texto: 'En espera', clase: 'text-advertencia' },
  en_atencion: { texto: 'En consulta', clase: 'text-mejora' },
  ausente: { texto: 'Ausente', clase: 'text-apagado' },
  cancelada: { texto: 'Cancelada', clase: 'text-apagado' },
};

const GRAVEDAD = {
  urgente: { texto: 'Urgente', clase: 'text-empeora' },
  moderado: { texto: 'Moderado', clase: 'text-advertencia' },
  leve: { texto: 'Leve', clase: 'text-apagado' },
};

const CLASE_ESTADO = { atendido: 'agotado', en_espera: 'cuarentena', en_atencion: 'disponible', ausente: 'agotado' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function edadLegible(edad) {
  if (!edad) return '';
  if (edad.anios >= 1) {
    return edad.meses > 0 ? `${edad.anios} años ${edad.meses} meses` : `${edad.anios} años`;
  }
  return `${edad.edadMeses} meses`;
}

function fecha(valor) {
  return valor ? new Date(valor).toLocaleDateString('es-GT') : '';
}

const atencionAbierta = computed(() =>
  atenciones.value.find((a) => ['en_espera', 'en_atencion'].includes(a.estado)),
);

const cerradas = computed(() => atenciones.value.filter((a) => a.estado === 'atendido'));

const ultimaAtencion = computed(() => cerradas.value[0] ?? null);

/** Lo que cambia cómo se atiende a esta persona, en una sola fila de etiquetas. */
const distintivos = computed(() => {
  const p = paciente.value;
  if (!p) return [];

  const lista = [];
  if (p.embarazo) lista.push({ texto: p.embarazo.texto, urgente: true });

  for (const c of p.condiciones ?? []) {
    lista.push({
      texto: ETIQUETA_CONDICION[c.tipo] ?? c.tipo,
      urgente: CONDICION_URGENTE.includes(c.tipo),
    });
  }
  return lista;
});

// --- Atención --------------------------------------------------------------

async function abrirAtencion() {
  // Preconsulta: la atención se abre al guardar la toma de signos.
  if (auth.rol !== 'medico') {
    router.push(`/preconsulta/nueva?paciente=${paciente.value.id}`);
    return;
  }
  // El médico atiende sin preconsulta cuando no está cubierta: se abre ya.
  abriendo.value = true;
  error.value = '';
  try {
    await servicio.crearAtencion({ pacienteId: paciente.value.id });
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    abriendo.value = false;
  }
}

// --- Cancelar una atención abierta por error ------------------------------------
const cancelando = ref(false);
const motivoCancelacion = ref('');

async function cancelarAtencion() {
  error.value = '';
  try {
    await servicio.cancelarAtencion(atencionAbierta.value.id, motivoCancelacion.value.trim());
    cancelando.value = false;
    motivoCancelacion.value = '';
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

// --- Embarazo como episodio ------------------------------------------------

const panelEmbarazo = ref(false);
const cerrandoEmbarazo = ref(false);
const motivoCierre = ref('');
const embarazo = reactive({ fechaUltimaRegla: '', semanasAlRegistrar: '' });

const ofreceEmbarazo = computed(
  () =>
    puedeRegistrar.value
    && paciente.value?.sexo === 'F'
    && paciente.value?.edad.anios >= 10
    && !paciente.value?.embarazo,
);

async function abrirEmbarazo() {
  try {
    await servicio.abrirEmbarazo(route.params.id, {
      ...(embarazo.fechaUltimaRegla ? { fechaUltimaRegla: embarazo.fechaUltimaRegla } : {}),
      ...(embarazo.semanasAlRegistrar
        ? { semanasAlRegistrar: Number(String(embarazo.semanasAlRegistrar).replace(/[^0-9]/g, '')) }
        : {}),
    });
    panelEmbarazo.value = false;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function cerrarEmbarazo() {
  try {
    await servicio.cerrarEmbarazo(route.params.id, motivoCierre.value);
    cerrandoEmbarazo.value = false;
    motivoCierre.value = '';
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

// --- Carga -----------------------------------------------------------------

async function cargar() {
  error.value = '';
  try {
    const [datos, historial] = await Promise.all([
      servicio.obtener(route.params.id),
      servicio.historial(route.params.id),
    ]);
    paciente.value = datos.paciente;
    atenciones.value = historial.atenciones;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function cargarInsumos() {
  try {
    insumos.value = await inventario.insumosDePaciente(route.params.id);
  } catch {
    // Farmacia y clínica comparten esta vista; si el rol no alcanza, la
    // sección simplemente no aparece.
  }
}

onMounted(() => {
  cargar();
  cargarInsumos();
});
</script>

<template>
  <section v-if="paciente">
    <RouterLink to="/pacientes" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Pacientes</RouterLink>

    <p v-if="error" role="alert" class="b-aviso error mb-4">{{ error }}</p>

    <!-- Quién es -->
    <header class="b-panel encabezado">
      <span class="codigo" :class="paciente.expedientePapel ? '' : 'sin-papel'">
        <small>{{ paciente.expedientePapel ? 'Ficha' : 'Expediente' }}</small>
        <b>{{ paciente.expedientePapel || paciente.expediente }}</b>
        <small>{{ paciente.expedientePapel ? `Exp. ${paciente.expediente}` : 'sin ficha de papel' }}</small>
      </span>
      <div class="min-w-0 flex-1">
        <h1 class="b-titulo">{{ paciente.apellidos }}, {{ paciente.nombres }}</h1>
        <p class="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-apagado">
          <span v-if="paciente.cui" class="tabular-nums">CUI {{ paciente.cui }}</span>
          <span v-for="d in distintivos" :key="d.texto" class="b-estado" :class="d.urgente ? 'retirado' : 'agotado'">{{ d.texto }}</span>
        </p>
      </div>
      <div class="b-acciones">
        <RouterLink :to="`/imprimir/expediente/${$route.params.id}`" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> Resumen</RouterLink>
        <RouterLink :to="`/pacientes/${$route.params.id}/ficha`" class="b-btn secundario"><Icono nombre="lapiz" :tamano="20" /> Ficha</RouterLink>
        <template v-if="puedeRegistrar">
          <RouterLink v-if="atencionAbierta && !atencionAbierta.preconsulta" :to="`/preconsulta/${atencionAbierta.id}`" class="b-btn primario"><Icono nombre="agregar" :tamano="20" /> Registrar preconsulta</RouterLink>
          <button v-else-if="!atencionAbierta" type="button" class="b-btn primario" :disabled="abriendo" @click="abrirAtencion">
            <Icono nombre="agregar" :tamano="20" /> {{ abriendo ? 'Abriendo…' : 'Abrir atención' }}
          </button>
        </template>
      </div>
    </header>

    <!-- Datos -->
    <dl class="datos mt-4">
      <div><dt>Edad</dt><dd>{{ edadLegible(paciente.edad) }}<small v-if="paciente.fechaNacimientoEstimada"> aprox.</small></dd></div>
      <div><dt>Sexo</dt><dd>{{ paciente.sexo === 'M' ? 'Hombre' : 'Mujer' }}</dd></div>
      <div><dt>Comunidad</dt><dd>{{ paciente.comunidad }}</dd></div>
      <div><dt>Teléfono</dt><dd :class="paciente.telefono ? '' : 'vacio'">{{ paciente.telefono || '—' }}</dd></div>
      <div v-if="paciente.responsableNombre"><dt>Responsable</dt><dd>{{ paciente.responsableNombre }}<small v-if="paciente.responsableParentesco"> · {{ paciente.responsableParentesco }}</small></dd></div>
      <div><dt>Última atención</dt><dd :class="ultimaAtencion ? '' : 'vacio'">{{ ultimaAtencion ? fecha(ultimaAtencion.registradaEn) : 'Nunca' }}<small v-if="cerradas.length"> · {{ cerradas.length }} en total</small></dd></div>
    </dl>

    <!-- Lo que pide hacer algo -->
    <div v-if="atencionAbierta" class="b-aviso ok mt-4 flex-wrap items-center justify-between gap-2">
      <span>Atención {{ ESTADO_ATENCION[atencionAbierta.estado].texto.toLowerCase() }}<template v-if="atencionAbierta.preconsulta"> · preconsulta registrada</template></span>
      <button v-if="puedeRegistrar && !cancelando" type="button" class="b-btn secundario chico" @click="cancelando = true">Cancelar atención</button>
    </div>
    <form v-if="cancelando" class="b-panel mt-3 flex flex-wrap items-end gap-3 p-4" @submit.prevent="cancelarAtencion">
      <div class="min-w-[16rem] flex-1">
        <label for="motivo-cancelar" class="b-etiqueta">Por qué se cancela</label>
        <input id="motivo-cancelar" v-model="motivoCancelacion" required minlength="5" placeholder="Ej.: se abrió por error, era otro paciente" class="b-campo" />
      </div>
      <button type="button" class="b-btn secundario" @click="cancelando = false">No cancelar</button>
      <button type="submit" class="b-btn primario" :disabled="motivoCancelacion.trim().length < 5">Cancelar atención</button>
    </form>
    <div v-if="insumos && insumos.conRetiroActivo > 0" class="b-aviso error mt-4 flex-col">
      <span>Recibió {{ insumos.conRetiroActivo }} {{ insumos.conRetiroActivo === 1 ? 'producto' : 'productos' }} bajo retiro sanitario</span>
      <ul class="text-sm">
        <li v-for="e in insumos.entregas.filter((x) => x.retiro)" :key="e.movimientoId">{{ e.insumo.nombreGenerico }} · lote {{ e.lote.numeroLote }} · {{ e.retiro.referencia }}</li>
      </ul>
    </div>
    <div v-if="paciente.ficha && !paciente.ficha.completa" class="b-aviso atencion mt-4 items-center justify-between">
      <span>Faltan {{ paciente.ficha.faltantes.length }} datos de la ficha: {{ paciente.ficha.faltantes.map((f) => f.etiqueta.toLowerCase()).join(', ') }}</span>
      <RouterLink :to="`/pacientes/${$route.params.id}/ficha`" class="b-btn secundario chico shrink-0">Completar</RouterLink>
    </div>

    <!-- Embarazo activo -->
    <div v-if="paciente.embarazo" class="b-panel embarazo mt-4">
      <div class="min-w-0 flex-1">
        <p class="font-bold text-tinta">{{ paciente.embarazo.texto }}</p>
        <p v-if="paciente.embarazo.fechaProbableParto" class="text-sm font-semibold text-apagado">Parto probable {{ fecha(paciente.embarazo.fechaProbableParto) }}</p>
      </div>
      <form v-if="cerrandoEmbarazo" class="flex flex-wrap items-center gap-2" @submit.prevent="cerrarEmbarazo">
        <input v-model="motivoCierre" required minlength="3" placeholder="Motivo del cierre" aria-label="Motivo del cierre" class="b-campo w-[260px]" />
        <button type="submit" class="b-btn primario chico">Cerrar</button>
        <button type="button" class="b-btn secundario chico" @click="cerrandoEmbarazo = false">Cancelar</button>
      </form>
      <button v-else-if="puedeRegistrar" type="button" class="b-btn secundario chico" @click="cerrandoEmbarazo = true">Cerrar embarazo</button>
    </div>

    <!-- Dos columnas -->
    <div class="columnas mt-5">
      <section class="b-panel">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">Historial de atenciones</h2>
          <span class="b-contador gris">{{ atenciones.length }}</span>
        </header>
        <ol v-if="atenciones.length" class="historial">
          <li v-for="a in atenciones" :key="a.id">
            <span class="dia">
              <b>{{ new Date(a.registradaEn).getDate() }}</b>
              <small>{{ MESES[new Date(a.registradaEn).getMonth()] }} {{ new Date(a.registradaEn).getFullYear() }}</small>
            </span>
            <span class="min-w-0 flex-1">
              <b class="block text-tinta">{{ a.diagnosticoTxt || a.motivoConsulta || 'Sin diagnóstico' }}</b>
              <span class="mt-1 flex flex-wrap items-center gap-2">
                <span v-if="a.diagnosticoCie" class="cie">{{ a.diagnosticoCie }}</span>
                <span class="b-estado" :class="CLASE_ESTADO[a.estado] ?? 'agotado'">{{ ESTADO_ATENCION[a.estado]?.texto ?? a.estado }}</span>
                <span v-if="a.gravedad === 'urgente'" class="b-estado retirado">Urgente</span>
              </span>
              <small v-if="a.diagnosticoTxt && a.motivoConsulta">Motivo: {{ a.motivoConsulta }}</small>
              <small v-if="a.tratamiento">{{ a.tratamiento }}</small>
            </span>
            <button v-if="puedeVerHoja && a.estado === 'atendido'" type="button" class="ver-hoja" @click="hojaAbierta = a.id">
              Ver hoja <Icono nombre="irA" :tamano="14" />
            </button>
          </li>
        </ol>
        <p v-else class="b-vacio">Sin atenciones registradas.</p>
      </section>

      <div class="space-y-4">
        <BloqueAntropometria v-if="paciente.edad.edadMeses <= 60" :paciente-id="paciente.id" :edad-meses="paciente.edad.edadMeses" />

        <section v-if="insumos && insumos.entregas.length" class="b-panel">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Insumos entregados</h2>
            <span class="b-contador gris">{{ insumos.entregas.length }}</span>
          </header>
          <ul class="entregas">
            <li v-for="e in insumos.entregas" :key="e.movimientoId">
              <span class="min-w-0 flex-1">
                <b class="block truncate text-tinta">{{ e.insumo.nombreGenerico }}</b>
                <small>
                  Lote <RouterLink :to="`/inventario/trazabilidad?lote=${e.lote.id}`" class="font-mono hover:underline">{{ e.lote.numeroLote }}</RouterLink>
                  · {{ fecha(e.fecha) }}<template v-if="e.entregadoPor"> · entregó {{ e.entregadoPor }}</template>
                </small>
                <small v-if="e.medico || e.diagnostico">Recetó {{ e.medico ?? '—' }}<template v-if="e.diagnostico"> · {{ e.diagnostico }}</template></small>
                <small v-if="e.anulada" class="text-[#B7710A]">Entrega anulada</small>
                <small v-if="e.retiro" class="font-bold text-[#C03535]">Bajo retiro sanitario</small>
              </span>
              <b class="tabular-nums text-tinta">{{ e.cantidad }}</b>
            </li>
          </ul>
        </section>

        <section v-if="ofreceEmbarazo" class="b-panel">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Embarazo</h2>
            <button v-if="!panelEmbarazo" type="button" class="b-btn secundario chico" @click="panelEmbarazo = true"><Icono nombre="agregar" :tamano="16" /> Abrir</button>
          </header>
          <form v-if="panelEmbarazo" class="b-panel-cuerpo b-rejilla" @submit.prevent="abrirEmbarazo">
            <div class="c7">
              <label for="fur" class="b-etiqueta">Última regla</label>
              <input id="fur" v-model="embarazo.fechaUltimaRegla" type="date" class="b-campo" />
            </div>
            <div class="c5">
              <label for="semanas" class="b-etiqueta">o semanas</label>
              <input id="semanas" v-model="embarazo.semanasAlRegistrar" inputmode="numeric" class="b-campo num" />
            </div>
            <div class="c12 flex justify-end gap-2">
              <button type="button" class="b-btn secundario chico" @click="panelEmbarazo = false">Cancelar</button>
              <button type="submit" class="b-btn primario chico">Abrir embarazo</button>
            </div>
          </form>
        </section>
      </div>
    </div>
    <HojaAnterior :atencion-id="hojaAbierta" @cerrar="hojaAbierta = null" />
  </section>

  <section v-else>
    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
    <p v-else class="b-vacio">Cargando expediente…</p>
  </section>
</template>

<style scoped>
.ver-hoja { align-self: center; flex-shrink: 0; display: inline-flex; align-items: center; gap: 2px; padding: 6px 12px; border: 2px solid #CBD5E1; border-radius: 9px; font-size: 13px; font-weight: 800; color: #172A5A; background: #fff; }
.ver-hoja:hover { border-color: #172A5A; background: #EEF2FA; }
.encabezado { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 20px; padding: 18px 20px; }
.codigo { display: inline-flex; flex-direction: column; align-items: center; min-width: 128px; padding: 6px 14px; border: 2px solid #172A5A; border-radius: 12px; line-height: 1.1; }
.codigo b { font-size: 34px; font-weight: 700; color: #172A5A; font-variant-numeric: tabular-nums; }
.codigo small { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #64748B; }
.codigo.sin-papel { border-color: #CBD5E1; }
.codigo.sin-papel b { font-size: 20px; }
.datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); border: 2px solid #E2E8F0; border-radius: 14px; background: #fff; overflow: hidden; }
.datos div { padding: 12px 16px; border-right: 2px solid #EEF2F6; }
.datos div:last-child { border-right: none; }
.datos dt { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.datos dd { margin-top: 2px; font-weight: 600; color: #14244A; }
.datos dd small { font-weight: 600; color: #64748B; }
.datos dd.vacio { color: #94A3B8; }
.embarazo { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px 18px; border-color: #B5E2CB; background: #F4FBF7; }
.columnas { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .columnas { grid-template-columns: 1fr; } }
.historial li { display: flex; gap: 16px; padding: 14px 18px; border-top: 1px solid #EEF2F6; }
.historial li:first-child { border-top: none; }
.historial small { display: block; margin-top: 4px; font-size: 13px; color: #475569; }
.dia { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 64px; padding: 6px 0; border-radius: 10px; background: #F1F5F9; line-height: 1.1; }
.dia b { font-size: 22px; font-weight: 700; color: #14244A; }
.dia small { margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748B; }
.cie { padding: 1px 8px; border-radius: 6px; background: #EEF2FA; font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; color: #172A5A; }
.entregas li { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-top: 1px solid #EEF2F6; }
.entregas li:first-child { border-top: none; }
.entregas small { display: block; font-size: 12px; color: #64748B; }
/* --- Relieve (estilo duo) --- */
.ver-hoja { border-bottom-width: 4px; border-radius: 12px; }
.ver-hoja:active { transform: translateY(2px); border-bottom-width: 2px; }
.datos { border-bottom-width: 4px; border-radius: 18px; }
.codigo { border-bottom-width: 4px; border-radius: 14px; }
</style>
