<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import http from '../../services/http';
import catalogos from '../../services/catalogos';
import { usarAutorizacion } from '../../dominio/autorizacion';
import DialogoAutorizacion from '../comunes/DialogoAutorizacion.vue';
import Icono from '../comunes/Icono.vue';
import TiemposDeViaje from './TiemposDeViaje.vue';
import CargaCsv from './CargaCsv.vue';

/**
 * Catálogos del centro: lugares poblados del municipio (con su tiempo de
 * viaje), signos de peligro de la preconsulta y CIE-10.
 */
const props = defineProps({ inicial: { type: String, default: 'lugares' } });
const vista = ref(['lugares', 'signos', 'cie10'].includes(props.inicial) ? props.inicial : 'lugares');
const llaveTiempos = ref(0);

// --- Signos de peligro ---
const GRUPO = { todos: 'Todos', menor_5: 'Menores de 5 años', embarazada: 'Embarazadas', adulto_mayor: 'Adultos mayores' };
const signos = ref([]);
const filtroGrupo = ref('');
const error = ref('');
const aviso = ref('');
const nuevo = reactive({ codigo: '', descripcion: '', grupoEtario: 'todos', gravedadSugerida: 'urgente' });

const listaSignos = computed(() => signos.value.filter((s) => !filtroGrupo.value || s.grupoEtario === filtroGrupo.value));

