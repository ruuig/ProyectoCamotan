<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import servicio from '../../services/atenciones';
import Icono from '../../components/comunes/Icono.vue';

/**
 * Boleta de Referencia y Contrarreferencia. Llega llena con lo que ya se
 * registró (antecedentes de la ficha, signos de preconsulta, diagnósticos y
 * receta); el médico corrige, completa el motivo y la guarda. Al guardarla
 * por primera vez recibe su número.
 */
const route = useRoute();
const id = route.params.id;

const datos = ref(null);
const error = ref('');
const aviso = ref('');
const guardando = ref(false);

const hoja = reactive({
  tipo: 'consulta_externa', servicioDestino: '', telefono: '', horaTraslado: '', historia: '',
  antecedentes: {}, examenFisico: {}, examenes: '', impresionClinica: '', motivo: '', tratamiento: '',
});
const contra = reactive({ servicio: '', resumen: '', tratamiento: '', diagnostico: '', recomendaciones: '', responsable: '', fechaAlta: '' });

const ANTECEDENTES = [
  ['medicos', 'Médicos'], ['quirurgicos', 'Quirúrgicos'], ['alergicos', 'Alérgicos'],
  ['mentales', 'Mentales'], ['traumaticos', 'Traumáticos'],
];
const GINECO = [
  ['gestas', 'Gestas'], ['partos', 'Partos'], ['abortos', 'Abortos'], ['hijosVivos', 'Hijos vivos'],
  ['hijosMuertos', 'Hijos muertos'], ['fur', 'FUR'], ['cstp', 'CSTP'], ['otros', 'Otros'],
];
const EXAMEN = [
  ['peso', 'Peso'], ['talla', 'Talla'], ['pulso', 'Pulso'], ['pa', 'P/A'],
  ['fr', 'F/R'], ['temperatura', 'T°'], ['fcf', 'FCF'],
];

const referencia = computed(() => datos.value?.referencia ?? null);
const esMujer = computed(() => datos.value?.paciente.sexo === 'F');

function llenar(origen) {
  for (const k of Object.keys(hoja)) {
    if (k === 'antecedentes' || k === 'examenFisico') hoja[k] = { ...(origen[k] ?? {}) };
    else hoja[k] = origen[k] ?? '';
  }
}

