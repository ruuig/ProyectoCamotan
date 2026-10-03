<script setup>
import { registrarImpresion } from '../../dominio/impresionBodega';
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../services/http';
import servicio from '../../services/inventario';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';

/**
 * Oficio de baja.
 *
 * El procedimiento del MSPAS pide un oficio con cantidad, lote, número de
 * tarjeta de control, precio y vencimiento para iniciar la baja con auditoría.
 * El sistema lo genera precargado con lo que ya sabe, y lo que no sabe lo
 * deja en blanco para llenarse a mano en vez de inventarlo.
 *
 * PENDIENTE DE CONFIRMAR: el formato exacto del oficio con el centro de salud.
 */
const route = useRoute();

const oficio = ref(null);
const establecimiento = ref(null);
const error = ref('');

async function cargar() {
  try {
    const [o, est] = await Promise.all([
      servicio.oficioBaja(route.params.id),
      http.get('/admin/establecimiento').catch(() => ({ establecimiento: null })),
    ]);
    oficio.value = o.oficio;
    establecimiento.value = est.establecimiento;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const hoy = computed(() =>
  new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(),
  ),
);

function fecha(v) {
  return v ? new Date(v).toLocaleDateString('es-GT') : '';
}

function quetzales(v) {
  return v === null || v === undefined ? '' : `Q ${Number(v).toFixed(2)}`;
}

onMounted(() => {
  cargar();
  registrarImpresion('oficio_baja', `Oficio ${route.params.id}`);
});
</script>

<template>
  <HojaImpresion
    v-if="oficio"
    :titulo="`Oficio de baja de inventario ${oficio.correlativo}`"
    :establecimiento="establecimiento"
    :firmas="[
      { etiqueta: 'Solicita (encargado de farmacia)', conNombre: true },
      { etiqueta: 'Autoriza (dirección del establecimiento)' },
    ]"
    imprimir-al-abrir
  >
    <section class="bloque-impresion mb-4 text-sm">
      <p class="text-right">
        {{ establecimiento?.municipio ?? '____________' }},
        {{ hoy }}
      </p>
    </section>

    <section class="bloque-impresion mb-4 text-sm">
      <p class="mb-3">
        Por este medio se solicita autorizar la baja del inventario del producto que se detalla,
        por encontrarse
        <strong>{{ oficio.causa === 'producto_vencido' ? 'vencido' : 'dañado' }}</strong>,
        conforme al procedimiento de almacenamiento de medicamentos y productos afines del
        Ministerio de Salud Pública y Asistencia Social.
      </p>
    </section>

    <section class="mb-4">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-slate-100">
            <th class="border border-slate-400 px-2 py-1 text-left">Descripción</th>
            <th class="border border-slate-400 px-2 py-1 text-left">Lote</th>
            <th class="border border-slate-400 px-2 py-1 text-left">Vence</th>
            <th class="border border-slate-400 px-2 py-1 text-left">Tarjeta</th>
            <th class="border border-slate-400 px-2 py-1 text-right">Cantidad</th>
            <th class="border border-slate-400 px-2 py-1 text-right">Precio unitario</th>
            <th class="border border-slate-400 px-2 py-1 text-right">Valor total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="border border-slate-400 px-2 py-1">
              {{ [oficio.lote.insumo.nombreGenerico, oficio.lote.insumo.formaFarmaceutica, oficio.lote.insumo.concentracion].filter(Boolean).join(' ') }}
              <span class="block text-xs">{{ oficio.lote.insumo.presentacion }}</span>
            </td>
            <td class="border border-slate-400 px-2 py-1">{{ oficio.lote.numeroLote }}</td>
            <td class="border border-slate-400 px-2 py-1">{{ fecha(oficio.lote.fechaVence) }}</td>
            <!-- Lo que el sistema no sabe se deja en blanco, no se inventa -->
            <td class="border border-slate-400 px-2 py-1">
              {{ oficio.numeroTarjeta || '________' }}
            </td>
            <td class="border border-slate-400 px-2 py-1 text-right tabular-nums">
              {{ oficio.cantidad }} {{ oficio.lote.insumo.unidadEntrega }}
            </td>
            <td class="border border-slate-400 px-2 py-1 text-right tabular-nums">
              {{ quetzales(oficio.precioUnitario) || '________' }}
            </td>
            <td class="border border-slate-400 px-2 py-1 text-right font-semibold tabular-nums">
              {{ quetzales(oficio.valorTotal) || '________' }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="bloque-impresion mb-4 text-sm">
      <p class="font-semibold">Motivo</p>
      <p class="mt-1 border border-slate-400 px-3 py-2">{{ oficio.detalle }}</p>
    </section>

    <section class="bloque-impresion text-sm">
      <table class="w-full border-collapse">
        <tbody>
          <tr>
            <td class="w-40 border border-slate-400 px-2 py-1 font-semibold">Solicitado por</td>
            <td class="border border-slate-400 px-2 py-1">
              {{ oficio.solicitante.nombre }} &middot; {{ fecha(oficio.solicitadoEn) }}
            </td>
          </tr>
          <tr>
            <td class="border border-slate-400 px-2 py-1 font-semibold">Autorizado por</td>
            <td class="border border-slate-400 px-2 py-1">
              {{ oficio.autorizador?.nombre ?? '____________________' }}
              <span v-if="oficio.autorizadoEn"> &middot; {{ fecha(oficio.autorizadoEn) }}</span>
            </td>
          </tr>
          <tr>
            <td class="border border-slate-400 px-2 py-1 font-semibold">Aplicado al inventario</td>
            <td class="border border-slate-400 px-2 py-1">
              {{ oficio.aplicadoEn ? fecha(oficio.aplicadoEn) : 'Pendiente' }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="bloque-impresion mt-4 border border-slate-400 px-3 py-2 text-xs">
      El producto descrito queda separado como no conforme y no debe entregarse. La baja se hace
      efectiva con la autorización correspondiente y queda sujeta a la auditoría del Ministerio.
    </p>
  </HojaImpresion>

  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando el oficio...</p>
</template>
