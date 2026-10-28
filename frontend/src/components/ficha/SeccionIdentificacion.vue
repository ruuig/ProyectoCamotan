<script setup>
import { ref, reactive, computed, watch } from 'vue';
import servicio from '../../services/pacientes';
import Icono from '../comunes/Icono.vue';
import SelectorComunidad from '../comunes/SelectorComunidad.vue';
import CampoSiNo from './CampoSiNo.vue';
import HistorialSeccion from './HistorialSeccion.vue';
import { etiquetas } from '../../dominio/ficha';

/**
 * Identificación del paciente (o el bloque "Datos para el SIGSA"), tal como
 * la trae la ficha oficial de su edad. Vive en columnas del paciente; se
 * guarda sola, como las demás secciones.
 */
const props = defineProps({
  campos: { type: Array, required: true },
  datos: { type: Object, required: true },
  sensiblesRegistrados: { type: Array, default: () => [] },
  paciente: { type: Object, required: true },
  fichaClave: { type: String, required: true },
  catalogos: { type: Object, default: () => ({}) },
  municipios: { type: Object, default: () => ({}) },
  puedeVerSensibles: { type: Boolean, default: false },
  // Sobre qué historial se consulta.
  historial: { type: String, default: 'identificacion' },
});
const emit = defineEmits(['guardada', 'sin-guardar']);

const SOLO_LECTURA = ['registrado', 'calculado'];
const form = reactive({});
const guardando = ref(false);
const mensaje = ref('');
const error = ref('');
const verHistorial = ref(false);

const editables = computed(() => props.campos.filter((c) => !SOLO_LECTURA.includes(c.tipo)));
const claves = computed(() => editables.value.flatMap((c) => [c.clave, ...(c.especifique ? [c.especifique.clave] : [])]));

function cargarForm() {
  for (const k of claves.value) form[k] = props.datos[k] ?? null;
}
watch(() => props.datos, cargarForm, { immediate: true });

const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const bloqueado = (clave) => props.sensiblesRegistrados.includes(clave) && !props.puedeVerSensibles;

const cambios = computed(() => {
  const salida = {};
  for (const k of claves.value) {
    if (bloqueado(k)) continue;
    const antes = vacio(props.datos[k]) ? null : props.datos[k];
    const ahora = vacio(form[k]) ? null : form[k];
    if (antes !== ahora) salida[k] = ahora;
  }
  return salida;
});
const hayCambios = computed(() => Object.keys(cambios.value).length > 0);
watch(hayCambios, (v) => emit('sin-guardar', v), { immediate: true });

const seMuestra = (c) => !c.mostrarSi || form[c.mostrarSi.campo] === c.mostrarSi.igual;

// Los campos agrupados por subdivisión del papel, en su orden.
const bloques = computed(() => {
  const salida = [];
  for (const c of props.campos) {
    if (!seMuestra(c)) continue;
    const titulo = c.subseccion ?? null;
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.titulo === titulo) ultimo.campos.push(c);
    else salida.push({ titulo, campos: [c] });
  }
  return salida;
});

function opcionesDe(c) {
  let lista = c.opciones
    ?? (props.catalogos[c.catalogo] ?? []).map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta }));
  // Lo guardado que no es una opción del papel (por ejemplo "Unido/a") se
  // muestra igual: no se pierde en silencio.
  const actual = form[c.clave];
  if (!vacio(actual) && !lista.some((o) => o.valor === actual)) {
    const delCatalogo = (props.catalogos.estado_civil ?? []).find((o) => o.codigo === actual);
    lista = [...lista, { valor: actual, etiqueta: `${delCatalogo?.etiqueta ?? actual} (registrado antes)` }];
  }
  return lista;
}

const municipiosPara = (c) => props.municipios[form[c.dependeDe]] ?? [];

const formatoFecha = new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function valorFijo(c) {
  const p = props.paciente;
  switch (c.clave) {
    case 'nombres': return p.nombres;
    case 'apellidos': return p.apellidos;
    case 'sexo': return p.sexo === 'M' ? 'Masculino' : 'Femenino';
    case 'fechaNacimiento':
      return `${formatoFecha.format(new Date(p.fechaNacimiento))}${p.fechaNacimientoEstimada ? ' (aproximada)' : ''}`;
    case 'edad': {
      const { anios, meses, dias } = p.edad;
      if (props.fichaClave === 'recien_nacido') {
        return plural(Math.floor((Date.now() - new Date(p.fechaNacimiento)) / 86400000), 'día', 'días');
      }
      if (props.fichaClave === 'lactante_ninez') {
        return `${plural(anios, 'año', 'años')}, ${plural(meses, 'mes', 'meses')} y ${plural(dias, 'día', 'días')}`;
      }
      return plural(anios, 'año', 'años');
    }
    default: return '';
  }
}

const anchoCompleto = (c) => c.clave === 'domicilio' || c.tipo === 'siNoEspecifique' || c.clave === 'responsableNombre';
const nombres = computed(() => etiquetas(props.campos));

