<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import EstanteCategoria from '../../components/bodega/diseno/EstanteCategoria.vue';
import ReglaCobertura from '../../components/bodega/diseno/ReglaCobertura.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import { CATEGORIA, estiloCategoria, situacion, miles, decimal, general } from '../../components/bodega/diseno/PiezasBodega';
import { periodoActual, periodoPrevio } from '../../dominio/bodega';
import SelectorMes from '../../components/bodega/SelectorMes.vue';

/**
 * Existencias de la bodega con las cifras del balance: lo que hay, para
 * cuántos meses alcanza y cuánto pedir. A la derecha, el insumo elegido.
 */
const router = useRouter();
// Abre en el último mes cerrado, que es el que coincide con el BRES.
const periodo = ref(periodoPrevio(periodoActual()));
const balance = ref(null);
const semaforo = ref(null);
const error = ref('');

const vista = ref('insumo');
const filtro = ref('todos');
const buscar = ref('');
const categoriaFiltro = ref('');
const orden = ref('alfabetico');
const elegidoId = ref(null);
const servicioId = ref(null);

async function cargar() {
  error.value = '';
  try {
    const [b, s] = await Promise.all([bodega.balance({ periodo: periodo.value }), semaforo.value ? null : bodega.semaforo({})]);
    balance.value = b;
    if (s) semaforo.value = s;
    servicioId.value ??= b.servicios[0]?.id ?? null;
  } catch (fallo) {
    error.value = fallo.message;
  }
}
onMounted(cargar);
watch(periodo, cargar);

const minimo = computed(() => balance.value?.configuracion.nivelMinimoMeses ?? 2);
const maximo = computed(() => balance.value?.configuracion.nivelMaximoMeses ?? 4);
const lotesDe = computed(() => new Map((semaforo.value?.filas ?? []).map((f) => [f.insumoId, f.lotes])));

const todas = computed(() => (balance.value?.filas ?? []).map((f) => ({ ...f, situacion: situacion(f.bres) })));

const resumen = computed(() => ({
  pedir: todas.value.filter((f) => f.bres.M > 0).length,
  bajo: todas.value.filter((f) => f.situacion === 'bajo').length,
  agotados: todas.value.filter((f) => f.bres.I === 0 && f.bres.J > 0).length,
  vencen: (semaforo.value?.resumen.rojo ?? 0) + (semaforo.value?.resumen.vencido ?? 0),
}));

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const COMPARAR = {
  alfabetico: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
  cobertura: (a, b) => (a.bres.K ?? Infinity) - (b.bres.K ?? Infinity) || a.nombre.localeCompare(b.nombre, 'es'),
  pedido: (a, b) => b.bres.M - a.bres.M || a.nombre.localeCompare(b.nombre, 'es'),
};

const visibles = computed(() => {
  const clave = sinTildes(buscar.value.trim());
  return todas.value
    .filter((f) => filtro.value !== 'pedir' || f.bres.M > 0)
    .filter((f) => filtro.value !== 'bajo' || f.situacion === 'bajo')
    .filter((f) => filtro.value !== 'agotados' || (f.bres.I === 0 && f.bres.J > 0))
    .filter((f) => !categoriaFiltro.value || f.categoria === categoriaFiltro.value)
    .filter((f) => !clave || sinTildes(`${f.nombre} ${f.codigoInterno}`).includes(clave))
    .sort(COMPARAR[orden.value]);
});

watch(visibles, (lista) => {
  if (!lista.some((f) => f.insumoId === elegidoId.value)) elegidoId.value = lista[0]?.insumoId ?? null;
}, { immediate: true });

const elegido = computed(() => todas.value.find((f) => f.insumoId === elegidoId.value) ?? null);
const lotesElegido = computed(() => lotesDe.value.get(elegidoId.value) ?? []);
const enCuarentena = computed(() => lotesElegido.value.filter((l) => l.estado === 'cuarentena').reduce((s, l) => s + l.cantidad, 0));

function alternar(f) {
  filtro.value = filtro.value === f ? 'todos' : f;
}

function cifraMeses(f) {
  if (f.bres.I === 0 && f.bres.H === 0) return '0';
  return decimal(f.bres.K);
}
const PIE = { bajo: 'bajo mín.', agotado: 'agotado', sin_consumo: 'sin consumo', bien: 'meses' };

