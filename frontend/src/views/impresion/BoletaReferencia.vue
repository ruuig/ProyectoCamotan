<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../services/http';
import LogoInstitucional from '../../components/comunes/LogoInstitucional.vue';

/**
 * Boleta de Referencia y Contrarreferencia del MSPAS, en una hoja carta: la
 * referencia arriba y, después de la línea de corte, la contrarreferencia
 * que llena el servicio que recibe. Lo que no se registró queda en blanco
 * para escribirlo a mano. ?blanco=1 imprime el formato vacío.
 */
const route = useRoute();
const enBlanco = route.query.blanco === '1';

const datos = ref(null);
const error = ref('');

const ref_ = computed(() => (enBlanco ? null : datos.value?.referencia ?? null));
// Sin guardar todavía, se imprime lo que propone el sistema, sin número.
const b = computed(() => (enBlanco ? {} : ref_.value ?? datos.value?.borrador ?? {}));
const p = computed(() => (enBlanco ? {} : datos.value?.paciente ?? {}));
const a = computed(() => b.value.antecedentes ?? {});
const e = computed(() => b.value.examenFisico ?? {});
const est = computed(() => datos.value?.establecimiento ?? null);

const nombre = computed(() => (p.value.nombres ? `${p.value.nombres} ${p.value.apellidos}` : ''));
const sexo = computed(() => ({ F: 'F', M: 'M' })[p.value.sexo] ?? '');
const fecha = computed(() => {
  if (enBlanco) return '';
  const f = ref_.value?.creadaEn ? new Date(ref_.value.creadaEn) : new Date();
  return f.toLocaleDateString('es-GT', { timeZone: 'America/Guatemala' });
});
const refiere = computed(() => (est.value ? `${est.value.nombre}, ${est.value.municipio}` : ''));
const contra = computed(() => ref_.value ?? {});
const altaTexto = computed(() => (contra.value.contraFechaAlta
  ? new Date(contra.value.contraFechaAlta).toLocaleDateString('es-GT', { timeZone: 'UTC' }) : ''));

const X = (v) => (v ? 'X' : '');
const imprimir = () => window.print();

