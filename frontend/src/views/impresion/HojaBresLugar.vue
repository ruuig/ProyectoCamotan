<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import bodega from '../../services/bodega';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import { nombrePeriodo } from '../../dominio/bodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion } from '../../dominio/impresionBodega';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { useAuthStore } from '../../stores/auth';

/**
 * BRES de un lugar del territorio, o de todo el territorio sumado, en carta
 * horizontal con las columnas del formulario oficial (B a M). Sale de los
 * informes guardados: le sirve al encargado para pasarlo a mano al formulario.
 *
 * ?lugar=<id> un lugar; ?lugar=todos el territorio.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const est = ref(null);
const territorio = ref(null);
const informes = ref([]);
const error = ref('');
const cargando = ref(false);

const periodo = computed(() => route.params.periodo);
const lugar = computed(() => route.query.lugar ?? 'todos');
const lugares = computed(() => territorio.value?.ubicaciones ?? []);
const elegidos = computed(() => (lugar.value === 'todos' ? lugares.value : lugares.value.filter((l) => String(l.id) === String(lugar.value))));
const servicio = computed(() => (lugar.value === 'todos'
  ? `Territorio ${territorio.value?.numero ?? ''}${territorio.value?.encargado ? ` · ${territorio.value.encargado}` : ''} (${lugares.value.length} lugares)`
  : elegidos.value[0]?.nombre ?? ''));
const niveles = computed(() => informes.value[0]?.niveles ?? { minimo: '', maximo: '' });

// Carta horizontal, como el BRES en hoja blanca.
const estiloPagina = document.createElement('style');
estiloPagina.textContent = '@media print { @page { size: letter landscape; margin: 0; } }';
document.head.appendChild(estiloPagina);
onBeforeUnmount(() => estiloPagina.remove());

async function cargar() {
  if (!elegidos.value.length) return;
  cargando.value = true;
  error.value = '';
  try {
    informes.value = await Promise.all(elegidos.value.map((l) => bodega.informe(l.id, periodo.value)));
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

onMounted(async () => {
  try {
    const [e, t] = await Promise.all([cargarEstablecimiento(), bodega.territorios()]);
    est.value = e;
    territorio.value = t.territorios[0] ?? null;
    if (!territorio.value) error.value = 'Su puesto no tiene territorio asignado.';
    await cargar();
    registrarImpresion('bres', `${servicio.value}, período ${periodo.value}`);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
watch(lugar, cargar);

function elegir(valor) {
  router.replace({ query: { ...route.query, lugar: valor } });
}

// Cada producto con lo de cada lugar sumado, en el orden del balance.
const filas = computed(() => {
  const porInsumo = new Map();
  for (const inf of informes.value) {
    for (const r of inf.renglones) {
      let f = porInsumo.get(r.insumoId);
      if (!f) {
        f = { insumoId: r.insumoId, nombre: [r.nombre, r.concentracion].filter(Boolean).join(' '), unidad: r.unidadEntrega, seccion: r.seccion, B: 0, C: 0, D: 0, E: 0, J: 0 };
        porInsumo.set(r.insumoId, f);
      }
      const d = r.entregado ?? 0;
      const e = r.noEntregado ?? 0;
      f.B += r.saldoAnterior ?? 0;
      f.C += r.entradas ?? 0;
      f.D += d;
      f.E += e;
      // Promedio como el BRES: el mes y los dos anteriores con informe.
      f.J += Math.round(((r.demandaAnterior ?? 0) + d + e) / ((r.mesesAnteriores ?? 0) + 1));
    }
  }
  const maximo = Number(niveles.value.maximo) || 0;
  return [...porInsumo.values()].map((f) => {
    const H = f.B + f.C - f.D;
    const L = f.J * maximo;
    return { ...f, F: f.D + f.E, H, K: f.J ? (H / f.J).toFixed(1) : 'sin consumo', L, M: Math.max(0, L - H) };
  });
});
const conTitulo = (i) => i === 0 || filas.value[i - 1].seccion !== filas.value[i].seccion;

const firmas = computed(() => [
  { etiqueta: `Encargado${auth.usuario?.nombre ? `: ${auth.usuario.nombre}` : ''}` },
  { etiqueta: 'Recibido en bodega' },
]);
</script>

<template>
  <div class="no-imprimir mx-auto flex max-w-[11in] flex-wrap items-center gap-2 p-4 text-sm">
    <span class="font-bold">BRES de:</span>
    <button type="button" class="rounded border px-3 py-1.5" :class="lugar === 'todos' ? 'border-black bg-black text-white' : ''" @click="elegir('todos')">Todo el territorio</button>
    <button
      v-for="l in lugares"
      :key="l.id"
      type="button"
      class="rounded border px-3 py-1.5"
      :class="String(lugar) === String(l.id) ? 'border-black bg-black text-white' : ''"
      @click="elegir(l.id)"
    >{{ l.nombre }}</button>
  </div>

  <p v-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else-if="cargando || !informes.length" class="p-8">Preparando el BRES…</p>

  <HojaImpresion
    v-else
    :confidencial="false"
    class="hoja-apaisada"
    titulo="Balance, Requisición y Envío de Suministros (BRES)"
    :establecimiento="est"
    :firmas="firmas"
  >
    <section class="bloque-impresion mb-2 grid grid-cols-4 gap-2 text-sm">
      <p><strong>Municipio:</strong> {{ est?.municipio ?? 'Camotán' }}</p>
      <p><strong>Servicio:</strong> {{ servicio }}</p>
      <p><strong>Mes y año:</strong> {{ nombrePeriodo(periodo) }}</p>
      <p><strong>Niveles:</strong> mínimo {{ niveles.minimo }}, máximo {{ niveles.maximo }} meses</p>
    </section>

    <table class="w-full border-collapse text-[9px]">
      <thead>
        <tr class="bg-slate-100">
          <th class="border border-slate-500 px-1 text-left">Insumo</th>
          <th class="border border-slate-500 px-1 text-left">Unidad</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">B</span>Saldo anterior</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">C</span>Entradas</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">D</span>Entregado a usuarios</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">E</span>No entregado</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">F</span>Demanda</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">G</span>Reajustes</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">H</span>Saldo siguiente</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">I</span>Existencia física</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">J</span>Promedio</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">K</span>Meses de existencia</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">L</span>Máximo</th>
          <th class="border border-slate-500 px-1 text-right"><span class="block">M</span>Cantidad a pedir</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(f, i) in filas" :key="f.insumoId">
          <tr v-if="conTitulo(i)"><td colspan="14" class="border border-slate-500 bg-slate-100 px-1 font-bold">{{ f.seccion }}</td></tr>
          <tr>
            <td class="border border-slate-500 px-1">{{ f.nombre }}</td>
            <td class="border border-slate-500 px-1">{{ f.unidad }}</td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ miles(f.B) }}</td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ miles(f.C) }}</td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ miles(f.D) }}</td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ miles(f.E) }}</td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ miles(f.F) }}</td>
            <td class="border border-slate-500 px-1"></td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ miles(f.H) }}</td>
            <td class="border border-slate-500 px-1"></td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ miles(f.J) }}</td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ f.K }}</td>
            <td class="border border-slate-500 px-1 text-right tabular-nums">{{ miles(f.L) }}</td>
            <td class="border border-slate-500 px-1 text-right font-bold tabular-nums">{{ miles(f.M) }}</td>
          </tr>
        </template>
      </tbody>
    </table>

    <p class="bloque-impresion mt-3 text-[9px]">
      F = D + E · H = B + C − D · J promedio de la demanda del mes y los dos anteriores · K = H ÷ J ·
      L = J × {{ niveles.maximo }} · M = L − H.
    </p>
  </HojaImpresion>
</template>
