<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { useRoute, RouterLink, onBeforeRouteLeave } from 'vue-router';
import servicio from '../../services/pacientes';
import catalogos from '../../services/catalogos';
import Icono from '../../components/comunes/Icono.vue';
import PlegableSeccion from '../../components/ficha/PlegableSeccion.vue';
import SeccionIdentificacion from '../../components/ficha/SeccionIdentificacion.vue';
import SeccionFicha from '../../components/ficha/SeccionFicha.vue';
import { registradoPor } from '../../dominio/ficha';

/**
 * Completar ficha: preconsulta pasa al sistema la ficha de papel del
 * paciente, sección por sección.
 *
 * Tiene todas las secciones que son del paciente en la ficha que le toca por
 * su edad, con los títulos y el orden del papel. Lo que es de cada visita
 * (signos vitales, motivo, examen, diagnóstico) no está aquí.
 *
 * Cada sección se guarda sola: se puede llenar una y salir.
 */
const props = defineProps({
  // Dentro del registro del paciente: la ficha va debajo, toda abierta.
  pacienteId: { type: [Number, String], default: null },
  embebido: { type: Boolean, default: false },
});

const route = useRoute();
const idPaciente = computed(() => props.pacienteId ?? route.params.id);

const datos = ref(null);
const cat = ref({});
const error = ref('');
const abiertas = reactive({});
const sinGuardar = reactive({});

const paciente = computed(() => datos.value?.paciente);
const perfil = computed(() => ({
  sexo: paciente.value?.sexo,
  edadMeses: paciente.value?.edad?.edadMeses,
}));