async function guardar() {
  error.value = '';
  mensaje.value = '';
  const datos = { ...cambios.value };
  if (datos.migrante === false || datos.migrante === null) datos.origenMigracion = null;
  if (Object.keys(datos).length === 0) {
    mensaje.value = 'No hay cambios por guardar.';
    return;
  }
  guardando.value = true;
  try {
    await servicio.actualizar(props.paciente.id, datos);
    const n = Object.keys(datos).length;
    mensaje.value = n === 1 ? 'Guardado: 1 dato.' : `Guardado: ${n} datos.`;
    verHistorial.value = false;
    emit('guardada');
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <form class="space-y-6" @submit.prevent="guardar">
    <div v-for="(b, i) in bloques" :key="i">
      <h4
        v-if="b.titulo"
        class="mb-4 flex items-center gap-3 font-titulo text-lg font-bold text-tinta after:h-px after:flex-1 after:bg-linea"
      >
        {{ b.titulo }}
      </h4>

      <div class="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <div v-for="c in b.campos" :key="c.clave" :class="anchoCompleto(c) ? 'sm:col-span-2' : ''">
          <!-- Del registro o calculado: se muestra, no se vuelve a pedir -->
          <template v-if="c.tipo === 'registrado' || c.tipo === 'calculado'">
            <p class="etiqueta-campo">{{ c.etiqueta }}</p>
            <p class="flex h-[46px] items-center rounded-[10px] bg-[#F1F5F9] px-[14px] font-semibold text-tinta">{{ valorFijo(c) }}</p>
          </template>

          <template v-else>
            <label :for="`campo-${c.clave}`" class="etiqueta-campo flex flex-wrap items-center gap-x-2">
              {{ c.etiqueta }}
              <span v-if="c.requerido && vacio(form[c.clave])" class="text-sm font-bold text-advertencia">· falta para el SIGSA</span>
              <span v-if="c.sensible" class="inline-flex items-center gap-1 text-sm font-normal text-apagado">
                <Icono nombre="escudo" :tamano="14" /> Dato sensible
              </span>
            </label>

            <p v-if="bloqueado(c.clave)" class="inline-flex rounded-control bg-linea-suave px-3 py-2 font-bold text-tinta-2">
              Registrado · solo lo ve el personal médico
            </p>

            <div v-else-if="c.tipo === 'siNo' || c.tipo === 'siNoEspecifique'" class="flex flex-wrap items-center gap-3">
              <CampoSiNo :id="`campo-${c.clave}`" v-model="form[c.clave]" :etiqueta="c.etiqueta" />
              <input
                v-if="c.tipo === 'siNoEspecifique' && form[c.clave] === true"
                v-model="form[c.especifique.clave]"
                :placeholder="c.especifique.etiqueta"
                :aria-label="`${c.etiqueta}: ${c.especifique.etiqueta.toLowerCase()}`"
                class="campo min-w-[14rem] flex-1"
              />
            </div>

            <select
              v-else-if="['seleccion', 'catalogo', 'departamento'].includes(c.tipo)"
              :id="`campo-${c.clave}`"
              v-model="form[c.clave]"
              class="campo"
            >
              <option :value="null">Sin registrar</option>
              <option v-for="o in opcionesDe(c)" :key="o.valor" :value="o.valor">{{ o.etiqueta }}</option>
            </select>

            <template v-else-if="c.tipo === 'municipio'">
              <input :id="`campo-${c.clave}`" v-model="form[c.clave]" :list="`lista-${c.clave}`" autocomplete="off" class="campo" />
              <datalist :id="`lista-${c.clave}`">
                <option v-for="m in municipiosPara(c)" :key="m" :value="m" />
              </datalist>
            </template>

            <SelectorComunidad
              v-else-if="c.tipo === 'comunidad'"
              :id="`campo-${c.clave}`"
              v-model="form.lugarPobladoId"
              :nombre-actual="paciente.comunidad"
            />

            <div v-else-if="c.tipo === 'numero'" class="flex items-center gap-3">
              <input
                :id="`campo-${c.clave}`"
                v-model.number="form[c.clave]"
                type="number" :min="c.minimo" :max="c.maximo" inputmode="numeric"
                class="campo max-w-[9rem] tabular-nums"
              />
              <span v-if="c.unidad" class="text-apagado">{{ c.unidad }}</span>
            </div>

            <input
              v-else-if="c.tipo === 'cui'"
              :id="`campo-${c.clave}`"
              v-model="form[c.clave]"
              inputmode="numeric" maxlength="13" placeholder="13 dígitos"
              class="campo tabular-nums"
            />

            <input
              v-else
              :id="`campo-${c.clave}`"
              v-model="form[c.clave]"
              :type="c.tipo === 'correo' ? 'email' : c.tipo === 'telefono' ? 'tel' : 'text'"
              class="campo"
              :class="c.tipo === 'telefono' ? 'tabular-nums' : ''"
            />

            <p v-if="c.ayuda" class="mt-1 text-sm text-apagado">{{ c.ayuda }}</p>
          </template>
        </div>
      </div>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-empeora" />
      <span class="text-tinta-2">{{ error }}</span>
    </p>

    <div class="flex flex-wrap items-center gap-3 border-t border-linea pt-4">
      <button type="submit" class="boton-primario" :disabled="guardando">
        <Icono nombre="guardar" :tamano="18" />
        {{ guardando ? 'Guardando…' : 'Guardar sección' }}
      </button>
      <button type="button" class="enlace ml-auto" @click="verHistorial = !verHistorial">
        {{ verHistorial ? 'Ocultar historial' : 'Ver historial de cambios' }}
      </button>
      <p v-if="mensaje" class="w-full text-sm font-bold text-mejora" aria-live="polite">{{ mensaje }}</p>
    </div>

    <HistorialSeccion
      v-if="verHistorial"
      :paciente-id="paciente.id"
      :seccion="historial"
      :etiquetas="nombres"
    />
  </form>
</template>
