<script setup>
import { ref, reactive, computed, watch } from 'vue';
import servicio from '../../services/pacientes';
import Icono from '../comunes/Icono.vue';
import CampoSiNo from './CampoSiNo.vue';
import HistorialSeccion from './HistorialSeccion.vue';
import {
  aplica, clavesDe, avance, marcarRestoComoNo, siNoPendientes, etiquetas, clasificacionPesoNacer,
} from '../../dominio/ficha';

/**
 * Una sección de antecedentes (o alimentación, vacunación, familiograma),
 * con los campos exactos del papel. Se guarda sola: se puede llenar una
 * sección y salir.
 */
const props = defineProps({
  seccion: { type: Object, required: true },
  pacienteId: { type: [Number, String], required: true },
  perfil: { type: Object, required: true },
  puedeVerSensibles: { type: Boolean, default: false },
  archivos: { type: Array, default: () => [] },
});
const emit = defineEmits(['guardada', 'sin-guardar', 'archivo-subido']);

const form = reactive({});
const guardando = ref(false);
const mensaje = ref('');
const error = ref('');
const verHistorial = ref(false);
const subiendo = ref(false);

function cargarForm() {
  for (const k of Object.keys(form)) delete form[k];
  for (const c of props.seccion.campos) {
    for (const k of clavesDe(c)) form[k] = props.seccion.datos[k] ?? null;
  }
}
watch(() => props.seccion, cargarForm, { immediate: true });

const registrados = computed(() => props.seccion.sensiblesRegistrados ?? []);
const bloqueado = (clave) => registrados.value.includes(clave) && !props.puedeVerSensibles;

const vacio = (v) => v === null || v === undefined || v === '';
const cambios = computed(() => {
  const salida = {};
  for (const [k, v] of Object.entries(form)) {
    if (bloqueado(k)) continue;
    const antes = props.seccion.datos[k] ?? null;
    const ahora = vacio(v) ? null : v;
    if (antes !== ahora) salida[k] = ahora;
  }
  return salida;
});
const hayCambios = computed(() => Object.keys(cambios.value).length > 0);
watch(hayCambios, (v) => emit('sin-guardar', v), { immediate: true });

const visibles = computed(() => props.seccion.campos.filter((c) => aplica(c, props.perfil, form)));
const progreso = computed(() => avance(props.seccion, form, props.perfil, registrados.value));
const pendientesSiNo = computed(() => siNoPendientes(props.seccion, form, props.perfil, registrados.value));
const nombres = computed(() => etiquetas(props.seccion.campos));

function marcarResto() {
  Object.assign(form, marcarRestoComoNo(props.seccion, form, props.perfil, registrados.value));
}

function calculado(c) {
  if (c.calculo === 'clasificacionPesoNacer') return clasificacionPesoNacer(form.pesoNacerLb, form.pesoNacerOnz);
  return props.seccion.calculados?.[c.clave] ?? null;
}

const pocasOpciones = (c) => c.opciones.length <= 4;

async function guardar() {
  error.value = '';
  mensaje.value = '';
  if (!hayCambios.value && props.seccion.estado === 'registrado') {
    mensaje.value = 'No hay cambios por guardar.';
    return;
  }
  guardando.value = true;
  try {
    const r = await servicio.guardarSeccion(props.pacienteId, props.seccion.clave, cambios.value);
    emit('guardada', r.seccion);
    mensaje.value = r.cambios === 1 ? 'Guardado: 1 dato.' : `Guardado: ${r.cambios} datos.`;
    verHistorial.value = false;
  } catch (fallo) {
    error.value = fallo.detalles?.length
      ? `${fallo.message}: ${fallo.detalles.map((d) => nombres.value[d.campo]?.etiqueta ?? d.campo).join(', ')}`
      : fallo.message;
  } finally {
    guardando.value = false;
  }
}

// --- Familiograma -----------------------------------------------------------

const vigente = computed(() => props.archivos.find((a) => a.id === props.seccion.datos.familiograma) ?? props.archivos[0] ?? null);

async function subir(evento) {
  const archivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!archivo) return;
  error.value = '';
  if (archivo.size > 8 * 1024 * 1024) {
    error.value = 'El archivo pesa más de 8 MB. Tome la foto con menos resolución.';
    return;
  }
  subiendo.value = true;
  try {
    await servicio.subirFamiliograma(props.pacienteId, archivo);
    emit('archivo-subido');
    mensaje.value = 'Familiograma adjuntado.';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    subiendo.value = false;
  }
}

