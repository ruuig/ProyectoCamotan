<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/pacientes';
import Icono from '../../components/comunes/Icono.vue';
import SelectorComunidad from '../../components/comunes/SelectorComunidad.vue';
import CompletarFicha from './CompletarFicha.vue';
import { cronometro } from '../../dominio/cronometro';
import { analizarCui, MOTIVO_CUI } from '../../dominio/cui';
import { useEstablecimientoStore } from '../../stores/establecimiento';

/**
 * Registro rápido: lo mínimo para poder atender.
 *
 * En preconsulta hay fila, así que el registro se parte en dos momentos. El
 * resto de la ficha se completa desde el expediente cuando haya tiempo.
 */
const router = useRouter();

const form = reactive({
  nombres: '',
  apellidos: '',
  cui: '',
  sexo: '',
  fechaNacimiento: '',
  lugarPobladoId: null,
  telefono: '',
  responsableNombre: '',
  responsableParentesco: '',
  responsableTelefono: '',
  responsableDpi: '',
  expedientePapel: '',
});

// El DPI se escribe como viene impreso (2039 43817 0101): se guardan solo los dígitos.
const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');
const cuiIncompleto = (texto) => {
  const n = soloDigitos(texto).length;
  return n > 0 && n !== 13;
};

// Con los 13 dígitos el CUI dice si está bien escrito y dónde se inscribió.
const cui = computed(() => analizarCui(form.cui));
const cuiInvalido = computed(() => !cui.value.valido && cui.value.motivo !== 'incompleto');
// La comunidad del catálogo es del municipio del centro.
const establecimiento = useEstablecimientoStore();

// Quien no conoce su fecha de nacimiento declara su edad.
const noConoceFecha = ref(false);
const edadDeclarada = reactive({ valor: '', unidad: 'anios' });

const PARENTESCOS = [
  { codigo: 'madre', etiqueta: 'Madre' },
  { codigo: 'padre', etiqueta: 'Padre' },
  { codigo: 'abuelo', etiqueta: 'Abuelo/a' },
  { codigo: 'hermano', etiqueta: 'Hermano/a' },
  { codigo: 'tio', etiqueta: 'Tío/a' },
  { codigo: 'otro_familiar', etiqueta: 'Otro familiar' },
  { codigo: 'tutor_legal', etiqueta: 'Tutor legal' },
  { codigo: 'otro', etiqueta: 'Otro' },
];

const duplicados = ref([]);
// El CUI ya está en otro expediente: no es un parecido, es la misma persona.
const cuiRegistrado = ref(null);
const error = ref('');
const detallesError = ref([]);
const guardando = ref(false);
// Tiempo de registro: de la primera tecla en nombre o CUI hasta que queda guardado.
const reloj = cronometro('registro', 'registrar_paciente');
// "Registrar y llenar la ficha completa": al registrar, la ficha entera se
// despliega aquí mismo en lugar de ir al expediente.
const conFicha = ref(false);
const registrado = ref(null);

// Los años cumplidos, para decidir si hay que pedir responsable.
const aniosCalculados = computed(() => {
  if (noConoceFecha.value) {
    if (edadDeclarada.unidad === 'anios') return Number(edadDeclarada.valor) || 0;
    return 0;
  }
  if (!form.fechaNacimiento) return null;
  const nacimiento = new Date(form.fechaNacimiento);
  return Math.floor((Date.now() - nacimiento) / (365.25 * 86400000));
});

const pideResponsable = computed(
  () => aniosCalculados.value !== null && aniosCalculados.value < 18,
);

// De 10 a 17 el formulario oficial lo llama "referente adulto".
const esReferenteAdulto = computed(
  () => aniosCalculados.value !== null && aniosCalculados.value >= 10 && aniosCalculados.value < 18,
);

// La advertencia de duplicado aparece mientras se escribe, no al guardar.
let temporizador;
watch(
  () => [form.nombres, form.apellidos],
  () => {
    clearTimeout(temporizador);
    if (form.nombres.trim().length < 3 || form.apellidos.trim().length < 3) {
      duplicados.value = [];
      return;
    }
    temporizador = setTimeout(async () => {
      try {
        const datos = await servicio.revisarDuplicados({
          nombres: form.nombres,
          apellidos: form.apellidos,
          ...(form.fechaNacimiento ? { fechaNacimiento: form.fechaNacimiento } : {}),
        });
        duplicados.value = datos.posiblesDuplicados;
      } catch {
        duplicados.value = [];
      }
    }, 500);
  },
);