async function cargar() {
  try {
    const [ficha, listas] = await Promise.all([
      servicio.ficha(idPaciente.value),
      Object.keys(cat.value).length ? Promise.resolve({ catalogos: cat.value }) : catalogos.listar(),
    ]);
    const primeraVez = !datos.value;
    datos.value = ficha;
    cat.value = listas.catalogos;
    if (primeraVez && props.embebido) abrirTodo(true);
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function estadoTexto(s) {
  if (s.estado !== 'registrado') return 'Sin registrar';
  return registradoPor(s.actualizadoEn, s.actualizadoPor);
}

const identificacionEstado = computed(() => {
  const i = datos.value?.identificacion;
  if (!i) return '';
  return i.actualizadoEn ? registradoPor(i.actualizadoEn, i.actualizadoPor) : 'Datos del registro';
});

// Índice: todas las secciones con su avance, en el orden del papel.
const indice = computed(() => {
  if (!datos.value) return [];
  const i = datos.value.identificacion;
  return [
    { id: 'identificacion', titulo: i.titulo, estado: identificacionEstado.value, avance: i.avance, registrada: true },
    ...datos.value.secciones.map((s) => ({
      id: s.clave,
      titulo: s.titulo,
      grupo: s.grupo,
      estado: estadoTexto(s),
      avance: s.avance,
      registrada: s.estado === 'registrado',
    })),
    { id: 'sigsa', titulo: 'Datos para el SIGSA', estado: 'Fuera del papel', avance: avanceSigsa.value, registrada: true },
  ];
});

// Avance del bloque SIGSA: cuántos de sus campos tienen respuesta.
const avanceSigsa = computed(() => {
  const i = datos.value?.identificacion;
  if (!i) return null;
  const total = i.sigsa.length;
  const respondidas = i.sigsa.filter((c) => {
    const v = i.datos[c.clave];
    return (v !== null && v !== undefined && v !== '') || i.sensiblesRegistrados.includes(c.clave);
  }).length;
  return { respondidas, total };
});

const registradas = computed(() => datos.value?.secciones.filter((s) => s.estado === 'registrado').length ?? 0);

const todasAbiertas = computed(() => indice.value.length > 0 && indice.value.every((s) => abiertas[s.id]));
function abrirTodo(abrir = !todasAbiertas.value) {
  for (const s of indice.value) abiertas[s.id] = abrir;
}

async function ir(id) {
  abiertas[id] = true;
  await nextTick();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function irAFaltante(campo) {
  await ir('identificacion');
  await nextTick();
  document.getElementById(`campo-${campo}`)?.focus();
}

function seccionGuardada(nueva) {
  const i = datos.value.secciones.findIndex((s) => s.clave === nueva.clave);
  if (i >= 0) datos.value.secciones[i] = nueva;
  sinGuardar[nueva.clave] = false;
}

async function recargar(id) {
  sinGuardar[id] = false;
  await cargar();
}

// Salir con cambios sin guardar se pregunta: perder lo escrito de una ficha
// de papel obliga a volver a buscarla en el estante.
const pendientes = computed(() => Object.values(sinGuardar).some(Boolean));
// La pregunta se hace con un diálogo propio; la navegación espera la respuesta.
const preguntaSalir = ref(null);
onBeforeRouteLeave(() => {
  if (!pendientes.value) return true;
  return new Promise((resolver) => { preguntaSalir.value = resolver; });
});
function responderSalir(salir) {
  preguntaSalir.value?.(salir);
  preguntaSalir.value = null;
}


const porcentaje = (a) => (a?.total ? Math.round((a.respondidas / a.total) * 100) : 0);

onMounted(cargar);
</script>

<template>
  <section v-if="datos" class="mx-auto max-w-[1180px]">
    <RouterLink v-if="!embebido" :to="`/pacientes/${paciente.id}`" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> {{ paciente.apellidos }}, {{ paciente.nombres }}</RouterLink>

    <header class="b-panel encabezado">
      <span class="codigo" :class="paciente.expedientePapel ? '' : 'sin-papel'">
        <small>{{ paciente.expedientePapel ? 'Ficha' : 'Expediente' }}</small>
        <b>{{ paciente.expedientePapel || paciente.expediente }}</b>
      </span>
      <div class="min-w-0 flex-1">
        <p class="b-antetitulo">Completar ficha</p>
        <h1 class="b-titulo">{{ datos.ficha.nombre }}</h1>
        <p class="text-sm font-semibold text-apagado">{{ datos.ficha.rango }}</p>
      </div>
      <div v-if="datos.faltantes.length" class="faltan">
        <p class="b-subtitulo">Falta para el SIGSA</p>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <button v-for="f in datos.faltantes" :key="f.campo" type="button" class="b-chip faltante" @click="irAFaltante(f.campo)">{{ f.etiqueta }}</button>
        </div>
      </div>
      <span v-else class="b-estado disponible">Mínimos del SIGSA completos</span>
    </header>

    <p v-if="datos.ficha.provisional" class="b-aviso atencion mt-4">{{ datos.ficha.notaProvisional }}</p>
    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <div class="rejilla mt-5">
      <!-- Índice -->
      <nav class="b-panel indice" aria-label="Secciones de la ficha">
        <p class="b-subtitulo solo-escritorio px-2">Secciones<template v-if="datos.secciones.length"> · {{ registradas }} de {{ datos.secciones.length }}</template></p>
        <p class="indice-titulo px-2">Toque una parte de la ficha para llenarla</p>
        <button type="button" class="abrir-todo b-btn secundario chico mx-2 mt-2 w-[calc(100%-16px)]" @click="abrirTodo()">{{ todasAbiertas ? 'Cerrar todo' : 'Abrir todo para llenar' }}</button>
        <ol class="mt-2">
          <li v-for="s in indice" :key="s.id">
            <button type="button" class="entrada" @click="ir(s.id)">
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-bold leading-tight text-tinta">{{ s.titulo }}</span>
                <span class="block text-xs font-semibold text-apagado">
                  <template v-if="s.avance && s.registrada">{{ s.avance.respondidas }} de {{ s.avance.total }}</template>
                  <template v-else>{{ s.estado }}</template>
                  <span v-if="sinGuardar[s.id]" class="text-[#B7710A]"> · sin guardar</span>
                </span>
              </span>
              <span class="progreso" :class="porcentaje(s.avance) === 100 ? 'lleno' : ''"><span :style="{ width: `${s.registrada ? porcentaje(s.avance) : 0}%` }" /></span>
              <span class="sello-indice" :class="porcentaje(s.avance) === 100 ? 'lista' : s.registrada ? 'faltan' : 'vacia'">
                {{ porcentaje(s.avance) === 100 ? 'Lista ✓' : s.registrada && s.avance ? `Faltan ${s.avance.total - s.avance.respondidas}` : 'Sin llenar' }}
              </span>
            </button>
          </li>
        </ol>
      </nav>

      <div class="min-w-0 space-y-3">
        <PlegableSeccion
          id="identificacion"
          v-model:abierta="abiertas.identificacion"
          :titulo="datos.identificacion.titulo"
          :estado="identificacionEstado"
          :avance="datos.identificacion.avance"
          registrada
          :sin-guardar="sinGuardar.identificacion"
        >
          <SeccionIdentificacion
            :campos="datos.identificacion.campos"
            :datos="datos.identificacion.datos"
            :sensibles-registrados="datos.identificacion.sensiblesRegistrados"
            :paciente="paciente"
            :ficha-clave="datos.ficha.clave"
            :catalogos="cat"
            :municipios="datos.municipios"
            :puede-ver-sensibles="datos.puedeVerSensibles"
            @guardada="recargar('identificacion')"
            @sin-guardar="sinGuardar.identificacion = $event"
          />
        </PlegableSeccion>

        <template v-if="datos.secciones.length">
          <h2 class="grupo">Antecedentes</h2>
          <PlegableSeccion
            v-for="s in datos.secciones"
            :id="s.clave"
            :key="s.clave"
            v-model:abierta="abiertas[s.clave]"
            :titulo="s.titulo"
            :subtitulo="s.subtitulo"
            :estado="estadoTexto(s)"
            :avance="s.avance"
            :registrada="s.estado === 'registrado'"
            :sin-guardar="sinGuardar[s.clave]"
          >
            <SeccionFicha
              :seccion="s"
              :paciente-id="paciente.id"
              :perfil="perfil"
              :puede-ver-sensibles="datos.puedeVerSensibles"
              :archivos="datos.archivos.filter((a) => a.tipo === 'familiograma')"
              @guardada="seccionGuardada"
              @archivo-subido="recargar(s.clave)"
              @sin-guardar="sinGuardar[s.clave] = $event"
            />
          </PlegableSeccion>
        </template>

        <h2 class="grupo">Fuera de la ficha en papel</h2>
        <PlegableSeccion
          id="sigsa"
          v-model:abierta="abiertas.sigsa"
          titulo="Datos para el SIGSA"
          :avance="avanceSigsa"
          registrada
          :sin-guardar="sinGuardar.sigsa"
        >
          <SeccionIdentificacion
            :campos="datos.identificacion.sigsa"
            :datos="datos.identificacion.datos"
            :sensibles-registrados="datos.identificacion.sensiblesRegistrados"
            :paciente="paciente"
            :ficha-clave="datos.ficha.clave"
            :catalogos="cat"
            :municipios="datos.municipios"
            :puede-ver-sensibles="datos.puedeVerSensibles"
            @guardada="recargar('sigsa')"
            @sin-guardar="sinGuardar.sigsa = $event"
          />
        </PlegableSeccion>
      </div>
    </div>
    <div v-if="preguntaSalir" class="fondo-salir" role="dialog" aria-modal="true" aria-labelledby="titulo-salir">
      <div class="ventana-salir">
        <span class="ic-salir"><Icono nombre="alerta" :tamano="30" /></span>
        <p id="titulo-salir" class="salir-titulo">Hay cambios sin guardar</p>
        <div class="salir-botones">
          <button type="button" class="b-btn primario" @click="responderSalir(false)">Seguir llenando</button>
          <button type="button" class="b-btn peligro" @click="responderSalir(true)">Salir sin guardar</button>
        </div>
      </div>
    </div>
  </section>

  <p v-else-if="error" role="alert" class="b-aviso error">{{ error }}</p>
  <p v-else class="b-vacio">Cargando ficha…</p>
</template>

<style scoped>
.fondo-salir { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .5); }
.ventana-salir { display: grid; justify-items: center; gap: 14px; width: min(420px, 100%); padding: 26px 24px; border: 2px solid #E2E8F0; border-bottom-width: 6px; border-radius: 24px; background: #fff; text-align: center; }
.ic-salir { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 20px; background: #E8930C; color: #fff; box-shadow: inset 0 -4px 0 #A35D00; }
.salir-titulo { font-size: 21px; font-weight: 900; color: #14244A; }
.salir-botones { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; }
.encabezado { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 20px; padding: 18px 20px; }
.codigo { display: inline-flex; flex-direction: column; align-items: center; min-width: 110px; padding: 6px 14px; border: 2px solid #172A5A; border-radius: 12px; line-height: 1.1; }
.codigo b { font-size: 28px; font-weight: 700; color: #172A5A; font-variant-numeric: tabular-nums; }
.codigo small { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #64748B; }
.codigo.sin-papel { border-color: #CBD5E1; }
.codigo.sin-papel b { font-size: 18px; }
.faltan { max-width: 460px; }
.b-chip.faltante { height: 32px; padding: 0 10px; border-color: #F5D58A; background: #FFF7E6; color: #7A4F05; }
.b-chip.faltante:hover { border-color: #D98208; }
.rejilla { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; align-items: start; }
.indice { position: sticky; top: 90px; padding: 14px 10px; }
/* Pantalla angosta: el índice va arriba, sin quedarse pegado tapando lo que se llena. */
@media (max-width: 1099px) {
  .rejilla { grid-template-columns: 1fr; }
  .indice { position: static; }
  /* El título no se aprieta contra los datos que faltan: van debajo. */
  .faltan { flex-basis: 100%; max-width: none; }
  .indice ol { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 4px 10px; }
}
@media (pointer: coarse) and (min-width: 600px) {
  .entrada { min-height: 60px; padding: 10px 12px; border: 2px solid #EEF2F6; }
  .entrada .text-sm { font-size: 17px; }
  .entrada .text-xs { font-size: 15px; }
  /* Abajo están las mismas secciones con su estado: el índice sobra y confunde. */
  .indice { display: none; }
  .grupo { text-transform: none; letter-spacing: 0; font-size: 18px; font-weight: 800; color: #334155; }
  .sello-indice { display: inline-block; }
  .indice-titulo { display: block; margin-bottom: 8px; }
  .solo-escritorio { display: none; }
  .b-chip.faltante { height: 44px; padding: 0 14px; font-size: 16px; }
  .grupo { font-size: 16px; }
}
.entrada { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border-radius: 10px; text-align: left; }
.entrada:hover { background: #F1F5F9; }
.progreso { flex-shrink: 0; width: 44px; height: 6px; border-radius: 3px; background: #E2E8F0; overflow: hidden; }
.progreso span { display: block; height: 100%; background: #172A5A; }
.progreso.lleno span { background: #22A06B; }
.indice-titulo { display: none; font-size: 19px; font-weight: 800; color: #14244A; }
.sello-indice { display: none; flex-shrink: 0; padding: 3px 10px; border-radius: 9px; font-size: 14px; font-weight: 800; white-space: nowrap; }
.sello-indice.lista { background: #E3F5EC; color: #17784F; }
.sello-indice.faltan { background: #FFF1DB; color: #8A4B00; }
.sello-indice.vacia { background: #F1F5F9; color: #64748B; }
.grupo { padding: 14px 4px 2px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
/* --- Relieve (estilo duo) --- */
.codigo { border-bottom-width: 4px; border-radius: 14px; }
@media (pointer: coarse) and (min-width: 600px) {
  .codigo small { font-size: 12.5px; }
}
</style>
