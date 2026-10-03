<script setup>
import { ref, onMounted } from 'vue';
import servicio from '../../services/indicadores';
import { CLAVE_TOKEN } from '../../services/http';

const datos = ref(null);
const error = ref('');
const mes = ref('');
const descargando = ref(false);

function fecha(v) {
  return v ? new Date(v).toLocaleDateString('es-GT') : '';
}

async function cargar() {
  try {
    datos.value = await servicio.consolidado(mes.value);
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

/**
 * La descarga necesita el token en el encabezado, asi que no puede ser un
 * enlace directo: se pide el archivo y se entrega como blob.
 */
async function exportar() {
  descargando.value = true;
  error.value = '';

  try {
    const query = mes.value ? `?mes=${mes.value}` : '';
    const respuesta = await fetch(`/api/v1/indicadores/consolidado/export${query}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(CLAVE_TOKEN)}` },
    });

    if (!respuesta.ok) throw new Error('No se pudo generar el archivo');

    const blob = await respuesta.blob();
    const nombre =
      respuesta.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ??
      'consolidado.xlsx';

    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    URL.revokeObjectURL(url);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    descargando.value = false;
  }
}

onMounted(cargar);
</script>

<template>
  <section v-if="datos" class="space-y-5">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 class="titulo-pagina">Consolidado SIGSA</h1>
      </div>
      <div class="flex items-end gap-2">
        <label>
          <span class="etiqueta-campo">Mes</span>
          <input v-model="mes" type="month" class="campo !py-2.5" @change="cargar" />
        </label>
        <button type="button" :disabled="descargando" class="boton-primario !py-2.5" @click="exportar">
          {{ descargando ? 'Generando...' : 'Exportar XLSX' }}
        </button>
      </div>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <span class="text-slate-700">{{ error }}</span>
    </p>

    <div class="grid gap-4 sm:grid-cols-4">
      <div class="tarjeta border-l-4 border-l-celeste-400 px-5 py-4">
        <p class="text-sm text-slate-500">Atenciones</p>
        <p class="mt-1.5 text-3xl font-semibold leading-none text-mspas-700">{{ datos.resumen.atencionesRegistradas }}</p>
      </div>
      <div class="tarjeta border-l-4 border-l-celeste-400 px-5 py-4">
        <p class="text-sm text-slate-500">Concluidas</p>
        <p class="mt-1.5 text-3xl font-semibold leading-none text-mspas-700">{{ datos.resumen.atendidas }}</p>
      </div>
      <div class="tarjeta border-l-4 border-l-celeste-400 px-5 py-4">
        <p class="text-sm text-slate-500">Urgentes</p>
        <p class="mt-1.5 text-3xl font-semibold leading-none text-mspas-700">{{ datos.resumen.urgentes }}</p>
      </div>
      <div class="tarjeta border-l-4 border-l-celeste-400 px-5 py-4">
        <p class="text-sm text-slate-500">Ausentes</p>
        <p class="mt-1.5 text-3xl font-semibold leading-none text-mspas-700">{{ datos.resumen.ausentes }}</p>
      </div>
    </div>

    <div class="tarjeta p-6">
      <h2 class="mb-4 font-semibold text-mspas-700">Atenciones por grupo de edad</h2>
      <table class="w-full text-left">
        <thead class="text-slate-500">
          <tr>
            <th class="pb-2 font-medium">Grupo</th>
            <th class="pb-2 font-medium">Masculino</th>
            <th class="pb-2 font-medium">Femenino</th>
            <th class="pb-2 font-medium">Total</th>
          </tr>
        </thead>
        <tbody class="lista">
          <tr v-for="g in datos.atencionesPorGrupo" :key="g.grupo">
            <td class="py-2.5">{{ g.grupo }}</td>
            <td class="py-2.5">{{ g.M }}</td>
            <td class="py-2.5">{{ g.F }}</td>
            <td class="py-2.5 font-medium">{{ g.total }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="grid gap-5 lg:grid-cols-2">
      <div class="tarjeta p-6">
        <h2 class="mb-4 font-semibold text-mspas-700">Diagnósticos CIE-10</h2>
        <p v-if="datos.diagnosticos.length === 0" class="text-slate-500">
          Sin diagnósticos registrados en el mes.
        </p>
        <ul v-else class="lista">
          <li v-for="d in datos.diagnosticos" :key="d.codigo" class="flex justify-between gap-4 py-2.5">
            <span><strong>{{ d.codigo }}</strong> {{ d.descripcion }}</span>
            <span class="text-slate-600">{{ d.veces }}</span>
          </li>
        </ul>
      </div>

      <div class="tarjeta p-6">
        <h2 class="mb-4 font-semibold text-mspas-700">Tiempos de espera por prioridad</h2>
        <ul class="lista">
          <li v-for="t in datos.tiemposEspera" :key="t.gravedad" class="flex justify-between gap-4 py-2.5">
            <span class="capitalize">{{ t.gravedad }}</span>
            <span class="text-slate-600">
              <!-- Sin casos no se muestra un 0 que se leeria como "sin espera" -->
              {{ t.promedioMin === null ? 'sin casos' : `${t.promedioMin} min` }}
              <span class="text-slate-400">({{ t.casos }})</span>
            </span>
          </li>
        </ul>
      </div>
    </div>

    <div class="grid gap-5 lg:grid-cols-2">
      <div class="tarjeta p-6">
        <h2 class="mb-4 font-semibold text-mspas-700">Consumo de insumos</h2>
        <p v-if="datos.consumoInsumos.length === 0" class="text-slate-500">
          Sin consumo registrado en el mes.
        </p>
        <ul v-else class="lista">
          <li v-for="c in datos.consumoInsumos" :key="c.nombreGenerico" class="flex justify-between gap-4 py-2.5">
            <span>{{ c.nombreGenerico }}</span>
            <span class="text-slate-600">{{ c.consumo }} {{ c.unidadMedida }}</span>
          </li>
        </ul>
      </div>

      <div class="tarjeta p-6">
        <h2 class="mb-4 font-semibold text-mspas-700">Existencias por lote</h2>
        <p v-if="datos.existencias.length === 0" class="text-slate-500">
          Sin existencias registradas.
        </p>
        <ul v-else class="lista">
          <li v-for="(e, i) in datos.existencias" :key="i" class="flex justify-between gap-4 py-2.5">
            <span>{{ e.nombreGenerico }} <span class="text-slate-500">lote {{ e.numeroLote }}</span></span>
            <span class="text-slate-600">{{ e.cantidadActual }} &middot; vence {{ fecha(e.fechaVence) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>

  <section v-else>
    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <span class="text-slate-700">{{ error }}</span>
    </p>
    <p v-else class="text-slate-500">Cargando consolidado...</p>
  </section>
</template>
