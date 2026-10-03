<script setup>
import { registrarImpresion } from '../../dominio/impresionBodega';
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../services/http';
import servicio from '../../services/inventario';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';

/**
 * Tarjeta de control de suministros (kardex).
 *
 * La tarjeta oficial está autorizada por la Contraloría General de Cuentas.
 * Esta es de apoyo y lo dice en el propio documento: sirve para conciliar y
 * para tener la historia a mano, no para sustituir la oficial.
 */
const route = useRoute();

const datos = ref(null);
const establecimiento = ref(null);
const error = ref('');

async function cargar() {
  try {
    const [tarjeta, est] = await Promise.all([
      servicio.tarjetaControl(route.params.id),
      http.get('/admin/establecimiento').catch(() => ({ establecimiento: null })),
    ]);
    datos.value = tarjeta;
    establecimiento.value = est.establecimiento;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function fecha(v) {
  return v ? new Date(v).toLocaleDateString('es-GT') : '';
}

onMounted(() => {
  cargar();
  registrarImpresion('tarjeta_control', `Insumo ${route.params.id}`);
});
</script>

<template>
  <HojaImpresion
    v-if="datos"
    titulo="Tarjeta de control de suministros"
    :establecimiento="establecimiento"
    :firmas="[
      { etiqueta: 'Responsable de farmacia', conNombre: true },
      { etiqueta: 'Visto bueno de la dirección' },
    ]"
    imprimir-al-abrir
  >
    <!-- Identificación del insumo -->
    <section class="bloque-impresion mb-4">
      <table class="w-full border-collapse text-sm">
        <tbody>
          <tr>
            <td class="w-32 border border-slate-400 px-2 py-1 font-semibold">Código</td>
            <td class="border border-slate-400 px-2 py-1">{{ datos.insumo.codigoInterno }}</td>
            <td class="w-32 border border-slate-400 px-2 py-1 font-semibold">Presentación</td>
            <td class="border border-slate-400 px-2 py-1">{{ datos.insumo.presentacion }}</td>
          </tr>
          <tr>
            <td class="border border-slate-400 px-2 py-1 font-semibold">Nombre genérico</td>
            <td class="border border-slate-400 px-2 py-1">{{ datos.insumo.nombreGenerico }}</td>
            <td class="border border-slate-400 px-2 py-1 font-semibold">Unidad de entrega</td>
            <td class="border border-slate-400 px-2 py-1">{{ datos.insumo.unidadEntrega }}</td>
          </tr>
          <tr>
            <td class="border border-slate-400 px-2 py-1 font-semibold">Forma farmacéutica</td>
            <td class="border border-slate-400 px-2 py-1">
              {{ datos.insumo.formaFarmaceutica ?? '—' }}
            </td>
            <td class="border border-slate-400 px-2 py-1 font-semibold">Concentración</td>
            <td class="border border-slate-400 px-2 py-1">{{ datos.insumo.concentracion ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Movimientos -->
    <section>
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr class="bg-slate-100">
            <th class="border border-slate-400 px-1.5 py-1 text-left">Fecha</th>
            <th class="border border-slate-400 px-1.5 py-1 text-left">Concepto</th>
            <th class="border border-slate-400 px-1.5 py-1 text-left">Lote</th>
            <th class="border border-slate-400 px-1.5 py-1 text-left">Paciente / servicio</th>
            <th class="border border-slate-400 px-1.5 py-1 text-right">Entrada</th>
            <th class="border border-slate-400 px-1.5 py-1 text-right">Salida</th>
            <th class="border border-slate-400 px-1.5 py-1 text-right">Saldo</th>
            <th class="border border-slate-400 px-1.5 py-1 text-left">Responsable</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in datos.movimientos" :key="m.id">
            <td class="border border-slate-400 px-1.5 py-1">{{ fecha(m.fecha) }}</td>
            <td class="border border-slate-400 px-1.5 py-1">{{ m.etiqueta }}</td>
            <td class="border border-slate-400 px-1.5 py-1">{{ m.numeroLote }}</td>
            <td class="border border-slate-400 px-1.5 py-1">
              {{ m.paciente ? `${m.paciente.nombreCompleto} (${m.paciente.expediente})` : (m.servicio ?? '—') }}
            </td>
            <td class="border border-slate-400 px-1.5 py-1 text-right tabular-nums">
              {{ m.entrada ?? '' }}
            </td>
            <td class="border border-slate-400 px-1.5 py-1 text-right tabular-nums">
              {{ m.salida ?? '' }}
            </td>
            <td class="border border-slate-400 px-1.5 py-1 text-right font-semibold tabular-nums">
              {{ m.saldoInsumo }}
            </td>
            <td class="border border-slate-400 px-1.5 py-1">{{ m.usuario }}</td>
          </tr>
          <tr v-if="datos.movimientos.length === 0">
            <td colspan="8" class="border border-slate-400 px-2 py-3 text-center">
              Sin movimientos registrados.
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="bg-slate-100">
            <td colspan="6" class="border border-slate-400 px-1.5 py-1 text-right font-semibold">
              Saldo final
            </td>
            <td class="border border-slate-400 px-1.5 py-1 text-right font-bold tabular-nums">
              {{ datos.saldoFinal }}
            </td>
            <td class="border border-slate-400" />
          </tr>
        </tfoot>
      </table>
    </section>

    <!-- La tarjeta oficial es la de Contraloría -->
    <p class="bloque-impresion mt-4 border border-slate-400 px-3 py-2 text-xs">
      <strong>Documento de apoyo.</strong> La tarjeta de control de suministros oficial es la
      autorizada por la Contraloría General de Cuentas. Esta impresión reproduce los movimientos
      registrados en el sistema y sirve para conciliarla, no para sustituirla.
    </p>
  </HojaImpresion>

  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando la tarjeta de control...</p>
</template>
