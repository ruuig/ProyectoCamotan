<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import http from '../../services/http';
import { useAuthStore } from '../../stores/auth';
import CodigoPaciente from '../../components/comunes/CodigoPaciente.vue';
import Icono from '../../components/comunes/Icono.vue';
import EstadoVacio from '../../components/comunes/EstadoVacio.vue';

const auth = useAuthStore();
const router = useRouter();

const datos = ref(null);
const error = ref('');
const cargando = ref(false);
const desdeCache = ref(false);
const minutosDeAntiguedad = ref(0);
const confirmandoAusente = ref(null);
// Atención abierta por error: se cancela con su motivo y sale de la cola.
const cancelando = ref(null);
const motivoCancelacion = ref('');

const puedeRegistrar = computed(() => ['admin', 'preconsulta'].includes(auth.rol));

/**
 * Una sola senal de color por paciente. El resto de la fila es texto gris:
 * con seis colores compitiendo no se distingue lo importante de lo demas.
 */
function prioridad(e) {
  if (e.gravedad === 'urgente') {
    return { texto: 'Urgente', punto: 'bg-urgente-500', texto_clase: 'text-urgente-700' };
  }
  if (e.minutosEsperando >= 90) {
    return { texto: 'Espera larga', punto: 'bg-atencion-500', texto_clase: 'text-atencion-700' };
  }
  return { texto: 'En orden', punto: 'bg-slate-300', texto_clase: 'text-slate-500' };
}