async function abrir(a) {
  try {
    const url = await servicio.abrirArchivo(props.pacienteId, a.id);
    window.open(url, '_blank', 'noopener');
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const formatoFecha = new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', year: 'numeric' });

defineExpose({ hayCambios, progreso });
</script>

<template>
  <form class="space-y-6" @submit.prevent="guardar">
    <template v-for="c in visibles" :key="c.clave">
      <!-- Lista de casillas: cada una con sus tres estados -->
      <fieldset v-if="c.tipo === 'lista'">
        <legend class="etiqueta-campo">{{ c.etiqueta }}</legend>
        <ul class="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <li
            v-for="i in c.items"
            :key="i.clave"
            class="flex min-h-[3rem] items-center justify-between gap-3 border-b border-linea-suave py-1"
          >
            <span class="flex items-center gap-1.5 text-tinta">
              {{ i.etiqueta }}
              <Icono v-if="i.sensible" nombre="escudo" :tamano="14" class="text-apagado" aria-label="Dato sensible" />
            </span>
            <span
              v-if="bloqueado(i.clave)"
              class="rounded-control bg-linea-suave px-3 py-1 text-sm font-bold text-tinta-2"
            >
              Registrado
            </span>
            <CampoSiNo v-else v-model="form[i.clave]" :etiqueta="i.etiqueta" compacto />
          </li>
        </ul>
      </fieldset>

      <div v-else-if="c.tipo === 'calculado'">
        <p class="etiqueta-campo">{{ c.etiqueta }}</p>
        <p class="flex h-[46px] items-center rounded-[10px] bg-[#F1F5F9] px-[14px] font-semibold text-tinta">
          {{ calculado(c) ?? 'Se calcula al registrar el peso' }}
        </p>
      </div>

      <!-- Familiograma -->
      <div v-else-if="c.tipo === 'archivo'">
        <p class="etiqueta-campo">{{ c.etiqueta }}</p>
        <div v-if="vigente" class="flex flex-wrap items-center gap-3 rounded-control border border-linea p-3">
          <Icono nombre="consulta" :tamano="20" class="text-marino" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-bold text-tinta">{{ vigente.nombre }}</span>
            <span class="text-sm text-apagado">
              {{ formatoFecha.format(new Date(vigente.subidoEn)) }}<span v-if="vigente.subidoPor"> · {{ vigente.subidoPor }}</span>
            </span>
          </span>
          <button type="button" class="boton-secundario !min-h-0 !py-2" @click="abrir(vigente)">Ver</button>
        </div>
        <label class="boton-secundario mt-3 cursor-pointer">
          <Icono nombre="agregar" :tamano="18" />
          {{ subiendo ? 'Subiendo…' : vigente ? 'Reemplazar familiograma' : 'Adjuntar foto o PDF' }}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" class="sr-only" :disabled="subiendo" @change="subir" />
        </label>
        <p v-if="c.ayuda" class="mt-1 text-sm text-apagado">{{ c.ayuda }}</p>
      </div>

      <div v-else>
        <label :for="`${seccion.clave}-${c.clave}`" class="etiqueta-campo flex flex-wrap items-center gap-x-2">
          {{ c.etiqueta }}
          <span v-if="c.sensible" class="inline-flex items-center gap-1 text-sm font-normal text-apagado">
            <Icono nombre="escudo" :tamano="14" /> Dato sensible
          </span>
        </label>

        <p
          v-if="bloqueado(c.clave)"
          class="inline-flex rounded-control bg-linea-suave px-3 py-2 font-bold text-tinta-2"
        >
          Registrado · solo lo ve el personal médico
        </p>

        <div v-else-if="['siNo', 'siNoEspecifique', 'siNoNumero'].includes(c.tipo)" class="flex flex-wrap items-center gap-3">
          <CampoSiNo :id="`${seccion.clave}-${c.clave}`" v-model="form[c.clave]" :etiqueta="c.etiqueta" />
          <input
            v-if="c.tipo === 'siNoEspecifique' && form[c.clave] === true"
            v-model="form[`${c.clave}Detalle`]"
            placeholder="Especifique"
            :aria-label="`${c.etiqueta}: especifique`"
            maxlength="200"
            class="campo min-w-[14rem] flex-1"
          />
          <span v-if="c.tipo === 'siNoNumero' && form[c.clave] === true" class="flex items-center gap-2">
            <input
              v-model.number="form[`${c.clave}Detalle`]"
              type="number"
              min="0"
              :max="c.maximo"
              inputmode="numeric"
              :aria-label="`${c.etiqueta}: ${c.unidad}`"
              class="campo w-28 tabular-nums"
            />
            <span class="text-apagado">{{ c.unidad }}</span>
          </span>
        </div>

        <div v-else-if="c.tipo === 'numero'" class="flex items-center gap-3">
          <input
            :id="`${seccion.clave}-${c.clave}`"
            v-model.number="form[c.clave]"
            type="number"
            :min="c.minimo"
            :max="c.maximo"
            :step="c.decimales ? '0.1' : '1'"
            inputmode="decimal"
            class="campo w-36 tabular-nums"
          />
          <span v-if="c.unidad" class="text-apagado">{{ c.unidad }}</span>
        </div>

        <div v-else-if="c.tipo === 'libraOnza'" class="flex flex-wrap items-center gap-3">
          <input
            :id="`${seccion.clave}-${c.clave}`"
            v-model.number="form[`${c.clave}Lb`]"
            type="number" min="0" max="15" inputmode="numeric"
            aria-label="Libras"
            class="campo w-24 tabular-nums"
          />
          <span class="text-apagado">lb</span>
          <input
            v-model.number="form[`${c.clave}Onz`]"
            type="number" min="0" max="15.9" step="0.1" inputmode="decimal"
            aria-label="Onzas"
            class="campo w-24 tabular-nums"
          />
          <span class="text-apagado">onz</span>
        </div>

        <input
          v-else-if="c.tipo === 'fecha'"
          :id="`${seccion.clave}-${c.clave}`"
          v-model="form[c.clave]"
          type="date"
          class="campo w-48"
        />

        <textarea
          v-else-if="c.tipo === 'textoLargo'"
          :id="`${seccion.clave}-${c.clave}`"
          v-model="form[c.clave]"
          rows="3"
          maxlength="2000"
          class="campo"
        />

        <!-- Selección única: botones si son pocas, lista si son muchas -->
        <template v-else-if="c.tipo === 'seleccion'">
          <div v-if="pocasOpciones(c)" :id="`${seccion.clave}-${c.clave}`" role="radiogroup" :aria-label="c.etiqueta" class="flex flex-wrap gap-2">
            <button
              v-for="o in c.opciones"
              :key="o.valor"
              type="button"
              role="radio"
              :aria-checked="form[c.clave] === o.valor"
              class="min-h-tocable rounded-control border px-4 text-left font-bold transition"
              :class="form[c.clave] === o.valor
                ? 'border-marino bg-marino text-superficie'
                : 'border-linea bg-superficie text-tinta-2 hover:bg-fondo'"
              @click="form[c.clave] = form[c.clave] === o.valor ? null : o.valor"
            >
              {{ o.etiqueta }}
            </button>
          </div>
          <select v-else :id="`${seccion.clave}-${c.clave}`" v-model="form[c.clave]" class="campo">
            <option :value="null">Sin registrar</option>
            <option v-for="o in c.opciones" :key="o.valor" :value="o.valor">{{ o.etiqueta }}</option>
          </select>
          <input
            v-if="form[c.clave] === 'otro'"
            v-model="form[`${c.clave}Otro`]"
            placeholder="Especifique"
            :aria-label="`${c.etiqueta}: otro`"
            maxlength="200"
            class="campo mt-2"
          />
        </template>

        <input
          v-else
          :id="`${seccion.clave}-${c.clave}`"
          v-model="form[c.clave]"
          maxlength="200"
          class="campo"
        />

        <p v-if="c.ayuda && c.tipo !== 'archivo'" class="mt-1 text-sm text-apagado">{{ c.ayuda }}</p>
      </div>
    </template>

    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-empeora" />
      <span class="text-tinta-2">{{ error }}</span>
    </p>

    <div v-if="!seccion.campos.every((c) => c.tipo === 'archivo')" class="flex flex-wrap items-center gap-3 border-t border-linea pt-4">
      <button type="submit" class="boton-primario" :disabled="guardando">
        <Icono nombre="guardar" :tamano="18" />
        {{ guardando ? 'Guardando…' : 'Guardar sección' }}
      </button>
      <button
        v-if="pendientesSiNo > 0"
        type="button"
        class="boton-secundario"
        title="Las preguntas Sí/No sin registrar quedan en No"
        @click="marcarResto"
      >
        Marcar el resto como No ({{ pendientesSiNo }})
      </button>
      <button type="button" class="enlace ml-auto" @click="verHistorial = !verHistorial">
        {{ verHistorial ? 'Ocultar historial' : 'Ver historial de cambios' }}
      </button>
      <p v-if="mensaje" class="w-full text-sm font-bold text-mejora" aria-live="polite">{{ mensaje }}</p>
    </div>
    <div v-else class="flex justify-end">
      <button type="button" class="enlace" @click="verHistorial = !verHistorial">
        {{ verHistorial ? 'Ocultar historial' : 'Ver historial de cambios' }}
      </button>
    </div>

    <HistorialSeccion
      v-if="verHistorial"
      :paciente-id="pacienteId"
      :seccion="seccion.clave"
      :etiquetas="nombres"
    />
  </form>
</template>
