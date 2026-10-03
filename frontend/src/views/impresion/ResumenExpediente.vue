<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../services/http';
import servicioPacientes from '../../services/pacientes';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import CurvaCrecimiento from '../../components/comunes/CurvaCrecimiento.vue';

/**
 * Resumen del expediente: identificación, antecedentes, atenciones con su
 * diagnóstico y tratamiento, y la curva de crecimiento en menores de 5 años.
 */
const route = useRoute();

const paciente = ref(null);
const historial = ref([]);
const curva = ref(null);
const establecimiento = ref(null);
const error = ref('');

function fecha(v) {
  return v ? new Date(v).toLocaleDateString('es-GT') : '';
}

async function cargar() {
  try {
    const id = route.params.id;
    const [datos, hist, est] = await Promise.all([
      servicioPacientes.obtener(id),
      servicioPacientes.historial(id).catch(() => ({ atenciones: [] })),
      http.get('/admin/establecimiento').catch(() => ({ establecimiento: null })),
    ]);

    paciente.value = datos.paciente;
    historial.value = hist.atenciones ?? [];
    establecimiento.value = est.establecimiento;

    // La curva solo tiene sentido mientras la OMS la cubre.
    if (paciente.value.edad.edadMeses <= 60) {
      curva.value = await servicioPacientes.curva(id, 'peso_edad').catch(() => null);
    }

    await http.post('/impresiones', {
      documento: 'resumen_expediente',
      pacienteId: Number(id),
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
    v-else-if="paciente"
    titulo="Resumen del expediente clínico"
    :establecimiento="establecimiento"
  >
    <section class="bloque-impresion">
      <h2>Identificación</h2>
      <table>
        <tbody>
          <tr>
            <th class="w-40">Expediente</th>
            <td>{{ paciente.expediente }}</td>
            <th class="w-40">Expediente en papel</th>
            <td>{{ paciente.expedientePapel ?? '' }}</td>
          </tr>
          <tr>
            <th>Nombre</th>
            <td>{{ paciente.apellidos }}, {{ paciente.nombres }}</td>
            <th>CUI</th>
            <td>{{ paciente.cui ?? '' }}</td>
          </tr>
          <tr>
            <th>Fecha de nacimiento</th>
            <td>
              {{ fecha(paciente.fechaNacimiento) }}
              <span v-if="paciente.fechaNacimientoEstimada">(aproximada)</span>
            </td>
            <th>Edad</th>
            <td>{{ paciente.edad.anios }} años {{ paciente.edad.meses }} meses</td>
          </tr>
          <tr>
            <th>Sexo</th>
            <td>{{ paciente.sexo === 'M' ? 'Masculino' : 'Femenino' }}</td>
            <th>Comunidad</th>
            <td>{{ paciente.comunidad }}</td>
          </tr>
          <tr v-if="paciente.responsableNombre">
            <th>Responsable</th>
            <td>{{ paciente.responsableNombre }}</td>
            <th>Parentesco</th>
            <td>{{ paciente.responsableParentesco ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="paciente.condiciones?.length" class="bloque-impresion">
      <h2>Condiciones vigentes</h2>
      <p>{{ paciente.condiciones.map((c) => c.tipo).join(', ') }}</p>
    </section>

    <section v-if="paciente.embarazo" class="bloque-impresion">
      <h2>Embarazo</h2>
      <p>{{ paciente.embarazo.texto }}</p>
    </section>

    <section class="bloque-impresion">
      <h2>Atenciones ({{ historial.length }})</h2>
      <table v-if="historial.length">
        <thead>
          <tr>
            <th class="w-24">Fecha</th>
            <th>Motivo</th>
            <th class="w-20">CIE-10</th>
            <th>Diagnóstico</th>
            <th>Tratamiento</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in historial" :key="a.id">
            <td>{{ fecha(a.registradaEn) }}</td>
            <td>{{ a.motivoConsulta }}</td>
            <td>{{ a.diagnosticoCie ?? '' }}</td>
            <td>{{ a.diagnosticoTxt ?? '' }}</td>
            <td>{{ a.tratamiento ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>Sin atenciones registradas.</p>
    </section>

    <!-- La curva solo en menores de 5 años, que es lo que cubre la OMS -->
    <section v-if="curva" class="bloque-impresion salto-pagina">
      <h2>Curva de crecimiento: peso para la edad</h2>
      <CurvaCrecimiento :curva="curva" />
    </section>
  </HojaImpresion>

  <p v-else class="no-imprimir text-slate-500">Preparando el resumen...</p>
</template>
