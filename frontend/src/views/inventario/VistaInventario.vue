<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import EstanteCategoria from '../../components/bodega/diseno/EstanteCategoria.vue';
import ReglaCobertura from '../../components/bodega/diseno/ReglaCobertura.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import { CATEGORIA, categoriaVisual, estiloCategoria, estiloTono, situacion, miles, decimal } from '../../components/bodega/diseno/PiezasBodega';
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
// Por categoría es como está el estante; por situación es lo que hay que atender.
const agrupar = ref('categoria');
const plegados = ref(new Set());
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
  agotados: todas.value.filter((f) => f.situacion === 'agotado').length,
  vencen: (semaforo.value?.resumen.rojo ?? 0) + (semaforo.value?.resumen.vencido ?? 0),
}));

// Cada cifra con su tono: celeste es una acción, ámbar pide atención y rojo
// es crítico. El número va en tinta; el color solo marca el ícono y el borde.
const CIFRAS = [
  { clave: 'pedir', etiqueta: 'Por pedir', icono: 'trasladar', tono: 'accion', ayuda: 'Insumos con cantidad a pedir en el BRES' },
  { clave: 'bajo', etiqueta: 'Bajo mínimo', icono: 'alerta', tono: 'atencion', ayuda: 'El municipio tiene menos meses que el nivel mínimo' },
  { clave: 'agotados', etiqueta: 'Agotados', icono: 'inventario', tono: 'critico', ayuda: 'La bodega está en cero y el insumo se consume' },
];

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
    .filter((f) => filtro.value !== 'agotados' || f.situacion === 'agotado')
    .filter((f) => !categoriaFiltro.value || f.categoria === categoriaFiltro.value)
    .filter((f) => !clave || sinTildes(`${f.nombre} ${f.codigoInterno}`).includes(clave))
    .sort(COMPARAR[orden.value]);
});


const elegido = computed(() => todas.value.find((f) => f.insumoId === elegidoId.value) ?? null);
const lotesElegido = computed(() => lotesDe.value.get(elegidoId.value) ?? []);
const enCuarentena = computed(() => lotesElegido.value.filter((l) => l.estado === 'cuarentena').reduce((s, l) => s + l.cantidad, 0));

function alternar(f) {
  filtro.value = filtro.value === f ? 'todos' : f;
}

// Grupos de la lista. Situación va de lo más urgente a lo que no pide nada.
const SITUACIONES = [
  { clave: 'agotado', nombre: 'Agotados en bodega', porque: 'Se consumen y la bodega está en cero', tono: 'critico' },
  { clave: 'bajo', nombre: 'Bajo el mínimo', porque: 'Alcanzan para menos meses que el nivel mínimo', tono: 'atencion' },
  { clave: 'bien', nombre: 'Abastecidos', porque: 'Alcanzan al menos hasta el nivel mínimo', tono: 'bien' },
  { clave: 'sin_consumo', nombre: 'Sin consumo registrado', porque: 'Sin demanda en el promedio del BRES', tono: 'neutro' },
];

const grupos = computed(() => {
  const claves = agrupar.value === 'categoria'
    ? [...Object.keys(CATEGORIA), ...new Set(visibles.value.map((f) => f.categoria).filter((c) => !CATEGORIA[c]))]
    : SITUACIONES.map((s) => s.clave);
  return claves
    .map((clave) => {
      const filas = visibles.value.filter((f) => (agrupar.value === 'categoria' ? f.categoria : f.situacion) === clave);
      const sit = SITUACIONES.find((s) => s.clave === clave);
      return {
        clave,
        nombre: sit ? sit.nombre : categoriaVisual(clave).nombre,
        porque: sit?.porque ?? '',
        estilo: sit ? estiloTono(sit.tono) : estiloCategoria(clave),
        categoria: sit ? null : clave,
        filas,
        porPedir: filas.filter((f) => f.bres.M > 0).length,
      };
    })
    .filter((g) => g.filas.length);
});