// --- Por servicio ---------------------------------------------------------------
const servicio = computed(() => balance.value?.servicios.find((s) => s.id === servicioId.value) ?? null);
const filasServicio = computed(() => {
  if (!servicio.value) return [];
  const clave = sinTildes(buscar.value.trim());
  return todas.value
    .map((f) => ({ f, s: f.servicios.find((c) => c.ubicacionId === servicioId.value) }))
    .filter(({ s }) => s && (s.saldoSiguiente || s.promedio || s.entregado || s.entradas))
    .filter(({ f }) => !categoriaFiltro.value || f.categoria === categoriaFiltro.value)
    .filter(({ f }) => !clave || sinTildes(`${f.nombre} ${f.codigoInterno}`).includes(clave))
    .map(({ f, s }) => {
      const meses = s.promedio > 0 ? s.saldoSiguiente / s.promedio : null;
      let tono = 'bien';
      if (s.saldoSiguiente <= 0) tono = 'agotado';
      else if (!s.promedio) tono = 'sin_consumo';
      else if (meses < minimo.value) tono = 'bajo';
      return { f, s, meses, tono };
    })
    .sort((a, b) => a.f.nombre.localeCompare(b.f.nombre, 'es'));
});
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">Existencias</h1>
        <SelectorMes v-model="periodo" etiqueta="Mes de las existencias" />
      </div>
      <div class="b-acciones">
        <div class="b-segmentado" role="radiogroup" aria-label="Vista">
          <button v-for="v in [['insumo', 'Por insumo'], ['servicio', 'Por servicio']]" :key="v[0]" type="button" role="radio" :aria-checked="vista === v[0]" :class="vista === v[0] ? 'on' : ''" @click="vista = v[0]">{{ v[1] }}</button>
        </div>
        <RouterLink to="/inventario/nuevo" class="b-btn secundario"><Icono nombre="agregar" :tamano="20" /> Nuevo insumo</RouterLink>
        <RouterLink to="/inventario/requisiciones" class="b-btn primario"><Icono nombre="trasladar" :tamano="20" :grosor="2.2" /> Requisición</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <template v-if="balance">
      <!-- Cifras que filtran -->
      <div class="b-franja mt-5">
        <button type="button" class="b-cifra" :class="filtro === 'pedir' ? 'on' : ''" @click="alternar('pedir')">
          <span class="n text-[#C2410C]">{{ resumen.pedir }}</span><span class="e">Por pedir</span>
        </button>
        <button type="button" class="b-cifra" :class="filtro === 'bajo' ? 'on' : ''" @click="alternar('bajo')">
          <span class="n text-[#B7710A]">{{ resumen.bajo }}</span><span class="e">Bajo mínimo</span>
        </button>
        <button type="button" class="b-cifra" :class="filtro === 'agotados' ? 'on' : ''" @click="alternar('agotados')">
          <span class="n text-[#C03535]">{{ resumen.agotados }}</span><span class="e">Agotados</span>
        </button>
        <RouterLink to="/inventario/semaforo" class="b-cifra hover:bg-[#F8FAFC]">
          <span class="n text-[#B4234A]">{{ resumen.vencen }}</span><span class="e">Lotes por vencer</span>
        </RouterLink>
      </div>

      <!-- Búsqueda y categorías -->
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <label class="b-buscar w-full sm:w-[230px]">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" class="b-campo" placeholder="Buscar insumo" aria-label="Buscar insumo" />
        </label>
        <button
          v-for="(c, clave) in CATEGORIA"
          :key="clave"
          type="button"
          class="b-ficha-cat"
          :class="categoriaFiltro === clave ? 'on' : ''"
          :style="estiloCategoria(clave)"
          :title="c.nombre"
          @click="categoriaFiltro = categoriaFiltro === clave ? '' : clave"
        >
          <span class="ic"><Pictograma :categoria="clave" :grosor="2" /></span>
          {{ c.corto }}
        </button>
      </div>

      <!-- Por insumo -->
      <div v-if="vista === 'insumo'" class="paneles mt-4">
        <div class="min-w-0">
        <div class="mb-2 flex items-center justify-between gap-3">
          <span class="text-sm font-bold text-apagado">{{ visibles.length }} insumos</span>
          <div class="b-segmentado" role="radiogroup" aria-label="Orden">
            <button v-for="o in [['alfabetico', 'A – Z'], ['cobertura', 'Menos meses'], ['pedido', 'Mayor pedido']]" :key="o[0]" type="button" role="radio" :aria-checked="orden === o[0]" :class="orden === o[0] ? 'on' : ''" @click="orden = o[0]">{{ o[1] }}</button>
          </div>
        </div>
        <ul class="lista" aria-label="Insumos">
          <li v-for="f in visibles" :key="f.insumoId">
            <button
              type="button"
              class="b-fila"
              :class="elegidoId === f.insumoId ? 'sel' : ''"
              :style="estiloCategoria(f.categoria)"
              @click="elegidoId = f.insumoId"
              @dblclick="router.push(`/inventario/${f.insumoId}`)"
            >
              <span class="b-lomo" :title="CATEGORIA[f.categoria]?.nombre"><Pictograma :categoria="f.categoria" /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-bold text-tinta">{{ f.nombre }}</span>
                <span class="mt-1 flex items-center gap-3 text-[13px] text-apagado">
                  <span class="shrink-0 whitespace-nowrap font-mono">{{ f.codigoInterno }}</span>
                  <span class="w-[118px] shrink-0 whitespace-nowrap tabular-nums"><b class="text-tinta-2">{{ miles(f.bres.I) }}</b> en bodega</span>
                  <ReglaCobertura class="hidden sm:block" :meses="f.bres.K" :minimo="minimo" :maximo="maximo" :tono="f.situacion" />
                </span>
              </span>
              <span class="meses" :class="f.situacion">
                <b>{{ cifraMeses(f) }}</b>
                <small>{{ PIE[f.situacion] }}</small>
              </span>
              <span class="hueco-pedido">
                <span v-if="f.bres.M > 0" class="b-pedido"><span class="t">Pedir</span><span class="v">{{ miles(f.bres.M) }}</span></span>
              </span>
            </button>
          </li>
          <li v-if="!visibles.length" class="b-vacio">Ningún insumo coincide.</li>
        </ul>
        </div>

        <!-- Insumo elegido -->
        <aside v-if="elegido" class="detalle" :style="estiloCategoria(elegido.categoria)" aria-live="polite">
          <div class="detalle-cabeza">
            <EstanteCategoria :categoria="elegido.categoria" />
            <h2 class="mt-3 text-[22px] font-semibold leading-tight text-tinta">{{ elegido.nombre }}</h2>
            <p class="mt-1 font-mono text-sm text-apagado">{{ elegido.codigoInterno }}</p>
          </div>

          <dl class="b-recibo mt-4">
            <div><dt>Saldo del municipio</dt><dd>{{ miles(elegido.bres.H) }}</dd></div>
            <div><dt>En bodega</dt><dd>{{ miles(elegido.bres.I) }}</dd></div>
            <div v-if="enCuarentena"><dt>· en cuarentena</dt><dd>{{ miles(enCuarentena) }}</dd></div>
            <div><dt>Consumo mensual</dt><dd>{{ miles(elegido.bres.J) }}</dd></div>
            <div><dt>Alcanza para</dt><dd>{{ elegido.bres.K === null ? '—' : `${decimal(elegido.bres.K)} meses` }}</dd></div>
            <div><dt>Máximo ({{ maximo }} meses)</dt><dd>{{ general(elegido.bres.L) }}</dd></div>
            <div class="total"><dt>Pedir</dt><dd>{{ elegido.bres.M > 0 ? miles(elegido.bres.M) : '—' }}</dd></div>
          </dl>

          <p class="b-subtitulo mt-5">Lotes</p>
          <ul class="mt-2 space-y-2">
            <li v-for="l in lotesElegido" :key="l.id">
              <RouterLink :to="`/inventario/lotes/${l.id}`" class="b-boleto" :class="l.semaforo === 'sin_fecha' ? 'vacio' : ''">
                <span class="codigo truncate">{{ l.semaforo === 'sin_fecha' ? 'Sin lote' : l.numeroLote }}</span>
                <span class="cant">{{ miles(l.cantidad) }}</span>
                <SelloVence :fecha="l.fechaVence" :semaforo="l.semaforo" />
              </RouterLink>
            </li>
            <li v-if="!lotesElegido.length" class="text-sm font-semibold text-apagado">Sin lotes con existencia.</li>
          </ul>

          <div class="mt-5 grid grid-cols-2 gap-2">
            <RouterLink :to="`/inventario/${elegido.insumoId}`" class="b-btn secundario">Ver ficha</RouterLink>
            <RouterLink :to="`/inventario/recibir?insumo=${elegido.insumoId}`" class="b-btn primario"><Icono nombre="recibir" :tamano="20" :grosor="2" /> Recibir</RouterLink>
          </div>
        </aside>
      </div>

      <!-- Por servicio -->
      <div v-else class="servicios mt-4">
        <nav class="lista-servicios" aria-label="Servicios">
          <button
            v-for="s in balance.servicios"
            :key="s.id"
            type="button"
            class="servicio"
            :class="servicioId === s.id ? 'on' : ''"
            @click="servicioId = s.id"
          >
            <span class="truncate">{{ s.nombre }}</span>
            <span v-if="s.reportado" class="b-estado disponible">Reportó</span>
          </button>
        </nav>
        <div class="min-w-0">
          <div class="b-tabla-marco lista-alta">
            <table class="b-tabla">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th class="n">Saldo</th>
                  <th class="n">Consumo / mes</th>
                  <th>Cobertura</th>
                  <th class="n">Meses</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="x in filasServicio" :key="x.f.insumoId">
                  <td>
                    <span class="flex items-center gap-2.5">
                      <span class="cat-mini" :style="estiloCategoria(x.f.categoria)"><Pictograma :categoria="x.f.categoria" :grosor="2" /></span>
                      <span class="font-semibold text-tinta">{{ x.f.nombre }}</span>
                    </span>
                  </td>
                  <td class="n fuerte" :class="x.s.saldoSiguiente === 0 ? 'cero' : ''">{{ x.s.saldoSiguiente === 0 ? '–' : miles(x.s.saldoSiguiente) }}</td>
                  <td class="n" :class="!x.s.promedio ? 'cero' : ''">{{ x.s.promedio ? miles(x.s.promedio) : '–' }}</td>
                  <td><ReglaCobertura :meses="x.meses" :minimo="minimo" :maximo="maximo" :tono="x.tono" :ancho="120" /></td>
                  <td class="n meses-tabla" :class="x.tono">{{ x.tono === 'agotado' ? '0' : x.meses === null ? '—' : decimal(x.meses) }}</td>
                </tr>
                <tr v-if="!filasServicio.length"><td colspan="5" class="b-vacio">Este servicio no tiene movimientos registrados.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
    <p v-else-if="!error" class="b-vacio">Cargando existencias…</p>
  </section>