async function guardar(confirmarDuplicado = false, llenarFicha = conFicha.value) {
  conFicha.value = llenarFicha;
  error.value = '';
  detallesError.value = [];
  cuiRegistrado.value = null;
  if (cuiIncompleto(form.cui) || (pideResponsable.value && cuiIncompleto(form.responsableDpi))) {
    error.value = 'El CUI o DPI debe tener 13 dígitos.';
    return;
  }
  if (cuiInvalido.value) {
    error.value = `${MOTIVO_CUI[cui.value.motivo]}.`;
    return;
  }
  guardando.value = true;

  try {
    const datos = await servicio.crear({
      nombres: form.nombres,
      apellidos: form.apellidos,
      sexo: form.sexo,
      lugarPobladoId: form.lugarPobladoId,
      telefono: form.telefono || null,
      cui: soloDigitos(form.cui) || null,
      expedientePapel: form.expedientePapel || null,
      ...(noConoceFecha.value
        ? { edadDeclarada: { valor: Number(String(edadDeclarada.valor).replace(/[^0-9]/g, '')), unidad: edadDeclarada.unidad } }
        : { fechaNacimiento: form.fechaNacimiento }),
      ...(pideResponsable.value
        ? {
          responsableNombre: form.responsableNombre,
          responsableParentesco: form.responsableParentesco || null,
          responsableTelefono: form.responsableTelefono || null,
          responsableDpi: soloDigitos(form.responsableDpi) || null,
        }
        : {}),
      confirmarDuplicado,
    });
    reloj.terminar(datos.paciente.id);
    if (llenarFicha) {
      registrado.value = datos.paciente;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      router.push(`/pacientes/${datos.paciente.id}`);
    }
  } catch (fallo) {
    error.value = fallo.message;
    detallesError.value = Array.isArray(fallo.detalles) ? fallo.detalles : [];
    if (fallo.codigo === 'posible_duplicado') duplicados.value = fallo.detalles;
    if (fallo.codigo === 'cui_registrado') {
      error.value = '';
      cuiRegistrado.value = { mensaje: fallo.message, paciente: fallo.detalles?.[0] ?? null };
    }
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <section class="mx-auto" :class="registrado ? 'max-w-[1180px]' : 'max-w-[1040px]'">
    <RouterLink to="/pacientes" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Pacientes</RouterLink>
    <header class="b-cabecera">
      <h1 class="b-titulo">Registrar paciente</h1>
    </header>

    <!-- Ya registrado: la ficha completa, toda abierta para llenarla aquí -->
    <template v-if="registrado">
      <div class="b-aviso ok mt-5 flex-wrap items-center justify-between gap-2">
        <span>{{ registrado.nombres }} {{ registrado.apellidos }} registrado.</span>
        <RouterLink :to="`/pacientes/${registrado.id}`" class="b-btn primario chico">Terminar e ir al expediente</RouterLink>
      </div>
      <div class="mt-4">
        <CompletarFicha :paciente-id="registrado.id" embebido />
      </div>
    </template>

    <!-- Posible duplicado: antes de crear, no después -->
    <div v-if="duplicados.length && !registrado" class="b-panel duplicados mt-5" role="alert">
      <header class="b-panel-cabeza">
        <h2 class="b-panel-titulo">¿Es alguna de estas personas?</h2>
        <span class="b-estado cuarentena">Nombre parecido</span>
      </header>
      <ul>
        <li v-for="dup in duplicados" :key="dup.id" class="fila-dup">
          <span class="min-w-0 flex-1">
            <b class="block text-tinta">{{ dup.nombreCompleto }}</b>
            <small>Exp. {{ dup.expediente }} · {{ dup.comunidad }}<template v-if="dup.responsableNombre"> · responsable {{ dup.responsableNombre }}</template></small>
            <small v-if="dup.razones?.length" class="text-[#7A4F05]">{{ dup.razones.join(' · ') }}</small>
          </span>
          <RouterLink :to="`/pacientes/${dup.id}`" class="b-btn secundario chico">Abrir expediente</RouterLink>
        </li>
      </ul>
    </div>

    <form v-if="!registrado" class="b-panel mt-5 px-6 pb-2 pt-5" @submit.prevent="guardar(false, false)">
      <section class="b-form-seccion">
        <header><h2>Identificación</h2></header>
        <div class="b-rejilla">
          <div class="c6">
            <label for="nombres" class="b-etiqueta">Nombres</label>
            <input id="nombres" v-model="form.nombres" required autocomplete="off" class="b-campo" @input="reloj.iniciar()" />
          </div>
          <div class="c6">
            <label for="apellidos" class="b-etiqueta">Apellidos</label>
            <input id="apellidos" v-model="form.apellidos" required autocomplete="off" class="b-campo" @input="reloj.iniciar()" />
          </div>
          <div class="c4">
            <span class="b-etiqueta">Sexo</span>
            <div class="b-segmentado ancho" role="radiogroup" aria-label="Sexo">
              <button v-for="o in [['F', 'Mujer'], ['M', 'Hombre']]" :key="o[0]" type="button" role="radio" :aria-checked="form.sexo === o[0]" :class="form.sexo === o[0] ? 'on' : ''" @click="form.sexo = o[0]">{{ o[1] }}</button>
            </div>
          </div>
          <div class="c4">
            <label for="cui" class="b-etiqueta">CUI / DPI <span class="b-opcional">opcional</span></label>
            <input id="cui" v-model="form.cui" inputmode="numeric" maxlength="15" placeholder="13 dígitos" autocomplete="off" class="b-campo tabular-nums" :aria-invalid="cuiIncompleto(form.cui)" @input="reloj.iniciar()" />
            <small v-if="cuiIncompleto(form.cui)" class="aviso-campo">Lleva {{ soloDigitos(form.cui).length }} de 13 dígitos</small>
            <small v-else-if="cuiInvalido" class="aviso-campo">{{ MOTIVO_CUI[cui.motivo] }}</small>
            <small v-else-if="cui.valido" class="deducido"><Icono nombre="correcto" :tamano="14" /> Inscrito en {{ [cui.municipio, cui.departamento].filter(Boolean).join(', ') }}</small>
          </div>
          <div class="c4">
            <label for="expedientePapel" class="b-etiqueta">Ficha de papel <span class="b-opcional">opcional</span></label>
            <input id="expedientePapel" v-model="form.expedientePapel" placeholder="M-125" class="b-campo" />
          </div>
        </div>
      </section>

      <section class="b-form-seccion">
        <header><h2>Edad</h2></header>
        <div class="b-rejilla">
          <div class="c12">
            <div class="b-segmentado" role="radiogroup" aria-label="Cómo se conoce la edad">
              <button type="button" role="radio" :aria-checked="!noConoceFecha" :class="!noConoceFecha ? 'on' : ''" @click="noConoceFecha = false">Fecha de nacimiento</button>
              <button type="button" role="radio" :aria-checked="noConoceFecha" :class="noConoceFecha ? 'on' : ''" @click="noConoceFecha = true">Edad aproximada</button>
            </div>
          </div>
          <div v-if="!noConoceFecha" class="c4">
            <label for="fechaNacimiento" class="b-etiqueta">Fecha de nacimiento</label>
            <input id="fechaNacimiento" v-model="form.fechaNacimiento" type="date" :required="!noConoceFecha" class="b-campo" />
          </div>
          <template v-else>
            <div class="c3">
              <label for="edadValor" class="b-etiqueta">Edad</label>
              <input id="edadValor" v-model="edadDeclarada.valor" inputmode="numeric" :required="noConoceFecha" class="b-campo num" />
            </div>
            <div class="c6">
              <span class="b-etiqueta">En</span>
              <div class="b-segmentado" role="radiogroup" aria-label="Unidad">
                <button v-for="u in [['anios', 'Años'], ['meses', 'Meses'], ['dias', 'Días']]" :key="u[0]" type="button" role="radio" :aria-checked="edadDeclarada.unidad === u[0]" :class="edadDeclarada.unidad === u[0] ? 'on' : ''" @click="edadDeclarada.unidad = u[0]">{{ u[1] }}</button>
              </div>
            </div>
          </template>
        </div>
      </section>

      <section class="b-form-seccion">
        <header><h2>Ubicación y contacto</h2></header>
        <div class="b-rejilla">
          <div class="c8">
            <label for="comunidad" class="b-etiqueta">Comunidad</label>
            <SelectorComunidad id="comunidad" v-model="form.lugarPobladoId" />
            <small v-if="form.lugarPobladoId && establecimiento.ubicacion" class="deducido"><Icono nombre="correcto" :tamano="14" /> Reside en {{ establecimiento.ubicacion }}</small>
          </div>
          <div class="c4">
            <label for="telefono" class="b-etiqueta">Teléfono <span class="b-opcional">opcional</span></label>
            <input id="telefono" v-model="form.telefono" inputmode="tel" class="b-campo" />
          </div>
        </div>
      </section>

      <section v-if="pideResponsable" class="b-form-seccion">
        <header><h2>{{ esReferenteAdulto ? 'Referente adulto' : 'Responsable' }}</h2></header>
        <div class="b-rejilla">
          <div class="c12">
            <label for="respNombre" class="b-etiqueta">Nombre completo</label>
            <input id="respNombre" v-model="form.responsableNombre" :required="pideResponsable" class="b-campo" />
          </div>
          <div class="c4">
            <label for="respParentesco" class="b-etiqueta">Parentesco</label>
            <select id="respParentesco" v-model="form.responsableParentesco" class="b-campo">
              <option value="">Elija</option>
              <option v-for="p in PARENTESCOS" :key="p.codigo" :value="p.codigo">{{ p.etiqueta }}</option>
            </select>
          </div>
          <div class="c4">
            <label for="respTelefono" class="b-etiqueta">Teléfono <span class="b-opcional">opcional</span></label>
            <input id="respTelefono" v-model="form.responsableTelefono" inputmode="tel" class="b-campo" />
          </div>
          <div class="c4">
            <label for="respDpi" class="b-etiqueta">DPI <span class="b-opcional">opcional</span></label>
            <input id="respDpi" v-model="form.responsableDpi" inputmode="numeric" maxlength="15" placeholder="13 dígitos" autocomplete="off" class="b-campo tabular-nums" :aria-invalid="cuiIncompleto(form.responsableDpi)" />
            <small v-if="cuiIncompleto(form.responsableDpi)" class="aviso-campo">Lleva {{ soloDigitos(form.responsableDpi).length }} de 13 dígitos</small>
          </div>
        </div>
      </section>

      <div v-if="cuiRegistrado" role="alert" class="b-aviso error mb-4 flex-col items-start gap-2">
        <span>{{ cuiRegistrado.mensaje }}</span>
        <RouterLink v-if="cuiRegistrado.paciente" :to="`/pacientes/${cuiRegistrado.paciente.id}`" class="b-btn secundario chico">Abrir ese expediente</RouterLink>
      </div>

      <div v-if="error" role="alert" class="b-aviso error mb-4 flex-col">
        <span>{{ error }}</span>
        <ul v-if="detallesError.length && detallesError[0].campo" class="text-sm">
          <li v-for="d in detallesError" :key="d.campo">{{ d.mensaje }}</li>
        </ul>
      </div>

      <footer class="pie">
        <button v-if="duplicados.length" type="button" :disabled="guardando" class="b-btn secundario" @click="guardar(true)">Es otra persona, registrar</button>
        <button type="button" :disabled="guardando || !form.sexo" class="b-btn secundario" @click="$event.target.closest('form').reportValidity() && guardar(false, true)">
          <Icono nombre="lapiz" :tamano="20" /> Registrar y llenar la ficha completa
        </button>
        <button type="submit" :disabled="guardando || !form.sexo" class="b-btn primario">
          <Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Guardando…' : 'Registrar paciente' }}
        </button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.deducido { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 13px; font-weight: 700; color: #1E8E5E; }
.ancho { display: flex; }
.aviso-campo { display: block; margin-top: 4px; font-size: 13px; color: #B45309; }
.ancho button { flex: 1; }
.duplicados { border-color: #F5D58A; }
.fila-dup { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-top: 1px solid #F3EAD3; }
.fila-dup:first-child { border-top: none; }
.fila-dup small { display: block; font-size: 13px; color: #64748B; }
.pie { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px; margin: 0 -24px; padding: 14px 24px; background: #fff; border-top: 2px solid #EEF2F6; border-radius: 0 0 14px 14px; }
</style>