// Si el elegido deja de verse, se elige el primero que aparece en pantalla
// (el primero del primer grupo, no el primero del abecedario).
watch(grupos, (lista) => {
  if (!lista.some((g) => g.filas.some((f) => f.insumoId === elegidoId.value))) elegidoId.value = lista[0]?.filas[0]?.insumoId ?? null;
}, { immediate: true });

function plegar(clave) {
  const s = new Set(plegados.value);
  if (s.has(clave)) s.delete(clave); else s.add(clave);
  plegados.value = s;
}
watch(agrupar, () => { plegados.value = new Set(); });

// La regla mide lo que alcanza el municipio (K). Si solo la bodega está en
// cero, la etiqueta "Agotado" ya lo dice y la regla sigue mostrando los meses.
function tonoRegla(f) {
  if (f.situacion !== 'agotado') return f.situacion;
  if (!f.bres.K) return 'agotado';
  return f.bres.bajoMinimo ? 'bajo' : 'bien';
}

// Enteros con separador de miles; con decimales, hasta dos cifras.
const cantidad = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

const ESTADO = {
  agotado: { texto: 'Agotado', tono: 'critico' },
  bajo: { texto: 'Bajo mínimo', tono: 'atencion' },
  sin_consumo: { texto: 'Sin consumo', tono: 'neutro' },
};

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
      <div class="cifras mt-5">
        <button
          v-for="c in CIFRAS"
          :key="c.clave"
          type="button"
          class="cifra"
          :class="filtro === c.clave ? 'on' : ''"
          :style="estiloTono(c.tono)"
          :title="c.ayuda"
          :aria-pressed="filtro === c.clave"
          @click="alternar(c.clave)"
        >
          <span class="burbuja"><Icono :nombre="c.icono" :tamano="22" :grosor="2.2" /></span>
          <span class="min-w-0">
            <span class="n">{{ miles(resumen[c.clave]) }}</span>
            <span class="e">{{ c.etiqueta }}</span>
          </span>
        </button>
        <RouterLink to="/inventario/semaforo" class="cifra" :style="estiloTono('atencion')" title="Lotes en rojo del semáforo y vencidos">
          <span class="burbuja"><Icono nombre="vencimiento" :tamano="22" :grosor="2.2" /></span>
          <span class="min-w-0">
            <span class="n">{{ miles(resumen.vencen) }}</span>
            <span class="e">Lotes por vencer <Icono nombre="irA" :tamano="14" :grosor="2.4" class="inline -mt-0.5" /></span>
          </span>
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
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm font-extrabold text-apagado">{{ miles(visibles.length) }} insumos</span>
          <div class="flex flex-wrap items-center gap-2">
            <div class="b-segmentado" role="radiogroup" aria-label="Agrupar por">
              <button v-for="o in [['categoria', 'Por categoría'], ['situacion', 'Por situación']]" :key="o[0]" type="button" role="radio" :aria-checked="agrupar === o[0]" :class="agrupar === o[0] ? 'on' : ''" @click="agrupar = o[0]">{{ o[1] }}</button>
            </div>
            <div class="b-segmentado" role="radiogroup" aria-label="Orden">
              <button v-for="o in [['alfabetico', 'A – Z'], ['cobertura', 'Menos meses'], ['pedido', 'Mayor pedido']]" :key="o[0]" type="button" role="radio" :aria-checked="orden === o[0]" :class="orden === o[0] ? 'on' : ''" @click="orden = o[0]">{{ o[1] }}</button>
            </div>
          </div>
        </div>

        <div class="lista" aria-label="Insumos">
          <div class="columnas" aria-hidden="true">
            <span>Insumo</span><span class="der">En bodega</span><span class="col-cob">Alcanza para</span><span class="der">Pedir</span>
          </div>

          <section v-for="g in grupos" :key="g.clave" class="grupo" :style="g.estilo">
            <button type="button" class="franja" :class="agrupar" :aria-expanded="!plegados.has(g.clave)" @click="plegar(g.clave)">
              <span class="franja-ic">
                <Pictograma v-if="g.categoria" :categoria="g.categoria" :grosor="2.2" />
                <span v-else class="punto" />
              </span>
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate">{{ g.nombre }}</span>
                <small v-if="g.porque" class="block truncate">{{ g.porque }}</small>
              </span>
              <span class="franja-cuenta">
                {{ g.filas.length }}
                <b v-if="g.porPedir"> · {{ g.porPedir }} por pedir</b>
              </span>
              <Icono nombre="irA" :tamano="18" :grosor="2.6" class="flecha" :class="plegados.has(g.clave) ? '' : 'abierta'" />
            </button>

            <ul v-show="!plegados.has(g.clave)" class="filas">
              <li v-for="f in g.filas" :key="f.insumoId">
                <button
                  type="button"
                  class="prod"
                  :class="elegidoId === f.insumoId ? 'sel' : ''"
                  :style="estiloCategoria(f.categoria)"
                  :aria-pressed="elegidoId === f.insumoId"
                  @click="elegidoId = f.insumoId"
                  @dblclick="router.push(`/inventario/${f.insumoId}`)"
                >
                  <span class="prod-ic" :title="categoriaVisual(f.categoria).nombre"><Pictograma :categoria="f.categoria" :grosor="2.2" /></span>
                  <span class="min-w-0">
                    <span class="block truncate font-extrabold text-tinta">{{ f.nombre }}</span>
                    <span class="mt-0.5 flex items-center gap-2 text-[12.5px] font-semibold text-apagado">
                      <span class="font-mono">{{ f.codigoInterno }}</span>
                      <span v-if="ESTADO[f.situacion]" class="etiqueta" :style="estiloTono(ESTADO[f.situacion].tono)">{{ ESTADO[f.situacion].texto }}</span>
                    </span>
                  </span>
                  <span class="bodega" :class="f.bres.I === 0 ? 'cero' : ''">{{ f.bres.I === 0 ? '0' : miles(f.bres.I) }}</span>
                  <span class="col-cob cobertura">
                    <ReglaCobertura :meses="f.bres.K" :minimo="minimo" :maximo="maximo" :tono="tonoRegla(f)" :ancho="112" />
                    <span class="meses"><b>{{ f.bres.K === null ? '—' : decimal(f.bres.K) }}</b> {{ f.bres.K === null ? '' : 'meses' }}</span>
                  </span>
                  <span class="der">
                    <span v-if="f.bres.M > 0" class="pedir" :style="estiloTono('accion')">{{ miles(f.bres.M) }}</span>
                    <span v-else class="nada">—</span>
                  </span>
                </button>
              </li>
            </ul>
          </section>
          <p v-if="!visibles.length" class="b-vacio">Ningún insumo coincide.</p>
        </div>
        </div>

        <!-- Insumo elegido -->
        <aside v-if="elegido" class="detalle" :style="estiloCategoria(elegido.categoria)" aria-live="polite">
          <div class="detalle-cabeza">
            <EstanteCategoria :categoria="elegido.categoria" />
            <h2 class="mt-3 text-[21px] font-extrabold leading-tight text-tinta">{{ elegido.nombre }}</h2>
            <p class="mt-1 font-mono text-sm font-semibold text-apagado">{{ elegido.codigoInterno }}</p>
          </div>

          <div class="mini mt-4">
            <div class="mini-c"><span>En bodega</span><b>{{ miles(elegido.bres.I) }}</b></div>
            <div class="mini-c"><span>Alcanza para</span><b>{{ elegido.bres.K === null ? '—' : `${decimal(elegido.bres.K)} m` }}</b></div>
            <div class="mini-c"><span>Consumo / mes</span><b>{{ miles(elegido.bres.J) }}</b></div>
            <div class="mini-c pedir-c" :style="estiloTono(elegido.bres.M > 0 ? 'accion' : 'neutro')"><span>Pedir</span><b>{{ elegido.bres.M > 0 ? miles(elegido.bres.M) : '—' }}</b></div>
          </div>

          <dl class="cuentas mt-3">
            <div><dt>Saldo del municipio</dt><dd>{{ miles(elegido.bres.H) }}</dd></div>
            <div v-if="enCuarentena"><dt>En cuarentena</dt><dd>{{ miles(enCuarentena) }}</dd></div>
            <div><dt>Máximo ({{ maximo }} meses de consumo)</dt><dd>{{ cantidad(elegido.bres.L) }}</dd></div>
          </dl>
          <p class="mt-2 text-xs font-semibold text-apagado">
            Pedir = máximo − {{ balance.configuracion.formulaPedido === 'mspas' ? 'saldo del municipio' : 'existencia en bodega' }}; si da negativo, no se pide.
          </p>

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
/* Tonos (--t, --t-fondo, --t-borde, --t-hondo, --t-tinta) y colores de
   categoría (--cat, --cat-fondo, --cat-tinta) vienen de PiezasBodega. */

