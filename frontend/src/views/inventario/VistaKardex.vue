<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/**
 * Kardex de cada producto de la bodega: cada ingreso y cada despacho con su
 * requisición, a dónde fue, la entrada, la salida y la existencia. Se copia
 * a la tarjeta oficial o se imprime encima de ella.
 */
const insumos = ref([]);
const elegido = ref(null);
const periodo = ref(new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 7));
const todo = ref(false);
const tarjeta = ref(null);
const error = ref('');
const cargando = ref(false);

const q = computed(() => (todo.value ? {} : { periodo: periodo.value }));
const enlaceTodos = computed(() => `/imprimir/kardex?${new URLSearchParams(q.value)}`);
const enlaceUno = computed(() => `/imprimir/kardex?${new URLSearchParams({ ...q.value, insumoId: elegido.value?.id ?? '' })}`);
const dinero = (v) => (v == null ? '' : `Q ${Number(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

async function ver() {
  if (!elegido.value) return;
  error.value = '';
  cargando.value = true;
  try {
    const r = await bodega.kardex({ ...q.value, insumoId: elegido.value.id });
    tarjeta.value = r.tarjetas[0] ?? null;
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

function elegir(i) {
  elegido.value = i;
  ver();
}

onMounted(async () => {
  try {
    insumos.value = (await inventario.insumos()).insumos;
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <section>
    <header class="b-cabecera">
      <h1 class="b-titulo">Kardex</h1>
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="periodo" type="month" :disabled="todo" aria-label="Mes" class="b-campo w-[170px]" @change="ver" />
        <label class="flex items-center gap-1.5 text-sm font-semibold"><input v-model="todo" type="checkbox" @change="ver" /> Toda la historia</label>
        <RouterLink :to="enlaceTodos" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Todos los que se movieron</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <div class="mt-5 flex flex-wrap items-end gap-3">
      <div class="min-w-[18rem] flex-1">
        <span class="b-etiqueta">Producto</span>
        <div v-if="elegido" class="elegido">
          <span class="min-w-0 flex-1 truncate font-semibold text-tinta">{{ elegido.nombreGenerico }} <span class="font-normal text-apagado">{{ elegido.concentracion }}</span></span>
          <button type="button" class="quitar" aria-label="Cambiar producto" @click="elegido = null; tarjeta = null"><Icono nombre="cerrar" :tamano="16" /></button>
        </div>
        <BuscadorInsumo v-else :insumos="insumos" placeholder="Buscar producto" @elegir="elegir" />
      </div>
      <RouterLink v-if="tarjeta" :to="enlaceUno" target="_blank" class="b-btn primario"><Icono nombre="imprimir" :tamano="18" /> Imprimir en la tarjeta</RouterLink>
    </div>

    <div v-if="tarjeta" class="mt-4">
      <dl class="resumen">
        <div><dt>Código</dt><dd class="font-mono">{{ tarjeta.insumo.codigoMspas ?? tarjeta.insumo.codigoInterno }}</dd></div>
        <div><dt>Unidad</dt><dd>{{ tarjeta.insumo.unidadEntrega }}</dd></div>
        <div><dt>Saldo anterior</dt><dd>{{ miles(tarjeta.saldoAnterior) }}</dd></div>
        <div><dt>Entradas</dt><dd class="text-[#145C3C]">+{{ miles(tarjeta.entradas) }}</dd></div>
        <div><dt>Salidas</dt><dd class="text-[#B42318]">−{{ miles(tarjeta.salidas) }}</dd></div>
        <div v-if="tarjeta.reajustes"><dt>Reajustes</dt><dd>{{ tarjeta.reajustes > 0 ? '+' : '' }}{{ miles(tarjeta.reajustes) }}</dd></div>
        <div><dt>Existencia</dt><dd class="text-[20px]">{{ miles(tarjeta.saldoFinal) }}</dd></div>
      </dl>
      <div class="b-tabla-marco kardex mt-3">
        <table class="b-tabla">
          <thead>
            <tr>
              <th rowspan="2">Fecha</th><th rowspan="2">No. de referencia</th><th rowspan="2">Remitente / destinatario</th>
              <th colspan="3" class="grupo">Entrada</th>
              <th rowspan="2">Vence</th><th rowspan="2">Lote</th>
              <th rowspan="2" class="n">Salida</th><th rowspan="2" class="n">Reajuste (+/−)</th>
              <th colspan="2" class="grupo">Saldo</th>
              <th rowspan="2">Observaciones</th>
            </tr>
            <tr>
              <th class="n">Cantidad</th><th class="n">Precio u.</th><th class="n">Valor total</th>
              <th class="n">Cantidad</th><th class="n">Precio</th>
            </tr>
          </thead>
          <tbody>
            <tr class="anterior">
              <td colspan="10">Saldo anterior</td><td class="n fuerte">{{ miles(tarjeta.saldoAnterior) }}</td><td /><td />
            </tr>
            <tr v-for="f in tarjeta.filas" :key="f.id">
              <td class="whitespace-nowrap">{{ fecha(f.fecha) }}</td>
              <td class="whitespace-nowrap font-mono font-semibold text-[#172A5A]">{{ f.referencia }}</td>
              <td>{{ f.remitenteDestinatario }}</td>
              <td class="n">{{ f.entrada != null ? miles(f.entrada) : '' }}</td>
              <td class="n">{{ dinero(f.precioUnitario) }}</td>
              <td class="n">{{ dinero(f.valorEntrada) }}</td>
              <td class="whitespace-nowrap">{{ fecha(f.fechaVence) }}</td>
              <td class="whitespace-nowrap font-mono">{{ f.numeroLote }}</td>
              <td class="n">{{ f.salida != null ? miles(f.salida) : '' }}</td>
              <td class="n">{{ f.reajuste != null ? `${f.reajuste > 0 ? '+' : ''}${miles(f.reajuste)}` : '' }}</td>
              <td class="n fuerte">{{ miles(f.saldo) }}</td>
              <td class="n">{{ f.saldo && f.valorSaldo != null ? dinero(f.valorSaldo / f.saldo) : '' }}</td>
              <td class="text-sm">{{ f.observaciones }}</td>
            </tr>
            <tr v-if="!tarjeta.filas.length"><td colspan="13" class="b-vacio">Sin movimientos en {{ todo ? 'la historia' : 'este mes' }}.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <p v-else-if="!cargando" class="b-vacio mt-6">Elija un producto para ver su kardex.</p>
  </section>
</template>

<style scoped>
.elegido { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 6px 0 12px; border: 2px solid #172A5A; border-radius: 10px; background: #EEF2FA; }
.quitar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: #64748B; }
.resumen { display: flex; flex-wrap: wrap; gap: 8px; }
.resumen div { min-width: 120px; padding: 8px 14px; border: 2px solid #E2E8F0; border-radius: 12px; }
.resumen dt { font-size: 12px; font-weight: 700; color: #64748B; text-transform: uppercase; }
.resumen dd { font-weight: 800; color: #14244A; font-variant-numeric: tabular-nums; }
.kardex { max-height: max(360px, calc(100vh - 380px)); }
.grupo { text-align: center; border-bottom: 1px solid #E2E8F0; }
.anterior td { background: #F8FAFC; font-weight: 700; color: #475569; }
</style>