async function cargarSignos() {
  try {
    signos.value = (await http.get('/admin/signos-peligro/todos')).signos;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const autorizacion = usarAutorizacion(async (mensaje) => {
  aviso.value = mensaje ?? 'Cambio aplicado.';
  await cargarSignos();
});

function crearSigno() {
  aviso.value = '';
  autorizacion.pedir('agregar un signo de peligro', async (aut) => {
    await http.post('/admin/signos-peligro', { ...nuevo, orden: signos.value.length, autorizacion: aut });
    const texto = `Signo "${nuevo.descripcion}" agregado.`;
    Object.assign(nuevo, { codigo: '', descripcion: '' });
    return texto;
  });
}

function cambiarGravedad(s, gravedadSugerida) {
  if (gravedadSugerida === s.gravedadSugerida) return;
  aviso.value = '';
  autorizacion.pedir(`cambiar la gravedad de "${s.descripcion}"`, async (aut) => {
    await http.patch(`/admin/signos-peligro/${s.id}`, { gravedadSugerida, autorizacion: aut });
    return 'Gravedad actualizada.';
  });
}

function alternarSigno(s) {
  aviso.value = '';
  autorizacion.pedir(`${s.activo ? 'desactivar' : 'activar'} "${s.descripcion}"`, async (aut) => {
    await http.patch(`/admin/signos-peligro/${s.id}`, { activo: !s.activo, autorizacion: aut });
    return s.activo ? 'Signo desactivado: ya no aparece en la preconsulta.' : 'Signo activado.';
  });
}

onMounted(cargarSignos);
</script>

<template>
  <div>
    <div class="b-segmentado" role="tablist" aria-label="Catálogos">
      <button type="button" role="tab" :aria-selected="vista === 'lugares'" :class="vista === 'lugares' ? 'on' : ''" @click="vista = 'lugares'">Lugares poblados</button>
      <button type="button" role="tab" :aria-selected="vista === 'signos'" :class="vista === 'signos' ? 'on' : ''" @click="vista = 'signos'">Signos de peligro</button>
      <button type="button" role="tab" :aria-selected="vista === 'cie10'" :class="vista === 'cie10' ? 'on' : ''" @click="vista = 'cie10'">CIE-10</button>
    </div>

    <!-- Lugares -->
    <div v-if="vista === 'lugares'" class="dos mt-5">
      <TiemposDeViaje :key="llaveTiempos" class="min-w-0" />
      <CargaCsv
        class="self-start"
        titulo="Cargar lugares"
        columnas="nombre,categoria,territorio,sector"
        ejemplo="El Guayabo,caserio,3,2"
        :cargar="catalogos.importarLugares"
        @cargado="llaveTiempos++"
      />
    </div>

    <!-- Signos de peligro -->
    <div v-else-if="vista === 'signos'" class="dos mt-5">
      <section class="b-panel min-w-0">
        <header class="b-panel-cabeza flex-wrap">
          <h2 class="b-panel-titulo">Signos de peligro</h2>
          <div class="flex flex-wrap gap-1.5">
            <button type="button" class="b-chip" :class="!filtroGrupo ? 'on' : ''" @click="filtroGrupo = ''">Todos</button>
            <button v-for="(t, g) in GRUPO" v-show="g !== 'todos'" :key="g" type="button" class="b-chip" :class="filtroGrupo === g ? 'on' : ''" @click="filtroGrupo = g">{{ t }}</button>
          </div>
        </header>
        <p v-if="aviso" class="b-aviso ok mx-4 mt-3">{{ aviso }}</p>
        <p v-if="error" role="alert" class="b-aviso error mx-4 mt-3">{{ error }}</p>
        <ul class="signos">
          <li v-for="s in listaSignos" :key="s.id" :class="s.activo ? '' : 'inactivo'">
            <span class="min-w-0 flex-1">
              <b class="block text-tinta">{{ s.descripcion }}</b>
              <small class="text-apagado">{{ GRUPO[s.grupoEtario] ?? s.grupoEtario }}</small>
            </span>
            <div class="b-segmentado chico" role="radiogroup" :aria-label="`Gravedad de ${s.descripcion}`">
              <button type="button" role="radio" :aria-checked="s.gravedadSugerida === 'urgente'" :class="s.gravedadSugerida === 'urgente' ? 'on urgente' : ''" @click="cambiarGravedad(s, 'urgente')">Urgente</button>
              <button type="button" role="radio" :aria-checked="s.gravedadSugerida === 'moderado'" :class="s.gravedadSugerida === 'moderado' ? 'on moderado' : ''" @click="cambiarGravedad(s, 'moderado')">Moderado</button>
            </div>
            <button type="button" class="b-btn chico w-[104px]" :class="s.activo ? 'secundario' : 'exito'" @click="alternarSigno(s)">{{ s.activo ? 'Desactivar' : 'Activar' }}</button>
          </li>
        </ul>
      </section>

      <form class="b-panel self-start" @submit.prevent="crearSigno">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Agregar signo</h2></header>
        <div class="b-panel-cuerpo b-rejilla">
          <div class="c12">
            <label for="s-desc" class="b-etiqueta">Descripción</label>
            <input id="s-desc" v-model="nuevo.descripcion" required minlength="3" maxlength="200" class="b-campo" />
          </div>
          <div class="c12">
            <label for="s-cod" class="b-etiqueta">Código</label>
            <input id="s-cod" v-model="nuevo.codigo" required pattern="[a-zA-Z0-9_]{2,30}" placeholder="convulsiones" class="b-campo font-mono" />
          </div>
          <div class="c12">
            <label for="s-grupo" class="b-etiqueta">A quién aplica</label>
            <select id="s-grupo" v-model="nuevo.grupoEtario" class="b-campo">
              <option v-for="(t, g) in GRUPO" :key="g" :value="g">{{ t }}</option>
            </select>
          </div>
          <div class="c12">
            <span class="b-etiqueta">Gravedad</span>
            <div class="b-segmentado" role="radiogroup" aria-label="Gravedad">
              <button type="button" role="radio" :aria-checked="nuevo.gravedadSugerida === 'urgente'" :class="nuevo.gravedadSugerida === 'urgente' ? 'on' : ''" @click="nuevo.gravedadSugerida = 'urgente'">Urgente</button>
              <button type="button" role="radio" :aria-checked="nuevo.gravedadSugerida === 'moderado'" :class="nuevo.gravedadSugerida === 'moderado' ? 'on' : ''" @click="nuevo.gravedadSugerida = 'moderado'">Moderado</button>
            </div>
          </div>
          <button type="submit" class="c12 b-btn primario"><Icono nombre="agregar" :tamano="20" /> Agregar</button>
        </div>
      </form>
    </div>

    <!-- CIE-10 -->
    <div v-else class="mt-5 max-w-2xl">
      <CargaCsv
        titulo="Catálogo CIE-10"
        columnas="codigo,descripcion,sinonimos"
        ejemplo="J00,Rinofaringitis aguda,catarro|resfriado"
        :cargar="catalogos.importarCie10"
      />
    </div>

    <DialogoAutorizacion
      :abierto="Boolean(autorizacion.pendiente.value)"
      :operacion="autorizacion.pendiente.value?.operacion ?? ''"
      :error="autorizacion.error.value"
      :enviando="autorizacion.enviando.value"
      @confirmar="autorizacion.confirmar"
      @cancelar="autorizacion.cancelar"
    />
  </div>
</template>

<style scoped>
.dos { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; }
@media (max-width: 1100px) { .dos { grid-template-columns: 1fr; } }
.signos { max-height: calc(100vh - 360px); min-height: 260px; overflow-y: auto; }
.signos li { display: flex; align-items: center; gap: 14px; padding: 10px 18px; border-top: 1px solid #EEF2F6; }
.signos li:first-child { border-top: none; }
.signos li.inactivo { opacity: .5; }
.b-segmentado.chico button { padding: 5px 12px; font-size: 13px; }
.b-segmentado .on.urgente { color: #A52A2A; }
.b-segmentado .on.moderado { color: #8A5A06; }
</style>