async function cargar() {
  try {
    const id = route.params.id;
    datos.value = await http.get(`/atenciones/${id}/referencia`);
    if (!enBlanco) {
      await http.post('/impresiones', {
        documento: 'boleta_referencia',
        pacienteId: datos.value.paciente.id,
        atencionId: Number(id),
      });
    }
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargar);
</script>

<template>
  <p v-if="error" role="alert" class="aviso aviso-urgente no-imprimir">{{ error }}</p>

  <div v-else-if="datos" class="no-imprimir mx-auto flex max-w-[8.5in] flex-wrap items-center gap-3 p-4 text-sm">
    <span v-if="!ref_ && !enBlanco" class="aviso aviso-atencion">Esta boleta no se ha guardado: sale sin número.</span>
    <button type="button" class="rounded bg-black px-3 py-1.5 font-bold text-white" @click="imprimir">Imprimir</button>
  </div>

  <div v-if="datos" class="boleta hoja-propia mx-auto max-w-[8.5in] bg-white text-black">
    <!-- ============ REFERENCIA ============ -->
    <header class="flex items-center gap-3">
      <LogoInstitucional class="h-12 w-12 shrink-0" />
      <div class="flex-1 text-center">
        <p class="text-[9pt] font-bold uppercase">Ministerio de Salud Pública y Asistencia Social</p>
        <p class="text-[12pt] font-bold tracking-wide">BOLETA REFERENCIA</p>
      </div>
      <div class="w-40 text-right">
        <span class="text-[8pt]">No. correlativo</span>
        <div class="linea text-center font-mono font-bold">{{ ref_?.numero ?? '' }}</div>
      </div>
    </header>

    <div class="fila mt-1 justify-end gap-4">
      <span>Consulta Externa <span class="casilla">{{ X(b.tipo === 'consulta_externa') }}</span></span>
      <span>Emergencia <span class="casilla">{{ X(b.tipo === 'emergencia') }}</span></span>
    </div>

    <div class="fila"><span class="et">Servicio de Salud al que se envía:</span><span class="linea flex-1">{{ b.servicioDestino }}</span></div>
    <div class="fila">
      <span class="et">Servicio de Salud que refiere:</span><span class="linea flex-1">{{ refiere }}</span>
      <span class="et">Fecha:</span><span class="linea w-28">{{ fecha }}</span>
    </div>
    <div class="fila">
      <span class="et">Teléfono:</span><span class="linea w-28">{{ b.telefono }}</span>
      <span class="et">Hora de traslado:</span><span class="linea w-20">{{ b.horaTraslado }}</span>
      <span class="et">Edad:</span><span class="linea w-20">{{ p.edad }}</span>
      <span class="et">Sexo:</span><span class="linea w-10 text-center">{{ sexo }}</span>
    </div>
    <div class="fila">
      <span class="et">Nombre del paciente:</span><span class="linea flex-1">{{ nombre }}</span>
      <span class="et">Residencia:</span><span class="linea w-56">{{ p.residencia }}</span>
    </div>
    <div class="bloque"><span class="et">Historia de la enfermedad actual:</span> {{ b.historia }}</div>

    <div class="mt-1 grid grid-cols-2 gap-2">
      <div>
        <p class="sub">Antecedentes Médicos</p>
        <div class="fila"><span class="et">Médicos:</span><span class="linea flex-1">{{ a.medicos }}</span></div>
        <div class="fila"><span class="et">Quirúrgicos:</span><span class="linea flex-1">{{ a.quirurgicos }}</span></div>
        <div class="fila"><span class="et">Alérgicos:</span><span class="linea flex-1">{{ a.alergicos }}</span></div>
        <div class="fila"><span class="et">Mentales:</span><span class="linea flex-1">{{ a.mentales }}</span></div>
        <div class="fila"><span class="et">Traumáticos:</span><span class="linea flex-1">{{ a.traumaticos }}</span></div>
      </div>
      <div>
        <p class="sub">Antecedentes Gineco-Obstétricos</p>
        <div class="fila">
          <span class="et">Gestas:</span><span class="linea w-8">{{ a.gestas }}</span>
          <span class="et">Partos:</span><span class="linea w-8">{{ a.partos }}</span>
          <span class="et">Abortos:</span><span class="linea w-8">{{ a.abortos }}</span>
        </div>
        <div class="fila">
          <span class="et">Hijos vivos:</span><span class="linea w-8">{{ a.hijosVivos }}</span>
          <span class="et">Hijos muertos:</span><span class="linea w-8">{{ a.hijosMuertos }}</span>
        </div>
        <div class="fila">
          <span class="et">FUR:</span><span class="linea w-24">{{ a.fur }}</span>
          <span class="et">CSTP:</span><span class="linea flex-1">{{ a.cstp }}</span>
        </div>
        <div class="fila"><span class="et">Otros:</span><span class="linea flex-1">{{ a.otros }}</span></div>
      </div>
    </div>

    <p class="sub mt-1">Examen Físico</p>
    <div class="fila">
      <span class="et">Peso:</span><span class="linea w-16">{{ e.peso }}</span>
      <span class="et">Talla:</span><span class="linea w-16">{{ e.talla }}</span>
      <span class="et">Pulso:</span><span class="linea w-12">{{ e.pulso }}</span>
      <span class="et">P/A:</span><span class="linea w-16">{{ e.pa }}</span>
      <span class="et">F/R:</span><span class="linea w-12">{{ e.fr }}</span>
      <span class="et">T°:</span><span class="linea w-16">{{ e.temperatura }}</span>
      <span class="et">FCF:</span><span class="linea w-12">{{ e.fcf }}</span>
    </div>
    <div class="bloque chico"><span class="et">Exámenes realizados:</span> {{ b.examenes }}</div>
    <div class="bloque chico"><span class="et">Impresión clínica:</span> {{ b.impresionClinica }}</div>
    <div class="bloque chico"><span class="et">Motivo de la referencia:</span> {{ b.motivo }}</div>
    <div class="bloque"><span class="et">Tratamiento y manejo efectuado en el servicio:</span> {{ b.tratamiento }}</div>

    <div class="mt-6 grid grid-cols-2 gap-8 text-center text-[8pt]">
      <div><div class="border-t border-black pt-0.5">Nombre, cargo, firma y sellos de quien refiere<br />{{ ref_?.usuario?.nombre ?? '' }}</div></div>
      <div><div class="border-t border-black pt-0.5">Nombre, cargo, firma y sellos de quien recibe la referencia</div></div>
    </div>
    <div class="fila mt-2 justify-end"><span class="et">Fecha y hora en que se reciba la referencia:</span><span class="linea w-48" /></div>

    <div class="corte">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>

    <!-- ============ CONTRARREFERENCIA ============ -->
    <header class="flex items-center gap-3">
      <LogoInstitucional class="h-10 w-10 shrink-0" />
      <p class="flex-1 text-center text-[12pt] font-bold tracking-wide">BOLETA DE CONTRARREFERENCIA</p>
      <div class="w-40 text-right">
        <span class="text-[8pt]">No. correlativo</span>
        <div class="linea text-center font-mono font-bold">{{ ref_?.numero ?? '' }}</div>
      </div>
    </header>
    <div class="fila">
      <span class="et">Nombre del paciente:</span><span class="linea flex-1">{{ nombre }}</span>
      <span class="et">Edad:</span><span class="linea w-20">{{ p.edad }}</span>
      <span class="et">Sexo:</span><span class="linea w-10 text-center">{{ sexo }}</span>
    </div>
    <div class="fila"><span class="et">Dirección:</span><span class="linea flex-1">{{ p.residencia }}</span></div>
    <div class="fila"><span class="et">Servicio que atendió:</span><span class="linea flex-1">{{ contra.contraServicio }}</span></div>
    <div class="fila"><span class="et">Servicio a donde se contra refiere:</span><span class="linea flex-1">{{ refiere }}</span></div>
    <div class="bloque"><span class="et">Resumen de la evolución:</span> {{ contra.contraResumen }}</div>
    <div class="bloque chico"><span class="et">Tratamiento brindado:</span> {{ contra.contraTratamiento }}</div>
    <div class="bloque chico"><span class="et">Diagnóstico:</span> {{ contra.contraDiagnostico }}</div>
    <div class="bloque chico"><span class="et">Recomendaciones:</span> {{ contra.contraRecomendaciones }}</div>
    <div class="mt-6 grid grid-cols-2 gap-8 text-center text-[8pt]">
      <div><div class="border-t border-black pt-0.5">Nombre, firma y cargo del responsable de la atención<br />{{ contra.contraResponsable }}</div></div>
      <div class="fila items-end"><span class="et">Fecha del alta:</span><span class="linea flex-1">{{ altaTexto }}</span></div>
    </div>
  </div>

  <p v-else-if="!error" class="no-imprimir text-slate-500">Preparando la boleta...</p>
</template>

<style scoped>
.boleta { padding: 0.45in 0.5in; font-size: 9pt; line-height: 1.25; }
.fila { display: flex; align-items: flex-end; gap: 0.35rem; margin-top: 0.2rem; }
.et { white-space: nowrap; font-weight: 600; }
.linea { border-bottom: 1px solid #000; min-height: 1.1em; padding: 0 0.2rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.casilla { display: inline-block; width: 1.1em; height: 1.1em; border: 1px solid #000; text-align: center; line-height: 1em; font-weight: 700; }
.sub { font-weight: 700; text-decoration: underline; margin-top: 0.15rem; }
.bloque { border: 1px solid #000; min-height: 3.2em; padding: 0.15rem 0.3rem; margin-top: 0.25rem; white-space: pre-line; }
.bloque.chico { min-height: 2em; }
.corte { margin: 0.6rem 0 0.4rem; overflow: hidden; white-space: nowrap; font-size: 8pt; color: #444; }
@media print {
  @page { size: letter; margin: 0; }
  .boleta { max-width: none; }
}
</style>