</template>

<style scoped>
.paneles { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .paneles { grid-template-columns: 1fr; } }
.lista { max-height: max(420px, calc(100vh - 400px)); overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 8px; }

.meses { width: 76px; flex-shrink: 0; text-align: right; line-height: 1.1; white-space: nowrap; }
.meses b { display: block; font-size: 20px; font-weight: 700; color: #14244A; font-variant-numeric: tabular-nums; }
.meses small { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #64748B; }
.meses.bajo b, .meses.bajo small { color: #B7710A; }
.meses.agotado b, .meses.agotado small { color: #C03535; }
.meses.sin_consumo b { color: #94A3B8; }
.hueco-pedido { width: 96px; flex-shrink: 0; display: flex; justify-content: flex-end; }

.detalle { position: sticky; top: 16px; border: 2px solid #E2E8F0; border-radius: 16px; padding: 0 18px 18px; background: #fff; overflow: hidden; }
.detalle-cabeza { margin: 0 -18px; padding: 18px; background: var(--cat-fondo); }

.servicios { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 900px) { .servicios { grid-template-columns: 1fr; } }
.lista-servicios { display: flex; flex-direction: column; gap: 4px; max-height: max(420px, calc(100vh - 360px)); overflow-y: auto; padding-right: 4px; }
.servicio { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 0 12px; border-radius: 10px; border: 2px solid transparent; font-weight: 600; font-size: 14px; color: #334155; text-align: left; }
.servicio:hover { background: #F1F5F9; }
.servicio.on { border-color: #172A5A; background: #F1F5FA; color: #172A5A; font-weight: 700; }
.lista-alta { max-height: max(420px, calc(100vh - 360px)); }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 26px; height: 26px; border-radius: 7px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 16px; height: 16px; }
.meses-tabla { font-weight: 700; }
.meses-tabla.bajo { color: #B7710A; }
.meses-tabla.agotado { color: #C03535; }
.meses-tabla.sin_consumo { color: #94A3B8; }
</style>
