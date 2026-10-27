<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import { fecha } from '../../dominio/bodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion } from '../../dominio/impresionBodega';

/**
 * La requisición del encargado en hoja normal (no sobre el formulario): le
 * sirve de base para pasarla a mano al formulario de la Contraloría.
 */
const route = useRoute();
const r = ref(null);
const est = ref(null);
const error = ref('');

onMounted(async () => {
  try {
    est.value = await cargarEstablecimiento();
    r.value = (await bodega.requisicion(route.params.id)).requisicion;
    registrarImpresion('requisicion', r.value.numero ?? `id ${r.value.id}`);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <HojaImpresion
    v-if="r"
    :confidencial="false"
    titulo="Requisición a bodega"
    :establecimiento="est"
    :firmas="[
      { etiqueta: `Solicita: ${r.solicitante}` },
      { etiqueta: r.jefe ? `Visto bueno: ${r.jefe}` : 'Visto bueno' },
    ]"
    imprimir-al-abrir
  >
    <table class="bloque-impresion mb-3">
      <tbody>
        <tr>
          <th>Para</th><td class="font-bold">{{ r.unidadSeccion }}</td>
          <th>Fecha</th><td>{{ fecha(r.fechaSolicitud) }}</td>
        </tr>
        <tr v-if="r.numero">
          <th>No. del formulario</th><td colspan="3">{{ r.numero }}</td>
        </tr>
      </tbody>
    </table>
    <table class="w-full border-collapse text-[11px]">
      <thead>
        <tr class="bg-slate-100">
          <th class="w-10 border border-slate-500 px-1 text-right">No.</th>
          <th class="border border-slate-500 px-1 text-left">Descripción del artículo</th>
          <th class="border border-slate-500 px-1 text-left">Unidad</th>
          <th class="border border-slate-500 px-1 text-right">Cantidad solicitada</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in r.renglones" :key="g.orden" class="h-6">
          <td class="border border-slate-500 px-1 text-right">{{ g.orden }}</td>
          <td class="border border-slate-500 px-1">{{ g.descripcion }}</td>
          <td class="border border-slate-500 px-1">{{ g.unidadMedida }}</td>
          <td class="border border-slate-500 px-1 text-right font-bold">{{ g.cantidadSolicitada }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="r.observaciones" class="mt-2 text-xs"><strong>Observaciones:</strong> {{ r.observaciones }}</p>
  </HojaImpresion>
  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando la requisición…</p>
</template>