async function cargar() {
  error.value = '';
  try {
    datos.value = await servicio.referencia(id);
    const r = datos.value.referencia;
    llenar(r ?? datos.value.borrador);
    if (r) {
      Object.assign(contra, {
        servicio: r.contraServicio ?? '', resumen: r.contraResumen ?? '', tratamiento: r.contraTratamiento ?? '',
        diagnostico: r.contraDiagnostico ?? '', recomendaciones: r.contraRecomendaciones ?? '',
        responsable: r.contraResponsable ?? '', fechaAlta: r.contraFechaAlta ? r.contraFechaAlta.slice(0, 10) : '',
      });
    }
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function guardar(imprimir = false) {
  guardando.value = true;
  error.value = '';
  aviso.value = '';
  try {
    const r = await servicio.guardarReferencia(id, { ...hoja });
    datos.value.referencia = r.referencia;
    aviso.value = `Boleta No. ${r.referencia.numero} guardada`;
    if (imprimir) window.open(`/imprimir/referencia/${id}`, '_blank');
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

async function guardarContra() {
  error.value = '';
  aviso.value = '';
  try {
    const r = await servicio.guardarContrarreferencia(id, { ...contra });
    datos.value.referencia = r.referencia;
    aviso.value = 'Contrarreferencia registrada';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function usarSugerido() {
  llenar({ ...datos.value.borrador, motivo: hoja.motivo, servicioDestino: hoja.servicioDestino || datos.value.borrador.servicioDestino });
}

onMounted(cargar);
</script>

<template>
  <div class="space-y-bloque">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="titulo-pagina">
          Boleta de referencia
          <span v-if="referencia" class="ml-2 font-mono text-xl text-apagado">No. {{ referencia.numero }}</span>
        </h1>
        <p v-if="datos" class="text-lg font-semibold text-tinta">
          {{ datos.paciente.nombres }} {{ datos.paciente.apellidos }}
          <span class="font-normal text-apagado">· {{ datos.paciente.edad }} · {{ datos.paciente.sexo === 'F' ? 'Femenino' : 'Masculino' }} · {{ datos.paciente.residencia }}</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <RouterLink :to="`/consulta/${id}`" class="boton-secundario"><Icono nombre="volver" :tamano="18" /> Volver a la consulta</RouterLink>
        <RouterLink v-if="referencia" :to="`/imprimir/referencia/${id}`" target="_blank" class="boton-secundario">Imprimir</RouterLink>
      </div>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente">{{ error }}</p>
    <p v-if="aviso" role="status" class="aviso aviso-informativo">{{ aviso }}</p>

    <form v-if="datos" class="space-y-bloque" @submit.prevent="guardar(true)">
      <article class="panel">
        <header class="panel-encabezado">
          <h2 class="panel-titulo">A dónde va</h2>
          <button v-if="!referencia" type="button" class="text-sm underline text-apagado" @click="usarSugerido">Volver a lo que trae el expediente</button>
        </header>
        <div class="grid gap-3 p-relleno md:grid-cols-12">
          <fieldset class="md:col-span-3">
            <legend class="etiqueta-campo">Se envía a</legend>
            <div class="mt-1 flex gap-2">
              <label class="flex items-center gap-1.5"><input v-model="hoja.tipo" type="radio" value="consulta_externa" /> Consulta externa</label>
              <label class="flex items-center gap-1.5"><input v-model="hoja.tipo" type="radio" value="emergencia" /> Emergencia</label>
            </div>
          </fieldset>
          <div class="md:col-span-5">
            <label for="destino" class="etiqueta-campo">Servicio de salud al que se envía</label>
            <input id="destino" v-model="hoja.servicioDestino" required minlength="3" class="campo" placeholder="Hospital Regional de Chiquimula, Pediatría" />
          </div>
          <div class="md:col-span-2">
            <label for="tel" class="etiqueta-campo">Teléfono</label>
            <input id="tel" v-model="hoja.telefono" class="campo" />
          </div>
          <div class="md:col-span-2">
            <label for="hora" class="etiqueta-campo">Hora de traslado</label>
            <input id="hora" v-model="hoja.horaTraslado" type="time" class="campo" />
          </div>
          <div class="md:col-span-12">
            <label for="motivo" class="etiqueta-campo">Motivo de la referencia</label>
            <textarea id="motivo" v-model="hoja.motivo" required minlength="3" rows="2" class="campo" />
          </div>
        </div>
      </article>

      <div class="grid gap-bloque lg:grid-cols-2">
        <article class="panel">
          <header class="panel-encabezado"><h2 class="panel-titulo">Historia y antecedentes</h2></header>
          <div class="space-y-3 p-relleno">
            <div>
              <label for="historia" class="etiqueta-campo">Historia de la enfermedad actual</label>
              <textarea id="historia" v-model="hoja.historia" rows="3" class="campo" />
            </div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div v-for="[k, t] in ANTECEDENTES" :key="k" :class="k === 'medicos' ? 'col-span-2 sm:col-span-3' : ''">
                <label :for="`a-${k}`" class="etiqueta-campo">{{ t }}</label>
                <input :id="`a-${k}`" v-model="hoja.antecedentes[k]" class="campo" />
              </div>
            </div>
            <div v-if="esMujer">
              <p class="etiqueta-campo">Gineco-obstétricos</p>
              <div class="grid grid-cols-4 gap-2">
                <div v-for="[k, t] in GINECO" :key="k">
                  <label :for="`g-${k}`" class="text-sm text-apagado">{{ t }}</label>
                  <input :id="`g-${k}`" v-model="hoja.antecedentes[k]" class="campo" />
                </div>
              </div>
            </div>
          </div>
        </article>

        <article class="panel">
          <header class="panel-encabezado"><h2 class="panel-titulo">Examen y manejo</h2></header>
          <div class="space-y-3 p-relleno">
            <div class="grid grid-cols-4 gap-2 sm:grid-cols-7">
              <div v-for="[k, t] in EXAMEN" :key="k">
                <label :for="`e-${k}`" class="text-sm text-apagado">{{ t }}</label>
                <input :id="`e-${k}`" v-model="hoja.examenFisico[k]" class="campo" />
              </div>
            </div>
            <div>
              <label for="examenes" class="etiqueta-campo">Exámenes realizados</label>
              <textarea id="examenes" v-model="hoja.examenes" rows="2" class="campo" />
            </div>
            <div>
              <label for="impresion" class="etiqueta-campo">Impresión clínica</label>
              <textarea id="impresion" v-model="hoja.impresionClinica" rows="2" class="campo" />
            </div>
            <div>
              <label for="trat" class="etiqueta-campo">Tratamiento y manejo efectuado en el servicio</label>
              <textarea id="trat" v-model="hoja.tratamiento" rows="3" class="campo" />
            </div>
          </div>
        </article>
      </div>

      <div class="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 border-t border-linea bg-fondo py-3">
        <button type="button" class="boton-secundario" :disabled="guardando" @click="guardar(false)">Guardar</button>
        <button type="submit" class="boton-primario" :disabled="guardando">
          {{ referencia ? 'Guardar e imprimir' : 'Guardar, numerar e imprimir' }}
        </button>
      </div>
    </form>

    <article v-if="referencia" class="panel">
      <header class="panel-encabezado">
        <h2 class="panel-titulo">Contrarreferencia</h2>
        <span class="text-sm text-apagado">
          {{ referencia.contraRecibidaEn ? `Recibida el ${new Date(referencia.contraRecibidaEn).toLocaleDateString('es-GT')}` : 'Se copia cuando el paciente regresa con ella' }}
        </span>
      </header>
      <form class="grid gap-3 p-relleno md:grid-cols-12" @submit.prevent="guardarContra">
        <div class="md:col-span-5">
          <label for="c-serv" class="etiqueta-campo">Servicio que atendió</label>
          <input id="c-serv" v-model="contra.servicio" class="campo" />
        </div>
        <div class="md:col-span-4">
          <label for="c-resp" class="etiqueta-campo">Responsable de la atención</label>
          <input id="c-resp" v-model="contra.responsable" class="campo" />
        </div>
        <div class="md:col-span-3">
          <label for="c-alta" class="etiqueta-campo">Fecha del alta</label>
          <input id="c-alta" v-model="contra.fechaAlta" type="date" class="campo" />
        </div>
        <div class="md:col-span-6">
          <label for="c-res" class="etiqueta-campo">Resumen de la evolución</label>
          <textarea id="c-res" v-model="contra.resumen" rows="2" class="campo" />
        </div>
        <div class="md:col-span-6">
          <label for="c-dx" class="etiqueta-campo">Diagnóstico</label>
          <textarea id="c-dx" v-model="contra.diagnostico" rows="2" class="campo" />
        </div>
        <div class="md:col-span-6">
          <label for="c-tr" class="etiqueta-campo">Tratamiento brindado</label>
          <textarea id="c-tr" v-model="contra.tratamiento" rows="2" class="campo" />
        </div>
        <div class="md:col-span-6">
          <label for="c-rec" class="etiqueta-campo">Recomendaciones</label>
          <textarea id="c-rec" v-model="contra.recomendaciones" rows="2" class="campo" />
        </div>
        <div class="flex justify-end md:col-span-12">
          <button type="submit" class="boton-primario">Registrar contrarreferencia</button>
        </div>
      </form>
    </article>
  </div>
</template>
