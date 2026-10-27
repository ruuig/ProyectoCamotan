<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import http from '../../services/http';
import { usarAutorizacion } from '../../dominio/autorizacion';
import DialogoAutorizacion from '../comunes/DialogoAutorizacion.vue';
import Icono from '../comunes/Icono.vue';

/**
 * Respaldos de la base de datos. Se guardan en el servidor solos, según el
 * horario de aquí, y se pueden descargar. Descargarlos pide al director
 * porque el archivo lleva toda la información de los pacientes.
 */
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const HORAS = Array.from({ length: 24 }, (_, h) => h);
const CAMPOS = ['automatico', 'frecuencia', 'hora', 'diaSemana', 'conservar'];

const config = reactive({ automatico: true, frecuencia: 'diaria', hora: 12, diaSemana: 1, conservar: 15 });
const original = ref(null);
const estado = ref(null);
const respaldos = ref([]);
const cargando = ref(true);
const haciendo = ref(false);
const error = ref('');
const aviso = ref('');

const cambiado = computed(() => original.value && CAMPOS.some((k) => config[k] !== original.value[k]));

async function cargar() {
  try {
    const r = await http.get('/admin/respaldos');
    Object.assign(config, Object.fromEntries(CAMPOS.map((k) => [k, r.configuracion[k]])));
    original.value = { ...config };
    estado.value = r.configuracion;
    respaldos.value = r.respaldos;
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

async function guardar() {
  error.value = '';
  aviso.value = '';
  try {
    await http.put('/admin/respaldos/configuracion', { ...config, conservar: Number(config.conservar) });
    aviso.value = config.automatico ? 'Horario de respaldos guardado.' : 'Respaldo automático desactivado.';
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function hacerAhora() {
  error.value = '';
  aviso.value = '';
  haciendo.value = true;
  try {
    await http.post('/admin/respaldos');
    aviso.value = 'Respaldo guardado en el servidor.';
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    haciendo.value = false;
  }
}

const autorizacion = usarAutorizacion(async (nombre) => {
  aviso.value = `Se descargó ${nombre}.`;
  await cargar();
});

function descargar(nombre) {
  aviso.value = '';
  error.value = '';
  autorizacion.pedir(
    nombre ? 'descargar este respaldo de la base de datos' : 'hacer y descargar un respaldo de la base de datos',
    (aut) => http.descargarConCuerpo('/admin/respaldos/descargar', { ...(nombre ? { nombre } : {}), autorizacion: aut }),
  );
}

const formatoFecha = new Intl.DateTimeFormat('es-GT', {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Guatemala',
});
const fechaHora = (f) => (f ? formatoFecha.format(new Date(f)) : '');

function tamano(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

onMounted(cargar);
</script>

<template>
  <div class="respaldos">
    <form class="b-panel self-start" @submit.prevent="guardar">
      <header class="b-panel-cabeza">
        <div>
          <h2 class="b-panel-titulo">Respaldo automático</h2>
          <p class="mt-0.5 text-sm text-apagado">Se guarda en el servidor sin que nadie lo haga</p>
        </div>
        <button type="submit" class="b-btn primario" :disabled="!cambiado"><Icono nombre="guardar" :tamano="20" /> Guardar</button>
      </header>
      <div class="b-panel-cuerpo space-y-5">
        <label class="flex cursor-pointer items-center gap-3">
          <input v-model="config.automatico" type="checkbox" class="h-5 w-5 accent-[#172A5A]" />
          <b class="text-tinta">Hacer respaldos automáticos</b>
        </label>

        <template v-if="config.automatico">
          <div>
            <span class="b-etiqueta">Cada cuánto</span>
            <div class="b-segmentado" role="radiogroup" aria-label="Frecuencia">
              <button type="button" role="radio" :aria-checked="config.frecuencia === 'diaria'" :class="config.frecuencia === 'diaria' ? 'on' : ''" @click="config.frecuencia = 'diaria'">Cada día</button>
              <button type="button" role="radio" :aria-checked="config.frecuencia === 'semanal'" :class="config.frecuencia === 'semanal' ? 'on' : ''" @click="config.frecuencia = 'semanal'">Cada semana</button>
            </div>
          </div>
          <div class="b-rejilla">
            <div v-if="config.frecuencia === 'semanal'" class="c4">
              <label for="r-dia" class="b-etiqueta">Día</label>
              <select id="r-dia" v-model.number="config.diaSemana" class="b-campo">
                <option v-for="(d, i) in DIAS" :key="d" :value="i">{{ d }}</option>
              </select>
            </div>
            <div class="c4">
              <label for="r-hora" class="b-etiqueta">Hora</label>
              <select id="r-hora" v-model.number="config.hora" class="b-campo">
                <option v-for="h in HORAS" :key="h" :value="h">{{ String(h).padStart(2, '0') }}:00</option>
              </select>
            </div>
            <div class="c4">
              <label for="r-conservar" class="b-etiqueta">Guardar los últimos</label>
              <input id="r-conservar" v-model.number="config.conservar" type="number" min="1" max="365" required class="b-campo num" />
            </div>
          </div>
          <p class="text-sm text-apagado">
            Se conservan {{ config.conservar }} respaldos; el más viejo se borra.
          </p>
        </template>

        <p v-if="estado?.proximo && !cambiado" class="flex items-center gap-2 text-sm text-tinta-2">
          <Icono nombre="reloj" :tamano="18" /> Próximo respaldo: {{ fechaHora(estado.proximo) }}
        </p>
        <p v-if="estado?.ultimoError" role="alert" class="b-aviso error">
          <Icono nombre="alerta" :tamano="20" />
          <span>El último respaldo automático ({{ fechaHora(estado.ultimoIntentoEn) }}) falló: {{ estado.ultimoError }}</span>
        </p>
      </div>
    </form>

    <section class="b-panel">
      <header class="b-panel-cabeza">
        <div>
          <h2 class="b-panel-titulo">Respaldos guardados</h2>
          <p class="mt-0.5 text-sm text-apagado">Archivo SQL de toda la base de datos</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="b-btn secundario" :disabled="haciendo" @click="hacerAhora">
            <Icono nombre="guardar" :tamano="20" /> {{ haciendo ? 'Respaldando…' : 'Respaldar ahora' }}
          </button>
          <button type="button" class="b-btn primario" :disabled="haciendo" @click="descargar(null)">
            <Icono nombre="descargar" :tamano="20" /> Descargar respaldo de hoy
          </button>
        </div>
      </header>
      <div class="b-panel-cuerpo">
        <p v-if="aviso" class="b-aviso ok mb-4">{{ aviso }}</p>
        <p v-if="error" role="alert" class="b-aviso error mb-4">{{ error }}</p>

        <p v-if="cargando" class="b-vacio">Cargando…</p>
        <p v-else-if="!respaldos.length" class="b-vacio">Todavía no hay respaldos guardados.</p>
        <ul v-else class="lista">
          <li v-for="r in respaldos" :key="r.nombre" class="fila">
            <span class="min-w-0 flex-1">
              <b class="block text-tinta first-letter:uppercase">{{ fechaHora(r.creadoEn) }}</b>
              <small>{{ r.origen === 'automatico' ? 'Automático' : 'Hecho a mano' }} · {{ tamano(r.bytes) }}</small>
            </span>
            <button type="button" class="b-btn secundario chico" @click="descargar(r.nombre)">
              <Icono nombre="descargar" :tamano="16" /> Descargar
            </button>
          </li>
        </ul>

        <p class="mt-4 text-sm text-apagado">
          Para restaurar uno, con el sistema detenido:
          <code class="font-mono text-tinta-2">psql -d camotan -f archivo.sql</code>
        </p>
      </div>
    </section>

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
.respaldos { display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1100px) { .respaldos { grid-template-columns: 1fr; } }
.lista { border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; }
.fila { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid #EEF2F6; }
.fila:first-child { border-top: none; }
.fila small { font-size: 13px; color: #64748B; }
</style>