/* --- Cifras: tarjetas con relieve; el color solo en la burbuja y el borde --- */
.cifras { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .cifras { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.cifra {
  display: flex; align-items: center; gap: 14px; padding: 14px 16px; text-align: left; background: #fff;
  border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; color: #14244A;
  transition: background .12s, border-color .12s, transform .06s;
}
.cifra:hover { border-color: var(--t-borde); }
.cifra:active { transform: translateY(2px); border-bottom-width: 2px; }
.cifra.on { background: var(--t-fondo); border-color: var(--t); border-bottom-color: var(--t-hondo); }
.burbuja { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 14px; background: var(--t-fondo); color: var(--t-hondo); }
.cifra.on .burbuja { background: var(--t); color: #fff; }
.cifra .n { display: block; font-size: 28px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.cifra .e { display: block; margin-top: 4px; font-size: 12px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #64748B; white-space: nowrap; }
.cifra.on .e { color: var(--t-tinta); }
@media (max-width: 600px) {
  .cifra { gap: 10px; padding: 12px; }
  .burbuja { width: 36px; height: 36px; border-radius: 12px; }
  .cifra .n { font-size: 24px; }
  .cifra .e { white-space: normal; font-size: 11px; }
}

/* --- Lista agrupada --------------------------------------------------------- */
.paneles { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .paneles { grid-template-columns: 1fr; } }
/* La lista se desplaza con la página: con altura propia quedaba cortada cuando el panel del insumo era más alto. */
.lista { padding: 0 2px 8px; }

/* Columnas alineadas: ícono | insumo | en bodega | alcanza para | pedir */
.columnas, .prod { display: grid; grid-template-columns: 40px minmax(0, 1fr) 96px 176px 92px; align-items: center; column-gap: 14px; }
.columnas {
  position: sticky; top: 72px; /* debajo de la barra superior (72 px) */ z-index: 3; padding: 8px 16px 8px 14px; background: #F8FAFC;
  font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #64748B;
}
.columnas > span:first-child { grid-column: 1 / 3; }
.der { text-align: right; justify-self: end; }
@media (max-width: 720px) {
  .columnas, .prod { grid-template-columns: minmax(0, 1fr) 72px 76px; column-gap: 10px; }
  .columnas > span:first-child { grid-column: auto; }
  .col-cob, .prod-ic { display: none !important; }
  .prod .truncate { white-space: normal; overflow: visible; }
  .franja-cuenta b { display: none; }
}

.grupo + .grupo { margin-top: 14px; }
/* Franja del grupo: color pleno de la categoría (o del estado), como la
   cabecera de una unidad; se pliega para recorrer el catálogo por partes. */
.franja {
  position: sticky; top: 106px; z-index: 2; display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px;
  border-radius: 16px; border-bottom: 4px solid rgba(0, 0, 0, .18); color: #fff; font-weight: 900; font-size: 15.5px;
  background: var(--cat); transition: transform .06s;
}
.franja.situacion { background: var(--t); }
.franja:active { transform: translateY(2px); border-bottom-width: 2px; }
.franja small { font-size: 12px; font-weight: 700; opacity: .9; }
.franja-ic { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; border-radius: 11px; background: rgba(255, 255, 255, .22); }
.franja-ic svg { width: 20px; height: 20px; }
.franja-ic .punto { width: 12px; height: 12px; border-radius: 50%; background: #fff; }
.franja-cuenta { flex-shrink: 0; padding: 3px 10px; border-radius: 999px; background: rgba(255, 255, 255, .22); font-size: 13px; font-weight: 800; white-space: nowrap; }
.flecha { flex-shrink: 0; transition: transform .15s; }
.flecha.abierta { transform: rotate(90deg); }

.filas { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.prod {
  width: 100%; padding: 10px 16px 10px 12px; text-align: left; background: #fff;
  border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px;
  transition: border-color .12s, background .12s, transform .06s;
}
.prod:hover { border-color: #C5CFDC; }
.prod:active { transform: translateY(2px); border-bottom-width: 2px; }
.prod.sel { border-color: var(--cat); border-bottom-color: var(--cat-tinta); background: color-mix(in srgb, var(--cat-fondo) 45%, #fff); }
.prod-ic { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--cat-fondo); color: var(--cat-tinta); }
.prod-ic svg { width: 22px; height: 22px; }

.etiqueta { padding: 1px 8px; border-radius: 7px; background: var(--t-fondo); color: var(--t-tinta); font-size: 11px; font-weight: 800; white-space: nowrap; }
.bodega { justify-self: end; font-size: 17px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.bodega.cero { color: #A83232; }
.cobertura { display: flex; align-items: center; gap: 8px; }
.meses { font-size: 12px; font-weight: 700; color: #64748B; white-space: nowrap; }
.meses b { font-size: 15px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.pedir {
  display: inline-block; min-width: 64px; padding: 4px 10px; text-align: center; border-radius: 12px;
  background: var(--t-fondo); border: 2px solid var(--t-borde); border-bottom-width: 3px; border-bottom-color: var(--t);
  color: var(--t-tinta); font-size: 15px; font-weight: 900; font-variant-numeric: tabular-nums;
}
.nada { color: #CBD5E1; font-weight: 800; }

/* --- Insumo elegido ---------------------------------------------------------- */
.detalle { position: sticky; top: 88px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; padding: 0 16px 16px; background: #fff; overflow: hidden; }
.detalle-cabeza { margin: 0 -16px; padding: 18px 16px; background: var(--cat-fondo); }
.mini { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mini-c { padding: 10px 12px; border: 2px solid #E5E9F0; border-bottom-width: 3px; border-radius: 14px; }
.mini-c span { display: block; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.mini-c b { display: block; margin-top: 2px; font-size: 20px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.mini-c.pedir-c { background: var(--t-fondo); border-color: var(--t-borde); border-bottom-color: var(--t); }
.mini-c.pedir-c span, .mini-c.pedir-c b { color: var(--t-tinta); }
.cuentas div { display: flex; justify-content: space-between; gap: 12px; padding: 6px 2px; border-bottom: 2px solid #F1F4F8; font-size: 14px; font-weight: 600; color: #475569; }
.cuentas dd { font-weight: 800; color: #14244A; font-variant-numeric: tabular-nums; }

/* --- Por servicio ------------------------------------------------------------ */
.servicios { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 900px) { .servicios { grid-template-columns: 1fr; } }
.lista-servicios { display: flex; flex-direction: column; gap: 4px; max-height: max(420px, calc(100vh - 360px)); overflow-y: auto; padding-right: 4px; }
.servicio { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 0 12px; border-radius: 12px; border: 2px solid transparent; font-weight: 700; font-size: 14px; color: #334155; text-align: left; }
.servicio:hover { background: #F1F5F9; }
.servicio.on { border-color: #4A9BD6; background: #EAF3FB; color: #172A5A; font-weight: 800; }
.lista-alta { max-height: max(420px, calc(100vh - 360px)); }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 28px; border-radius: 9px; background: var(--cat-fondo); color: var(--cat-tinta); }
.cat-mini svg { width: 16px; height: 16px; }
.meses-tabla { font-weight: 800; }
.meses-tabla.bajo { color: #C27708; }
.meses-tabla.agotado { color: #A83232; }
.meses-tabla.sin_consumo { color: #94A3B8; }
</style>
