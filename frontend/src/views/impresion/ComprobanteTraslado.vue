<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import { fecha } from '../../dominio/bodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion, renglonesEnBlanco } from '../../dominio/impresionBodega';

/** Comprobante de traslado de la bodega a un servicio, con lote por renglón. */
const route = useRoute();
const t = ref(null);
const est = ref(null);
const error = ref('');
const enBlanco = route.params.id === 'blanco';

onMounted(async () => {
  try {
    est.value = await cargarEstablecimiento();
    t.value = enBlanco
      ? { numero: '', registradoEn: null, ubicacion: { nombre: '' }, entregadoPor: '', recibidoPor: '', observacion: '', renglones: renglonesEnBlanco(15) }
      : (await bodega.traslado(route.params.id)).traslado;
    registrarImpresion('comprobante_traslado', enBlanco ? null : t.value.numero, enBlanco);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <HojaImpresion
    :confidencial="false"
    v-if="t"
    titulo="Comprobante de traslado de insumos"
    :establecimiento="est"
    :firmas="[
      { etiqueta: `Entrega: ${t.entregadoPor}` },
      { etiqueta: `Recibe: ${t.recibidoPor}` },
    ]"
    imprimir-al-abrir
  >
    <table class="bloque-impresion mb-3">
      <tbody>
        <tr>
          <th>Número</th><td class="font-bold">{{ t.numero }}</td>
          <th>Fecha</th><td>{{ fecha(t.registradoEn) }}</td>
        </tr>
        <tr>
          <th>De</th><td>Bodega</td>
          <th>A</th><td class="font-bold">{{ t.ubicacion.nombre }}</td>
        </tr>
      </tbody>
    </table>
    <table class="w-full border-collapse text-[11px]">
      <thead>
        <tr class="bg-slate-100">
          <th class="border border-slate-500 px-1 text-left">Código</th>
          <th class="border border-slate-500 px-1 text-left">Insumo</th>
          <th class="border border-slate-500 px-1 text-left">Lote</th>
          <th class="border border-slate-500 px-1 text-left">Vence</th>
          <th class="border border-slate-500 px-1 text-left">Unidad</th>
          <th class="border border-slate-500 px-1 text-right">Cantidad</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in t.renglones" :key="i" class="h-6">
          <td class="border border-slate-500 px-1">{{ r.codigoInterno }}</td>
          <td class="border border-slate-500 px-1">{{ r.insumo }} {{ r.concentracion ?? '' }}</td>
          <td class="border border-slate-500 px-1 font-mono">{{ r.numeroLote }}</td>
          <td class="border border-slate-500 px-1">{{ fecha(r.fechaVence) }}</td>
          <td class="border border-slate-500 px-1">{{ r.unidadEntrega }}</td>
          <td class="border border-slate-500 px-1 text-right font-bold">{{ r.cantidad }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="t.observacion" class="mt-2 text-xs"><strong>Observación:</strong> {{ t.observacion }}</p>
  </HojaImpresion>
  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando el comprobante…</p>
</template>
