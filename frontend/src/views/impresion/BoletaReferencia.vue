<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../services/http';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';

/**
 * Boleta de referencia.
 *
 * El formato exacto está pendiente de confirmar con el centro de salud. Esta
 * versión lleva lo que las fichas oficiales piden al referir: identificación,
 * motivo, diagnóstico, signos vitales, tratamiento dado y establecimiento de
 * destino. Los campos que no se pueden llenar desde el sistema quedan en
 * blanco para escribirlos a mano.
 */
const route = useRoute();

const atencion = ref(null);
const paciente = ref(null);
const establecimiento = ref(null);
const error = ref('');

function fecha(v) {
  return v ? new Date(v).toLocaleDateString('es-GT') : '';
}

async function cargar() {
  try {
    const id = route.params.id;
    const [datos, est] = await Promise.all([
      http.get(`/atenciones/${id}`),
      http.get('/admin/establecimiento').catch(() => ({ establecimiento: null })),
    ]);

    atencion.value = datos.atencion;
    paciente.value = datos.atencion.paciente;
    establecimiento.value = est.establecimiento;

    await http.post('/impresiones', {
      documento: 'boleta_referencia',
      pacienteId: paciente.value?.id ?? null,
      atencionId: Number(id),
    });
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargar);
</script>

<template>
  <p v-if="error" role="alert" class="aviso aviso-urgente no-imprimir">{{ error }}</p>

  <HojaImpresion
    v-else-if="atencion"
    titulo="Boleta de referencia"
    :establecimiento="establecimiento"
  >
    <p class="no-imprimir aviso aviso-atencion mb-3">
      El formato definitivo de esta boleta está pendiente de confirmar con el centro
      de salud. Esta versión reúne los datos que piden las fichas oficiales al referir.
    </p>

    <section class="bloque-impresion">
      <h2>Establecimiento que refiere</h2>
      <table>
        <tbody>
          <tr>
            <th class="w-40">Nombre</th>
            <td>{{ establecimiento?.nombre ?? '' }}</td>
            <th class="w-28">Fecha</th>
            <td>{{ fecha(new Date()) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="bloque-impresion">
      <h2>Datos del paciente</h2>
      <table>
        <tbody>
          <tr>
            <th class="w-40">Nombre</th>
            <td>{{ paciente.apellidos }}, {{ paciente.nombres }}</td>
            <th class="w-28">Expediente</th>
            <td>{{ paciente.expediente }}</td>
          </tr>
          <tr>
            <th>Fecha de nacimiento</th>
            <td>{{ fecha(paciente.fechaNacimiento) }}</td>
            <th>Sexo</th>
            <td>{{ paciente.sexo === 'M' ? 'Masculino' : 'Femenino' }}</td>
          </tr>
          <tr>
            <th>Comunidad</th>
            <td>{{ paciente.comunidad }}</td>
            <th>Responsable</th>
            <td>{{ paciente.responsableNombre ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="bloque-impresion">
      <h2>Motivo de la referencia</h2>
      <p class="min-h-[1.5cm] border border-slate-900 p-1">{{ atencion.motivoConsulta }}</p>
    </section>

    <section class="bloque-impresion">
      <h2>Signos vitales al momento de referir</h2>
      <table>
        <thead>
          <tr>
            <th>Temperatura</th><th>Presión</th><th>F. cardíaca</th>
            <th>F. respiratoria</th><th>SatO2</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{{ atencion.preconsulta?.temperatura ?? '' }}</td>
            <td>
              {{ atencion.preconsulta?.presionSis
                ? `${atencion.preconsulta.presionSis}/${atencion.preconsulta.presionDia}` : '' }}
            </td>
            <td>{{ atencion.preconsulta?.frecCardiaca ?? '' }}</td>
            <td>{{ atencion.preconsulta?.frecRespiratoria ?? '' }}</td>
            <td>{{ atencion.preconsulta?.satOxigeno ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="bloque-impresion">
      <h2>Diagnóstico y tratamiento dado</h2>
      <table>
        <tbody>
          <tr>
            <th class="w-24">CIE-10</th>
            <td>{{ atencion.diagnosticoCie ?? '' }}</td>
          </tr>
          <tr>
            <th>Diagnóstico</th>
            <td>{{ atencion.diagnosticoTxt ?? '' }}</td>
          </tr>
          <tr>
            <th>Tratamiento dado</th>
            <td class="min-h-[1.5cm]">{{ atencion.tratamiento ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="bloque-impresion">
      <h2>Establecimiento de destino</h2>
      <table>
        <tbody>
          <tr><th class="w-40">Nombre</th><td></td></tr>
          <tr><th>Servicio o especialidad</th><td></td></tr>
          <tr><th>Persona que recibe</th><td></td></tr>
        </tbody>
      </table>
    </section>
  </HojaImpresion>

  <p v-else class="no-imprimir text-slate-500">Preparando la boleta...</p>
</template>
