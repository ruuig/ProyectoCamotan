<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
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
 * cuántos meses alcanza y cuánto pedir. Pensada para pantallas chicas: una
 * sola barra (buscar, categoría y qué ver) y la lista empieza enseguida. Al
 * tocar un insumo se abre su detalle encima; Esc o «Cerrar» lo quita.
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
const VER = [
  { clave: 'todos', etiqueta: 'Todos' },
  { clave: 'pedir', etiqueta: 'Por pedir' },
  { clave: 'bajo', etiqueta: 'Bajo mínimo' },
  { clave: 'agotados', etiqueta: 'Agotados' },
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
    .sort(filtro.value === 'pedir' ? COMPARAR.pedido : COMPARAR.alfabetico);
});


const elegido = computed(() => todas.value.find((f) => f.insumoId === elegidoId.value) ?? null);
const lotesElegido = computed(() => lotesDe.value.get(elegidoId.value) ?? []);
const enCuarentena = computed(() => lotesElegido.value.filter((l) => l.estado === 'cuarentena').reduce((s, l) => s + l.cantidad, 0));

// Dónde está el producto en la bodega (estante, repisa).
const ubicacionEditada = ref('');
watch(elegidoId, () => { ubicacionEditada.value = elegido.value?.ubicacionFisica ?? ''; });
async function guardarUbicacion() {
  try {
    await bodega.cambiarUbicacion(elegido.value.insumoId, ubicacionEditada.value.trim() || null);
    elegido.value.ubicacionFisica = ubicacionEditada.value.trim() || null;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

// El detalle se cierra con Esc.
function alTeclear(e) { if (e.key === 'Escape') elegidoId.value = null; }
onMounted(() => document.addEventListener('keydown', alTeclear));
onBeforeUnmount(() => document.removeEventListener('keydown', alTeclear));

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
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <template v-if="balance">
      <!-- Una sola barra: buscar, categoría y qué ver -->
      <div class="barra-filtros mt-3">
        <label class="b-buscar buscar">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" class="b-campo" placeholder="Buscar insumo" aria-label="Buscar insumo" />
        </label>
        <select v-model="categoriaFiltro" class="b-campo categoria" aria-label="Categoría">
          <option value="">Todas las categorías</option>
          <option v-for="(c, clave) in CATEGORIA" :key="clave" :value="clave">{{ c.nombre }}</option>
        </select>
        <div class="b-segmentado ver" role="radiogroup" aria-label="Qué ver">
          <button v-for="v in VER" :key="v.clave" type="button" role="radio" :aria-checked="filtro === v.clave" :class="filtro === v.clave ? 'on' : ''" @click="filtro = v.clave">
            {{ v.etiqueta }}<span v-if="v.clave !== 'todos' && resumen[v.clave]" class="cuenta" :class="v.clave">{{ miles(resumen[v.clave]) }}</span>
          </button>
        </div>
      </div>

      <!-- Por insumo -->
      <div v-if="vista === 'insumo'" class="paneles mt-4">
        <div class="min-w-0">
        <div class="lista" aria-label="Insumos">
          <div class="columnas" aria-hidden="true">
            <span>Insumo · {{ miles(visibles.length) }}</span><span class="der">En bodega</span><span class="col-cob">Alcanza para</span><span class="der">Pedir</span>
          </div>

          <ul class="filas">
              <li v-for="f in visibles" :key="f.insumoId">
                <button
                  type="button"
                  class="prod"
                  :class="elegidoId === f.insumoId ? 'sel' : ''"
                  :style="estiloCategoria(f.categoria)"
                  :aria-pressed="elegidoId === f.insumoId"
                  @click="elegidoId = elegidoId === f.insumoId ? null : f.insumoId"
                  @dblclick="router.push(`/inventario/${f.insumoId}`)"
                >
                  <span class="prod-ic" :title="categoriaVisual(f.categoria).nombre"><Pictograma :categoria="f.categoria" :grosor="2.2" /></span>
                  <span class="min-w-0">
                    <span class="block nombre-completo font-extrabold text-tinta">{{ f.nombre }}</span>
                    <span v-if="f.ubicacionFisica" class="donde"><Icono nombre="ubicacion" :tamano="13" /> {{ f.ubicacionFisica }}</span>
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
          <p v-if="!visibles.length" class="b-vacio">Ningún insumo coincide.</p>
        </div>
        </div>

        <!-- Insumo elegido -->
        <div v-if="elegido" class="velo-detalle" @click="elegidoId = null" />
        <aside v-if="elegido" class="detalle" :style="estiloCategoria(elegido.categoria)" aria-live="polite">
          <div class="detalle-cabeza">
            <button type="button" class="cerrar-detalle" aria-label="Cerrar" @click="elegidoId = null"><Icono nombre="cerrar" :tamano="20" :grosor="2.4" /> Cerrar</button>
            <EstanteCategoria :categoria="elegido.categoria" />
            <h2 class="mt-3 text-[21px] font-extrabold leading-tight text-tinta">{{ elegido.nombre }}</h2>
            <p class="mt-1 font-mono text-sm font-semibold text-apagado">{{ elegido.codigoInterno }}</p>
            <!-- Dónde está en la bodega: opcional, cuando ya está etiquetado -->
            <form class="donde-form" @submit.prevent="guardarUbicacion">
              <label for="donde" class="b-etiqueta">Dónde está <span class="b-opcional">opcional</span></label>
              <div class="flex gap-2">
                <input id="donde" v-model="ubicacionEditada" maxlength="80" class="b-campo" placeholder="Ej.: Estante 3, repisa B" />
                <button type="submit" class="b-btn chico secundario" :disabled="(ubicacionEditada || '') === (elegido.ubicacionFisica || '')">Guardar</button>
              </div>
            </form>
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
            <span v-if="s.informado" class="b-estado disponible">Informó</span>
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
.donde { display: inline-flex; align-items: center; gap: 4px; margin-top: 3px; padding: 1px 8px; border-radius: 8px; background: #EEF2F7; font-size: 12.5px; font-weight: 800; color: #334155; }
.donde-form { margin-top: 10px; }
/* Tonos (--t, --t-fondo, --t-borde, --t-hondo, --t-tinta) y colores de
   categoría (--cat, --cat-fondo, --cat-tinta) vienen de PiezasBodega. */

/* --- Barra única de filtros ---------------------------------------------------- */
.barra-filtros { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.barra-filtros .buscar { flex: 1 1 220px; }
.barra-filtros .categoria { flex: 0 1 230px; height: 44px; }
.ver button { display: inline-flex; align-items: center; gap: 6px; }
.cuenta { min-width: 22px; padding: 0 7px; border-radius: 9px; background: #E2E8F0; color: #334155; font-size: 12.5px; font-weight: 900; text-align: center; }
.cuenta.agotados { background: #FDECEC; color: #A83232; }
.cuenta.bajo { background: #FFF1DC; color: #8A4B00; }
.cuenta.pedir { background: #EAF3FB; color: #174E80; }

/* --- Lista agrupada --------------------------------------------------------- */
.paneles { display: block; }
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

.filas { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.prod {
  width: 100%; padding: 8px 16px 8px 12px; text-align: left; background: #fff;
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
/* Encima de la lista, a la derecha: no le quita ancho a la tabla. */
.velo-detalle { position: fixed; inset: 0; z-index: 40; background: rgba(15, 23, 42, .25); }
.detalle { position: fixed; top: 0; right: 0; bottom: 0; z-index: 41; width: min(400px, 100vw); overflow-y: auto; padding: 0 16px 20px; background: #fff; border-left: 2px solid #E5E9F0; box-shadow: -12px 0 30px -12px rgba(15, 23, 42, .35); }
.cerrar-detalle { display: inline-flex; align-items: center; gap: 4px; float: right; padding: 6px 12px; border: 2px solid #CBD5E1; border-radius: 12px; background: #fff; font-size: 14px; font-weight: 800; color: #14244A; }
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
