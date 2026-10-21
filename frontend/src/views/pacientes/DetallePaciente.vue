<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/pacientes';
import inventario from '../../services/inventario';
import { useAuthStore } from '../../stores/auth';
import BloqueAntropometria from '../../components/comunes/BloqueAntropometria.vue';
import Icono from '../../components/comunes/Icono.vue';
import HojaAnterior from '../../components/consulta/HojaAnterior.vue';
import { estiloEtapa, etapaDe, iniciales } from '../../dominio/etapas';

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

// --- Para el diseño ----------------------------------------------------------

const etapa = computed(() => (paciente.value ? etapaDe(paciente.value) : null));

/** La edad en dos piezas: cifra grande y el resto. */
const edadGrande = computed(() => {
  const e = paciente.value?.edad;
  if (!e) return null;
  if (e.anios >= 1) return { n: e.anios, u: e.anios === 1 ? 'año' : 'años', resto: e.meses > 0 ? `y ${e.meses} ${e.meses === 1 ? 'mes' : 'meses'}` : '' };
  return { n: e.edadMeses, u: e.edadMeses === 1 ? 'mes' : 'meses', resto: '' };
});

// La atención de hoy en tres pasos, para ver de un vistazo en qué va.
const pasos = computed(() => {
  const a = atencionAbierta.value;
  if (!a) return [];
  return [
    { texto: 'Registrada', hecho: true },
    { texto: 'Signos vitales', hecho: Boolean(a.preconsulta) },
    { texto: 'En consulta', hecho: a.estado === 'en_atencion' },
  ];
});

const ESTADO_PUNTO = { atendido: 'p-bien', en_espera: 'p-atencion', en_atencion: 'p-accion', ausente: 'p-neutro', cancelada: 'p-neutro' };
</script>