async function cargar() {
  cargando.value = true;
  try {
    const lectura = await http.getConCache('/atenciones/cola');
    datos.value = lectura.datos;
    desdeCache.value = lectura.desdeCache;
    minutosDeAntiguedad.value = lectura.minutosDeAntiguedad;
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

async function cambiar(id, estado) {
  try {
    await http.patch(`/atenciones/${id}/estado`, { estado });
    error.value = '';
    confirmandoAusente.value = null;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function cancelar(id) {
  try {
    await http.patch(`/atenciones/${id}/cancelar`, { motivo: motivoCancelacion.value.trim() });
    error.value = '';
    cancelando.value = null;
    motivoCancelacion.value = '';
    await cargar();
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
  <div class="mx-auto max-w-4xl space-y-5">
    <div>
      <h1 class="titulo-pagina">Cola de atención</h1>
      <p class="text-slate-500">Llame siempre al primero.</p>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-urgente-600" />
      <span class="text-slate-700">{{ error }}</span>
    </p>

    <p v-if="desdeCache" role="status" class="aviso aviso-informativo">
      <Icono nombre="sinConexion" :tamano="20" class="mt-0.5 shrink-0 text-celeste-400" />
      <span class="text-slate-700">
        Sin conexión. Esta viendo la lista de hace {{ minutosDeAntiguedad }} minuto(s).
      </span>
    </p>

    <template v-if="datos">
      <p v-if="datos.jornada.aviso" class="aviso aviso-atencion">
        <Icono nombre="reloj" :tamano="20" class="mt-0.5 shrink-0 text-atencion-600" />
        <span class="text-slate-700">{{ datos.jornada.aviso }}</span>
      </p>

      <!-- Resumen sobrio: tres datos, sin tarjetas de colores -->
      <div class="tarjeta flex flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4">
        <p class="text-slate-600">
          <span class="text-2xl font-semibold text-mspas-700">{{ datos.resumen.enEspera }}</span>
          en espera
        </p>
        <p class="text-slate-600">
          Espera promedio
          <span class="font-semibold text-slate-800">{{ datos.resumen.esperaPromedio }} min</span>
        </p>
        <p v-if="datos.resumen.superan90 > 0" class="flex items-center gap-2 text-urgente-700">
          <span class="h-2 w-2 rounded-full bg-urgente-500" />
          {{ datos.resumen.superan90 }} sobre 90 minutos
        </p>
        <button
          type="button"
          class="ml-auto flex items-center gap-2 font-medium text-mspas-700 hover:underline"
          @click="cargar"
        >
          <Icono nombre="actualizar" :tamano="17" :class="cargando ? 'animate-spin' : ''" />
          Actualizar
        </button>
      </div>

      <!-- En consulta -->
      <section v-if="datos.enAtencion.length > 0" class="space-y-2">
        <h2 class="flex items-center gap-2 px-1 text-sm font-semibold text-slate-500">
          <span class="h-2 w-2 rounded-full bg-estable-500" />
          Pasando a consulta
        </h2>
        <div
          v-for="e in datos.enAtencion"
          :key="e.id"
          class="tarjeta flex flex-wrap items-center justify-between gap-4 px-6 py-4"
        >
          <div class="flex items-center gap-4">
            <CodigoPaciente :papel="e.paciente.expedientePapel" :expediente="e.paciente.expediente" tamano="mediano" />
            <div>
              <p class="text-lg font-semibold text-slate-900">{{ e.paciente.nombreCompleto }}</p>
              <p class="text-slate-500">{{ e.motivoConsulta }}</p>
            </div>
          </div>
          <RouterLink
            v-if="['admin', 'medico'].includes(auth.rol)"
            :to="`/consulta/${e.id}`"
            class="boton-primario"
          >
            <Icono nombre="consulta" :tamano="19" /> Abrir consulta
          </RouterLink>
        </div>
      </section>

      <div v-if="datos.cola.length === 0" class="tarjeta">
        <EstadoVacio
          icono="correcto"
          titulo="No hay nadie esperando"
          descripcion="Cuando preconsulta registre una atención, aparecera aquí en orden de prioridad."
        />
      </div>

      <!-- Lista de espera -->
      <section v-else class="space-y-3">
        <h2 class="px-1 text-sm font-semibold text-slate-500">
          En espera
        </h2>

        <article
          v-for="(e, indice) in datos.cola"
          :key="e.id"
          class="tarjeta overflow-hidden"
          :class="indice === 0 ? 'border-mspas-700 ring-1 ring-mspas-700' : ''"
        >
          <p
            v-if="indice === 0"
            class="bg-mspas-700 px-6 py-2 text-sm font-semibold text-white"
          >
            Siguiente a llamar
          </p>

          <div class="flex flex-wrap items-start gap-5 px-6 py-5">
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
              :class="indice === 0 ? 'bg-mspas-700 text-white' : 'bg-slate-100 text-slate-500'"
            >
              {{ indice + 1 }}
            </span>

            <CodigoPaciente :papel="e.paciente.expedientePapel" :expediente="e.paciente.expediente" tamano="mediano" />

            <div class="min-w-0 flex-1 space-y-1">
              <RouterLink
                :to="`/pacientes/${e.paciente.id}`"
                class="block text-lg font-semibold text-slate-900 hover:text-mspas-700"
              >
                {{ e.paciente.nombreCompleto }}
              </RouterLink>
              <p class="text-slate-600">{{ e.motivoConsulta }}</p>

              <!-- Unica senal de color de la fila -->
              <p class="flex items-center gap-2 text-sm font-medium" :class="prioridad(e).texto_clase">
                <span class="h-2 w-2 rounded-full" :class="prioridad(e).punto" />
                {{ prioridad(e).texto }}
              </p>

              <!-- El porque, en texto llano -->
              <p class="text-slate-500">
                {{ e.factores.map((f) => f.etiqueta).join(' · ') }}
              </p>

              <p
                v-if="!e.tienePreconsulta"
                class="flex items-center gap-2 text-sm text-atencion-700"
              >
                <Icono nombre="alerta" :tamano="16" /> Falta tomarle signos vitales
              </p>
            </div>

            <div class="shrink-0 text-right">
              <p
                class="text-3xl font-semibold tabular-nums"
                :class="e.minutosEsperando >= 90 ? 'text-urgente-600' : 'text-slate-700'"
              >
                {{ e.minutosEsperando }}
              </p>
              <p class="text-slate-500">min esperando</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              :class="indice === 0 ? 'boton-primario' : 'boton-secundario'"
              @click="cambiar(e.id, 'en_atencion')"
            >
              <Icono nombre="llamar" :tamano="19" /> Llamar a consulta
            </button>

            <button
              v-if="!e.tienePreconsulta && puedeRegistrar"
              type="button"
              class="boton-secundario"
              @click="router.push(`/preconsulta/${e.id}`)"
            >
              <Icono nombre="agregar" :tamano="19" /> Tomar signos vitales
            </button>

            <button
              type="button"
              class="ml-auto text-sm font-medium text-slate-500 underline-offset-4 hover:text-urgente-600 hover:underline"
              @click="confirmandoAusente = e.id; cancelando = null"
            >
              No se presento
            </button>
            <button
              type="button"
              class="text-sm font-medium text-slate-500 underline-offset-4 hover:text-urgente-600 hover:underline"
              @click="cancelando = e.id; confirmandoAusente = null; motivoCancelacion = ''"
            >
              Cancelar atención
            </button>
          </div>

          <form
            v-if="cancelando === e.id"
            class="border-t-4 border-t-urgente-500 bg-slate-50 px-6 py-4"
            @submit.prevent="cancelar(e.id)"
          >
            <label :for="`motivo-${e.id}`" class="font-medium text-urgente-700">
              ¿Por qué se cancela la atención de {{ e.paciente.nombreCompleto }}?
            </label>
            <p class="mt-1 text-slate-600">Sale de la cola. Queda registrado quién la canceló y por qué.</p>
            <input :id="`motivo-${e.id}`" v-model="motivoCancelacion" minlength="5" required placeholder="Ej.: se abrió por error" class="campo mt-2" />
            <div class="mt-3 flex gap-3">
              <button type="submit" class="rounded-xl bg-urgente-600 px-5 py-2.5 font-semibold text-white transition hover:bg-urgente-700" :disabled="motivoCancelacion.trim().length < 5">
                Sí, cancelar atención
              </button>
              <button type="button" class="boton-secundario !py-2.5" @click="cancelando = null">No cancelar</button>
            </div>
          </form>

          <div
            v-if="confirmandoAusente === e.id"
            class="border-t-4 border-t-urgente-500 bg-slate-50 px-6 py-4"
          >
            <p class="font-medium text-urgente-700">
              Marcar a {{ e.paciente.nombreCompleto }} como ausente?
            </p>
            <p class="mt-1 text-slate-600">
              <template v-if="e.ausencias >= 1">
                Es su segunda ausencia: saldrá del sistema y tendrá que registrarse de nuevo.
              </template>
              <template v-else>
                Vuelve a la lista con 10 puntos menos y su espera empieza de cero.
              </template>
            </p>
            <div class="mt-3 flex gap-3">
              <button
                type="button"
                class="rounded-xl bg-urgente-600 px-5 py-2.5 font-semibold text-white transition hover:bg-urgente-700"
                @click="cambiar(e.id, 'ausente')"
              >
                Si, marcar ausente
              </button>
              <button type="button" class="boton-secundario !py-2.5" @click="confirmandoAusente = null">
                Cancelar
              </button>
            </div>
          </div>
        </article>
      </section>
    </template>
  </div>
</template>
