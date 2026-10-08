<script setup>
import { ref, computed } from 'vue';
import Pictograma from './diseno/Pictograma.vue';
import { estiloCategoria, miles, general } from './diseno/PiezasBodega';

/**
 * Detalle del BRES por lugar: la bodega, post-consulta y cada servicio, con
 * su saldo anterior, entradas, entregado y saldo. Es lo que antes era el
 * balance del centro en Excel.
 */
const props = defineProps({
  balance: { type: Object, required: true }, // respuesta de /bodega/balance
  filtro: { type: Function, default: () => true }, // (fila) => boolean
});

const lugarId = ref('bodega');
const lugares = computed(() => [
  { id: 'bodega', nombre: 'Bodega', reportado: true },
  { id: 'post', nombre: 'Post-consulta', reportado: true },
  ...props.balance.servicios,
]);
const lugar = computed(() => lugares.value.find((l) => l.id === lugarId.value));

const filas = computed(() => props.balance.filas.filter(props.filtro).map((f) => {
  if (lugarId.value === 'bodega') {
    const b = f.bodega;
    return { f, saldoAnterior: b.saldoAnterior, entradas: b.entradas, entregado: b.trasladado, noEntregado: 0, ajuste: b.reajustes, saldo: b.saldoSiguiente };
  }
  if (lugarId.value === 'post') {
    const p = f.postConsulta;
    return { f, saldoAnterior: p.saldoAnterior, entradas: p.entradas, entregado: p.entregado, noEntregado: p.noEntregado, ajuste: 0, saldo: p.saldoSiguiente, promedio: p.promedio };
  }
  const s = f.servicios.find((x) => x.ubicacionId === lugarId.value);
  return s ? { f, saldoAnterior: s.saldoAnterior, entradas: s.entradas, entregado: s.entregado, noEntregado: s.noEntregado, ajuste: 0, saldo: s.saldoSiguiente, promedio: s.promedio, diferencia: s.diferenciaSaldo } : null;
}).filter((x) => x && (x.saldoAnterior || x.entradas || x.entregado || x.noEntregado || x.saldo || x.promedio)));

const n = (v) => (v === null || v === undefined ? '' : v ? miles(v) : '–');
const esBodega = computed(() => lugarId.value === 'bodega');
const conAjustes = computed(() => esBodega.value && filas.value.some((x) => x.ajuste));
</script>

<template>
  <div class="por-servicio">
    <nav class="lugares" aria-label="Lugares">
      <button
        v-for="l in lugares"
        :key="l.id"
        type="button"
        class="lugar"
        :class="[lugarId === l.id ? 'on' : '', typeof l.id === 'string' ? 'propio' : '']"
        @click="lugarId = l.id"
      >
        <span class="truncate">{{ l.nombre }}</span>
        <span v-if="!l.reportado" class="b-estado cuarentena">Sin reporte</span>
      </button>
    </nav>
    <div class="b-tabla-marco alta min-w-0">
      <table class="b-tabla">
        <thead>
          <tr>
            <th>Insumo</th>
            <th class="n">Saldo anterior</th>
            <th class="n">Entradas</th>
            <th class="n">{{ esBodega ? 'Trasladado' : 'Entregado' }}</th>
            <th v-if="!esBodega" class="n">No entregado</th>
            <th v-if="conAjustes" class="n">Reajustes</th>
            <th class="n">Saldo</th>
            <th v-if="!esBodega" class="n">Promedio</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in filas" :key="x.f.insumoId">
            <td>
              <span class="flex items-center gap-2.5" :style="estiloCategoria(x.f.categoria)">
                <span class="cat-mini"><Pictograma :categoria="x.f.categoria" :grosor="2" /></span>
                <span class="font-semibold text-tinta">{{ x.f.nombre }}</span>
              </span>
            </td>
            <td class="n" :class="!x.saldoAnterior ? 'cero' : ''">{{ n(x.saldoAnterior) }}</td>
            <td class="n" :class="!x.entradas ? 'cero' : ''">{{ n(x.entradas) }}</td>
            <td class="n" :class="!x.entregado ? 'cero' : ''">{{ n(x.entregado) }}</td>
            <td v-if="!esBodega" class="n" :class="!x.noEntregado ? 'cero' : ''">{{ n(x.noEntregado) }}</td>
            <td v-if="conAjustes" class="n" :class="!x.ajuste ? 'cero' : ''">{{ n(x.ajuste) }}</td>
            <td class="n fuerte">
              {{ n(x.saldo) }}
              <span v-if="x.diferencia" class="block text-[11px] font-bold text-[#B7710A]">reportó {{ x.diferencia > 0 ? '+' : '' }}{{ miles(x.diferencia) }}</span>
            </td>
            <td v-if="!esBodega" class="n" :class="!x.promedio ? 'cero' : ''">{{ x.promedio ? general(x.promedio) : "–" }}</td>
          </tr>
          <tr v-if="!filas.length"><td colspan="7" class="b-vacio">{{ lugar?.nombre }} no tiene movimientos este mes.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.por-servicio { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 900px) { .por-servicio { grid-template-columns: 1fr; } }
.alta { max-height: max(380px, calc(100vh - 500px)); }
.lugares { display: flex; flex-direction: column; gap: 3px; max-height: max(380px, calc(100vh - 500px)); overflow-y: auto; padding-right: 4px; }
.lugar { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 42px; padding: 0 12px; border-radius: 10px; border: 2px solid transparent; font-weight: 600; font-size: 14px; color: #334155; text-align: left; }
.lugar:hover { background: #F1F5F9; }
.lugar.on { border-color: #172A5A; background: #F1F5FA; color: #172A5A; font-weight: 700; }
.lugar.propio { color: #14244A; font-weight: 700; }
.lugar.propio + .lugar:not(.propio) { margin-top: 8px; }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; border-radius: 7px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 15px; height: 15px; }
</style>