<template>
  <section v-if="paciente" :style="estiloEtapa(etapa)" class="perfil">
    <RouterLink to="/pacientes" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Pacientes</RouterLink>

    <p v-if="error" role="alert" class="b-aviso error mb-4">{{ error }}</p>

    <!-- Quién es -->
    <header class="heroe">
      <div class="heroe-banda" />
      <div class="heroe-cuerpo">
        <span class="avatar">{{ iniciales(paciente) }}</span>
        <div class="min-w-0 flex-1">
          <h1 class="nombre">{{ paciente.apellidos }}, {{ paciente.nombres }}</h1>
          <p class="mt-2 flex flex-wrap items-center gap-2">
            <span v-if="etapa" class="pill etapa">{{ etapa.corta }}</span>
            <span class="pill">{{ paciente.sexo === 'M' ? 'Hombre' : 'Mujer' }}</span>
            <span v-if="paciente.cui" class="pill tabular-nums">CUI {{ paciente.cui }}</span>
            <span v-for="d in distintivos" :key="d.texto" class="pill" :class="d.urgente ? 'urgente' : 'contexto'">{{ d.texto }}</span>
          </p>
        </div>
        <span class="codigo" :class="paciente.expedientePapel ? '' : 'sin-papel'">
          <small>{{ paciente.expedientePapel ? 'Ficha' : 'Expediente' }}</small>
          <b>{{ paciente.expedientePapel || paciente.expediente }}</b>
          <small>{{ paciente.expedientePapel ? `Exp. ${paciente.expediente}` : 'sin ficha de papel' }}</small>
        </span>
      </div>
      <div class="heroe-acciones">
        <template v-if="puedeRegistrar">
          <RouterLink v-if="atencionAbierta && !atencionAbierta.preconsulta" :to="`/preconsulta/${atencionAbierta.id}`" class="b-btn primario grande"><Icono nombre="agregar" :tamano="22" :grosor="2.4" /> Registrar preconsulta</RouterLink>
          <button v-else-if="!atencionAbierta" type="button" class="b-btn primario grande" :disabled="abriendo" @click="abrirAtencion">
            <Icono nombre="agregar" :tamano="22" :grosor="2.4" /> {{ abriendo ? 'Abriendo…' : 'Abrir atención' }}
          </button>
        </template>
        <RouterLink :to="`/pacientes/${$route.params.id}/ficha`" class="b-btn secundario grande"><Icono nombre="lapiz" :tamano="20" /> Ficha</RouterLink>
        <RouterLink :to="`/imprimir/expediente/${$route.params.id}`" target="_blank" class="b-btn secundario grande"><Icono nombre="imprimir" :tamano="20" /> Resumen</RouterLink>
      </div>
    </header>

    <!-- Datos en tarjetas -->
    <div class="datos mt-4">
      <div class="dato edad">
        <span class="d-et">Edad</span>
        <span v-if="edadGrande" class="d-grande"><b>{{ edadGrande.n }}</b> {{ edadGrande.u }}</span>
        <span class="d-sub">{{ [edadGrande?.resto, paciente.fechaNacimientoEstimada ? 'aproximada' : ''].filter(Boolean).join(' · ') }}</span>
      </div>
      <div class="dato">
        <span class="d-et"><Icono nombre="ubicacion" :tamano="15" :grosor="2.2" /> Comunidad</span>
        <span class="d-valor">{{ paciente.comunidad || '—' }}</span>
      </div>
      <div class="dato">
        <span class="d-et"><Icono nombre="llamar" :tamano="15" :grosor="2.2" /> Teléfono</span>
        <span class="d-valor" :class="paciente.telefono ? '' : 'vacio'">{{ paciente.telefono || 'Sin teléfono' }}</span>
      </div>
      <div v-if="paciente.responsableNombre" class="dato">
        <span class="d-et"><Icono nombre="usuario" :tamano="15" :grosor="2.2" /> Responsable</span>
        <span class="d-valor">{{ paciente.responsableNombre }}</span>
        <span v-if="paciente.responsableParentesco" class="d-sub">{{ paciente.responsableParentesco }}</span>
      </div>
      <div class="dato">
        <span class="d-et"><Icono nombre="reloj" :tamano="15" :grosor="2.2" /> Última atención</span>
        <span class="d-valor" :class="ultimaAtencion ? '' : 'vacio'">{{ ultimaAtencion ? fecha(ultimaAtencion.registradaEn) : 'Nunca' }}</span>
        <span v-if="cerradas.length" class="d-sub">{{ cerradas.length }} {{ cerradas.length === 1 ? 'atención' : 'atenciones' }} en total</span>
      </div>
    </div>

    <!-- Lo que pide hacer algo hoy -->
    <div v-if="atencionAbierta || (paciente.ficha && !paciente.ficha.completa) || (insumos && insumos.conRetiroActivo > 0)" class="tareas mt-4">
      <div v-if="insumos && insumos.conRetiroActivo > 0" class="tarea t-critico">
        <span class="t-ic"><Icono nombre="alerta" :tamano="24" :grosor="2.4" /></span>
        <div class="min-w-0 flex-1">
          <p class="t-titulo">Recibió {{ insumos.conRetiroActivo }} {{ insumos.conRetiroActivo === 1 ? 'producto' : 'productos' }} bajo retiro sanitario</p>
          <ul class="t-texto">
            <li v-for="e in insumos.entregas.filter((x) => x.retiro)" :key="e.movimientoId">{{ e.insumo.nombreGenerico }} · lote {{ e.lote.numeroLote }} · {{ e.retiro.referencia }}</li>
          </ul>
        </div>
      </div>

      <div v-if="atencionAbierta" class="tarea t-accion">
        <span class="t-ic"><Icono nombre="cola" :tamano="24" :grosor="2.2" /></span>
        <div class="min-w-0 flex-1">
          <p class="t-titulo">Atención de hoy: {{ ESTADO_ATENCION[atencionAbierta.estado].texto.toLowerCase() }}</p>
          <ol class="pasos">
            <li v-for="(p, i) in pasos" :key="p.texto" :class="p.hecho ? 'hecho' : ''">
              <span class="paso-n"><Icono v-if="p.hecho" nombre="correcto" :tamano="16" :grosor="3" /><template v-else>{{ i + 1 }}</template></span>
              {{ p.texto }}
            </li>
          </ol>
        </div>
        <button v-if="puedeRegistrar && !cancelando" type="button" class="b-btn peligro chico" @click="cancelando = true">Cancelar atención</button>
      </div>
      <form v-if="cancelando" class="tarea t-critico flex-wrap" @submit.prevent="cancelarAtencion">
        <div class="min-w-[16rem] flex-1">
          <label for="motivo-cancelar" class="t-titulo block">¿Por qué se cancela?</label>
          <input id="motivo-cancelar" v-model="motivoCancelacion" required minlength="5" placeholder="Ej.: se abrió por error, era otro paciente" class="b-campo mt-2" />
        </div>
        <button type="button" class="b-btn secundario" @click="cancelando = false">No cancelar</button>
        <button type="submit" class="b-btn rojo" :disabled="motivoCancelacion.trim().length < 5">Cancelar atención</button>
      </form>

      <div v-if="paciente.ficha && !paciente.ficha.completa" class="tarea t-atencion">
        <span class="t-ic"><Icono nombre="lapiz" :tamano="24" :grosor="2.2" /></span>
        <div class="min-w-0 flex-1">
          <p class="t-titulo">Faltan {{ paciente.ficha.faltantes.length }} {{ paciente.ficha.faltantes.length === 1 ? 'dato' : 'datos' }} de la ficha</p>
          <p class="mt-1 flex flex-wrap gap-1.5">
            <span v-for="f in paciente.ficha.faltantes" :key="f.campo" class="falta-chip">{{ f.etiqueta }}</span>
          </p>
        </div>
        <RouterLink :to="`/pacientes/${$route.params.id}/ficha`" class="b-btn secundario">Completar</RouterLink>
      </div>
    </div>

    <!-- Embarazo activo -->
    <div v-if="paciente.embarazo" class="tarea t-embarazo mt-4">
      <span class="t-ic"><Icono nombre="crecimiento" :tamano="24" :grosor="2.2" /></span>
      <div class="min-w-0 flex-1">
        <p class="t-titulo">{{ paciente.embarazo.texto }}</p>
        <p v-if="paciente.embarazo.fechaProbableParto" class="t-texto">Parto probable {{ fecha(paciente.embarazo.fechaProbableParto) }}</p>
      </div>
      <form v-if="cerrandoEmbarazo" class="flex flex-wrap items-center gap-2" @submit.prevent="cerrarEmbarazo">
        <input v-model="motivoCierre" required minlength="3" placeholder="Motivo del cierre" aria-label="Motivo del cierre" class="b-campo w-[260px]" />
        <button type="submit" class="b-btn primario chico">Cerrar</button>
        <button type="button" class="b-btn secundario chico" @click="cerrandoEmbarazo = false">Cancelar</button>
      </form>
      <button v-else-if="puedeRegistrar" type="button" class="b-btn secundario chico" @click="cerrandoEmbarazo = true">Cerrar embarazo</button>
    </div>

    <!-- Historia y crecimiento -->
    <div class="columnas mt-5">
      <section class="caja">
        <header class="caja-cabeza">
          <h2>Historial de atenciones</h2>
          <span class="cuenta">{{ atenciones.length }}</span>
        </header>
        <ol v-if="atenciones.length" class="linea-tiempo">
          <li v-for="a in atenciones" :key="a.id" :class="ESTADO_PUNTO[a.estado] ?? 'p-neutro'">
            <span class="dia">
              <b>{{ new Date(a.registradaEn).getDate() }}</b>
              <small>{{ MESES[new Date(a.registradaEn).getMonth()] }} {{ new Date(a.registradaEn).getFullYear() }}</small>
            </span>
            <div class="evento">
              <div class="min-w-0 flex-1">
                <p class="ev-titulo">{{ a.diagnosticoTxt || a.motivoConsulta || 'Sin diagnóstico' }}</p>
                <p class="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span class="estado">{{ ESTADO_ATENCION[a.estado]?.texto ?? a.estado }}</span>
                  <span v-if="a.diagnosticoCie" class="cie">{{ a.diagnosticoCie }}</span>
                  <span v-if="a.gravedad === 'urgente'" class="pill urgente chica">Urgente</span>
                </p>
                <p v-if="a.diagnosticoTxt && a.motivoConsulta" class="ev-sub">Motivo: {{ a.motivoConsulta }}</p>
                <p v-if="a.tratamiento" class="ev-sub">{{ a.tratamiento }}</p>
              </div>
              <button v-if="puedeVerHoja && a.estado === 'atendido'" type="button" class="b-btn secundario chico shrink-0" @click="hojaAbierta = a.id">
                Ver hoja <Icono nombre="irA" :tamano="14" :grosor="2.6" />
              </button>
            </div>
          </li>
        </ol>
        <p v-else class="b-vacio">Sin atenciones registradas.</p>
      </section>

      <div class="space-y-4">
        <BloqueAntropometria v-if="paciente.edad.edadMeses <= 60" :paciente-id="paciente.id" :edad-meses="paciente.edad.edadMeses" />

        <section v-if="insumos && insumos.entregas.length" class="caja">
          <header class="caja-cabeza">
            <h2>Insumos entregados</h2>
            <span class="cuenta">{{ insumos.entregas.length }}</span>
          </header>
          <ul class="entregas">
            <li v-for="e in insumos.entregas" :key="e.movimientoId">
              <span class="min-w-0 flex-1">
                <b class="block nombre-completo text-tinta">{{ e.insumo.nombreGenerico }}</b>
                <small>
                  Lote <RouterLink :to="`/inventario/trazabilidad?lote=${e.lote.id}`" class="font-mono hover:underline">{{ e.lote.numeroLote }}</RouterLink>
                  · {{ fecha(e.fecha) }}<template v-if="e.entregadoPor"> · entregó {{ e.entregadoPor }}</template>
                </small>
                <small v-if="e.medico || e.diagnostico">Recetó {{ e.medico ?? '—' }}<template v-if="e.diagnostico"> · {{ e.diagnostico }}</template></small>
                <small v-if="e.anulada" class="text-[#8A4B00]">Entrega anulada</small>
                <small v-if="e.retiro" class="font-bold text-[#A83232]">Bajo retiro sanitario</small>
              </span>
              <b class="cant">{{ e.cantidad }}</b>
            </li>
          </ul>
        </section>

        <section v-if="ofreceEmbarazo" class="caja">
          <header class="caja-cabeza">
            <h2>Embarazo</h2>
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
          <p v-else class="px-4 pb-4 text-sm font-semibold text-apagado">Sin embarazo activo registrado.</p>
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
/* La etapa de vida pone el color (--et, --et-fondo, --et-tinta): dominio/etapas. */
.perfil { --et: #94A3B8; --et-fondo: #F1F4F8; --et-tinta: #475569; }

/* --- Quién es ------------------------------------------------------------------ */
.heroe { overflow: hidden; background: #fff; border: 2px solid #E5E9F0; border-bottom-width: 5px; border-radius: 24px; }
.heroe-banda { height: 14px; background: var(--et); }
.heroe-cuerpo { display: flex; flex-wrap: wrap; align-items: center; gap: 18px 22px; padding: 20px 24px 8px; }
.avatar {
  display: grid; place-items: center; flex-shrink: 0; width: 84px; height: 84px; border-radius: 50%;
  background: var(--et); color: #fff; font-size: 30px; font-weight: 900; box-shadow: inset 0 -6px 0 rgba(0, 0, 0, .18);
}
.nombre { font-size: 30px; font-weight: 900; line-height: 1.12; letter-spacing: -.01em; color: #14244A; }
.pill { display: inline-flex; align-items: center; padding: 3px 12px; border-radius: 10px; background: #F1F4F8; font-size: 14px; font-weight: 800; color: #475569; }
.pill.etapa { background: var(--et-fondo); color: var(--et-tinta); }
.pill.urgente { background: #FDECEC; color: #8C2323; }
.pill.contexto { background: #EAF3FB; color: #174E80; }
.pill.chica { padding: 1px 9px; font-size: 12px; }
.codigo {
  display: inline-flex; flex-direction: column; align-items: center; min-width: 136px; padding: 6px 14px; line-height: 1.1;
  border: 2px solid #172A5A; border-bottom-width: 5px; border-radius: 16px;
}
.codigo b { font-size: 36px; font-weight: 900; color: #172A5A; font-variant-numeric: tabular-nums; }
.codigo small { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #64748B; }
.codigo.sin-papel { border-color: #CBD5E1; }
.codigo.sin-papel b { font-size: 20px; }
.heroe-acciones { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 24px 20px; }
.b-btn.grande { min-height: 52px; padding: 0 20px; font-size: 16px; border-radius: 16px; }

/* --- Datos ------------------------------------------------------------------- */
.datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.dato { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; background: #fff; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; }
.dato.edad { background: var(--et-fondo); border-color: color-mix(in srgb, var(--et) 40%, #fff); border-bottom-color: var(--et); }
.d-et { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.dato.edad .d-et, .dato.edad .d-sub { color: var(--et-tinta); }
.d-grande { font-size: 16px; font-weight: 800; color: #14244A; }
.d-grande b { font-size: 34px; font-weight: 900; line-height: 1.05; font-variant-numeric: tabular-nums; }
.d-valor { font-size: 18px; font-weight: 800; color: #14244A; }
.d-valor.vacio { color: #94A3B8; }
.d-sub { font-size: 13px; font-weight: 700; color: #64748B; }

/* --- Tareas: lo que pide hacer algo ------------------------------------------- */
.tareas { display: flex; flex-direction: column; gap: 10px; }
.tarea { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 2px solid var(--t-borde); border-bottom-width: 4px; border-bottom-color: var(--t); border-radius: 18px; background: var(--t-fondo); }
.t-accion { --t: #22A06B; --t-fondo: #E3F6EC; --t-borde: #9ED9BC; --t-tinta: #145C3D; }
.t-atencion { --t: #E8930C; --t-fondo: #FFF4E0; --t-borde: #F5C26B; --t-tinta: #8A4B00; }
.t-critico { --t: #D64545; --t-fondo: #FDECEC; --t-borde: #F3B1B1; --t-tinta: #8C2323; }
.t-embarazo { --t: #C8456A; --t-fondo: #FBE3EA; --t-borde: #F0B3C4; --t-tinta: #922845; }
.t-ic { display: grid; place-items: center; flex-shrink: 0; width: 48px; height: 48px; border-radius: 14px; background: var(--t); color: #fff; box-shadow: inset 0 -4px 0 rgba(0, 0, 0, .15); }
.t-titulo { font-size: 17px; font-weight: 900; color: var(--t-tinta); }
.t-texto { margin-top: 2px; font-size: 14px; font-weight: 700; color: var(--t-tinta); }
.falta-chip { padding: 2px 10px; border-radius: 9px; background: #fff; border: 2px solid var(--t-borde); font-size: 13px; font-weight: 800; color: var(--t-tinta); }
.pasos { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 6px; }
.pasos li { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 800; color: #64748B; }
.pasos li.hecho { color: var(--t-tinta); }
.paso-n { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: #fff; border: 2px solid #CBD5E1; font-size: 13px; font-weight: 900; }
.pasos li.hecho .paso-n { background: var(--t); border-color: var(--t); color: #fff; }
.b-btn.rojo { background: #D64545; color: #fff; border-color: #D64545; border-bottom-color: #A83232; }

/* --- Columnas ------------------------------------------------------------------ */
.columnas { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .columnas { grid-template-columns: 1fr; } }
.caja { overflow: hidden; background: #fff; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; }
.caja-cabeza { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px; border-bottom: 2px solid #F1F4F8; }
.caja-cabeza h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.cuenta { padding: 1px 10px; border-radius: 999px; background: #E5E9F0; font-weight: 900; color: #334155; }

/* Línea de tiempo: un punto por atención con el color de su estado. */
.linea-tiempo { position: relative; padding: 8px 18px 14px; }
.linea-tiempo li { --p: #94A3B8; position: relative; display: flex; gap: 14px; padding: 8px 0; }
.linea-tiempo li::before { content: ''; position: absolute; left: 34px; top: 0; bottom: 0; width: 3px; background: #EDF1F6; }
.linea-tiempo li:first-child::before { top: 28px; }
.linea-tiempo li:last-child::before { bottom: calc(100% - 28px); }
.p-bien { --p: #22A06B; } .p-atencion { --p: #E8930C; } .p-accion { --p: #2F83C4; } .p-neutro { --p: #94A3B8; }
.dia {
  position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 70px; padding: 6px 0;
  border-radius: 14px; background: #fff; border: 2px solid var(--p); border-bottom-width: 4px; line-height: 1.1;
}
.dia b { font-size: 22px; font-weight: 900; color: #14244A; }
.dia small { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #64748B; }
.evento { display: flex; flex: 1; min-width: 0; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 16px; background: #F8FAFC; }
.ev-titulo { font-size: 16px; font-weight: 800; color: #14244A; }
.ev-sub { margin-top: 4px; font-size: 13px; font-weight: 600; color: #475569; }
.estado { padding: 1px 9px; border-radius: 8px; background: color-mix(in srgb, var(--p) 15%, #fff); color: color-mix(in srgb, var(--p) 70%, #000); font-size: 12px; font-weight: 800; }
.cie { padding: 1px 8px; border-radius: 8px; background: #EAF3FB; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; font-weight: 700; color: #174E80; }
.entregas li { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-top: 2px solid #F1F4F8; }
.entregas li:first-child { border-top: none; }
.entregas small { display: block; font-size: 12px; font-weight: 600; color: #64748B; }
.cant { font-size: 18px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
@media (max-width: 640px) {
  .nombre { font-size: 24px; }
  .avatar { width: 64px; height: 64px; font-size: 24px; }
  .heroe-cuerpo, .heroe-acciones { padding-left: 16px; padding-right: 16px; }
}
</style>
