<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { textoNumero } from '../../dominio/hojasRequisicion';
import { usarBorrador } from '../../dominio/borrador';
import AvisoBorrador from '../../components/comunes/AvisoBorrador.vue';
import { RouterLink, useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import { useAuthStore } from '../../stores/auth';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';
import AtenderPedido from '../../components/bodega/AtenderPedido.vue';

/**
 * Requisiciones: la bodega registra lo que entrega y el sistema genera la
 * requisición (FOR-ASB-01) lista para imprimir sobre el formulario.
 * Sale de los lotes que vencen primero. El número del formulario se puede
 * anotar después.
 */
const route = useRoute();
const auth = useAuthStore();
const esBodega = computed(() => auth.rol !== 'farmacia');

// Tres vistas: lo que los servicios pidieron y espera (Por atender), lo que
// se entrega sin pedido previo, y lo ya entregado.
const vista = ref(route.query.ver === 'sin_numero' ? 'registradas' : route.query.ver === 'pedidos' ? 'pedidos' : 'nueva');
const soloSinNumero = ref(route.query.ver === 'sin_numero');
const lista = ref([]);
const tipos = ref([]);
const lugares = ref([]);
const insumos = ref([]);
const solicitantes = ref({});
const error = ref('');
const aviso = ref('');
const enviando = ref(false);

const entero = (v) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
const hoy = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);

const GRUPOS = [
  ['centro_salud', 'Farmacia'],
  ['unidad_interna', 'Unidades del centro'],
  ['servicio', 'Puestos y centros comunitarios'],
];
const grupoDe = (u) => (u.tipo === 'centro_salud' ? 'centro_salud' : u.tipo === 'unidad_interna' ? 'unidad_interna' : 'servicio');

async function cargar() {
  try {
    const [r, u, i, s] = await Promise.all([
      bodega.requisiciones(), bodega.ubicaciones().catch(() => ({ ubicaciones: [] })), inventario.insumos(), bodega.solicitantes().catch(() => ({ solicitantes: {} })),
    ]);
    lista.value = r.requisiciones.filter((x) => x.direccion !== 'superior');
    // Lo primero que bodega ve es lo que le piden, si hay algo esperando.
    if (!route.query.ver && porAtender.value.length && vista.value === 'nueva' && !renglones.value.length) vista.value = 'pedidos';
    tipos.value = r.tipos;
    lugares.value = u.ubicaciones
      .filter((x) => x.activo !== false && (x.tipo === 'centro_salud' || (esBodega.value && (x.tipo === 'unidad_interna' || x.informa))))
      .map((x) => (x.tipo === 'centro_salud' ? { ...x, nombre: 'Farmacia (post-consulta)' } : x));
    insumos.value = i.insumos.map((x) => ({ ...x, saldoTotal: x.saldoBodega ?? x.saldoTotal }));
    solicitantes.value = s.solicitantes;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

// --- Nueva entrega ---------------------------------------------------------------------
const VACIA = () => ({ numero: '', ubicacionId: '', unidadSeccion: '', fechaSolicitud: hoy(), solicitante: '', jefe: '', tipos: [], observaciones: '' });
const nueva = reactive(VACIA());
const renglones = ref([]);
// Lo que se está armando no se pierde al ir a otra pantalla.
const borrador = usarBorrador('entregar', { nueva, renglones }, { vacio: (d) => !d.renglones.length && !d.nueva.ubicacionId });
let restaurando = false;
function empezarDeNuevo() { Object.assign(nueva, VACIA()); renglones.value = []; borrador.limpiar(); }
const elegido = ref(null);
const cantidad = ref('');
const libre = reactive({ descripcion: '', unidadMedida: 'Unidad', cantidad: '' });
const ultima = ref(null);

// Al elegir el lugar se propone quien firmó la última vez.
watch(() => nueva.ubicacionId, (id) => {
  if (restaurando) return;
  const s = solicitantes.value[id];
  const lugar = lugares.value.find((l) => l.id === Number(id));
  nueva.solicitante = s?.solicitante ?? '';
  nueva.jefe = s?.jefe ?? '';
  nueva.unidadSeccion = s?.unidadSeccion ?? lugar?.nombre ?? '';
});

async function elegirInsumo(i) {
  elegido.value = i;
  await nextTick();
  document.getElementById('cant-req')?.focus();
}

function sumarRenglon(insumo, n) {
  let r = renglones.value.find((x) => x.insumoId === insumo.id);
  if (r) r.cantidad += n;
  else {
    renglones.value.push({ insumoId: insumo.id, descripcion: insumo.nombreGenerico, unidadMedida: insumo.unidadEntrega, cantidad: n, enBodega: insumo.saldoTotal, propuesta: [], disponibles: [], loteElegido: '' });
    r = renglones.value.at(-1);
  }
  cargarLotes(r);
}

/**
 * De qué lote sale cada renglón. Para la trazabilidad, no para el formulario
 * impreso: por defecto el que vence primero; se puede elegir otro.
 */
async function cargarLotes(r) {
  const n = entero(r.cantidad);
  if (!r.insumoId || !n) return;
  try {
    const p = await bodega.propuestaLotes(r.insumoId, n);
    r.propuesta = p.propuesta;
    r.disponibles = p.disponibles ?? [];
  } catch {
    r.propuesta = [];
  }
}
const loteDe = (r) => r.disponibles.find((l) => l.loteId === Number(r.loteElegido));
const venceCorto = (v) => new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });

function agregarInsumo() {
  const n = entero(cantidad.value);
  if (!elegido.value || !n) return;
  sumarRenglon(elegido.value, n);
  elegido.value = null;
  cantidad.value = '';
}

function agregarLibre() {
  const n = entero(libre.cantidad);
  if (!libre.descripcion.trim() || !n) return;
  renglones.value.push({ insumoId: null, descripcion: libre.descripcion.trim(), unidadMedida: libre.unidadMedida || 'Unidad', cantidad: n, enBodega: null });
  Object.assign(libre, { descripcion: '', unidadMedida: 'Unidad', cantidad: '' });
}

const noAlcanza = computed(() => renglones.value.filter((r) => (r.enBodega != null && r.enBodega < entero(r.cantidad)) || (loteDe(r) && loteDe(r).cantidad < entero(r.cantidad))));

async function entregar() {
  error.value = '';
  aviso.value = '';
  enviando.value = true;
  try {
    const r = await bodega.entregar({
      ...nueva,
      ubicacionId: Number(nueva.ubicacionId),
      numero: nueva.numero.trim() || null,
      renglones: renglones.value.map(({ insumoId, descripcion, unidadMedida, cantidad: c, loteElegido }) => ({
        insumoId, descripcion: insumoId ? null : descripcion, unidadMedida: insumoId ? null : unidadMedida, cantidad: entero(c),
        ...(insumoId && loteElegido ? { lotes: [{ loteId: Number(loteElegido), cantidad: entero(c) }] } : {}),
      })),
    }, `entrega-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    ultima.value = r.requisicion;
    aviso.value = `Entregado a ${r.requisicion.unidadSeccion}.${r.requisicion.numero ? '' : ' Falta anotar el número del formulario.'}`;
    Object.assign(nueva, VACIA());
    renglones.value = [];
    borrador.limpiar();
    await cargar();
    window.open(`/imprimir/requisicion/${r.requisicion.id}`, '_blank');
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

// --- Repartir un insumo entre los servicios ---------------------------------------
const reparto = reactive({ insumo: null, modo: 'consumo', cantidad: '' });
const propuesta = ref(null);

async function proponer() {
  error.value = '';
  try {
    propuesta.value = await bodega.distribucion({ insumoId: reparto.insumo.id, modo: reparto.modo, cantidad: entero(reparto.cantidad) || undefined });
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function usarFila(f) {
  Object.assign(nueva, VACIA());
  renglones.value = [];
  nueva.ubicacionId = f.ubicacionId;
  sumarRenglon(reparto.insumo, f.cantidad);
}

// --- Registradas ----------------------------------------------------------------------
// Entregadas: solo lo que de verdad salió de bodega.
const entregadas = computed(() => lista.value.filter((r) => ['despachada', 'parcial', 'recibida'].includes(r.estado)));
const porAtender = computed(() => lista.value.filter((r) => ['solicitada', 'autorizada'].includes(r.estado)));
const mostradas = computed(() => (soloSinNumero.value ? entregadas.value.filter((r) => !r.numero) : entregadas.value));
// Desde el panel se puede abrir un pedido directo: ?pedido=ID.
const atendiendo = ref(route.query.pedido ? Number(route.query.pedido) : null);
// Sin una elegida, se abre la primera que espera.
const abiertaPedido = computed(() => (porAtender.value.some((p) => p.id === atendiendo.value) ? atendiendo.value : porAtender.value[0]?.id ?? null));
async function pedidoListo(texto) {
  aviso.value = texto;
  atendiendo.value = null;
  await cargar();
}
const diasDesde = (f) => Math.max(0, Math.floor((Date.now() - new Date(f)) / 86400000));
const abierta = ref(null);
const numero = ref('');

async function abrir(id) {
  error.value = '';
  try {
    abierta.value = (await bodega.requisicion(id)).requisicion;
    numero.value = abierta.value.numero ?? '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function guardarNumero() {
  error.value = '';
  try {
    abierta.value = (await bodega.anotarNumero(abierta.value.id, numero.value.trim())).requisicion;
    aviso.value = `Número ${abierta.value.numero} anotado.`;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(() => {
  restaurando = true;
  if (borrador.recuperar()) vista.value = 'nueva';
  nextTick(() => { restaurando = false; });
  cargar();
});
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex flex-wrap items-end gap-4">
        <div><p class="b-antetitulo">Requisiciones</p><h1 class="b-titulo">Salidas</h1></div>
        <RouterLink to="/inventario/pedir-ddriss" class="b-btn secundario chico"><Icono nombre="trasladar" :tamano="16" /> Requisición</RouterLink>
      </div>
      <div class="b-segmentado" role="radiogroup" aria-label="Vista">
        <button type="button" role="radio" :aria-checked="vista === 'nueva'" :class="vista === 'nueva' ? 'on' : ''" @click="vista = 'nueva'">Entregar</button>
        <!-- Con pedidos esperando, la pestaña se pinta de naranja con su número. -->
        <button type="button" role="radio" :aria-checked="vista === 'pedidos'" class="pest-pedidos" :class="{ on: vista === 'pedidos', hay: porAtender.length }" @click="vista = 'pedidos'">
          Por despachar <span v-if="porAtender.length" class="cuenta-pedidos">{{ porAtender.length }}</span>
        </button>
        <button type="button" role="radio" :aria-checked="vista === 'registradas'" :class="vista === 'registradas' ? 'on' : ''" @click="vista = 'registradas'">Entregadas ({{ entregadas.length }})</button>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <div v-if="aviso" class="b-aviso ok mt-4 items-center justify-between" aria-live="polite">
      <span>{{ aviso }}</span>
      <RouterLink v-if="ultima" :to="`/imprimir/requisicion/${ultima.id}`" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Imprimir otra vez</RouterLink>
    </div>

    <!-- Por despachar: una pestaña por requisición y su hoja de despacho -->
    <div v-if="vista === 'pedidos'" class="mt-5">
      <nav v-if="porAtender.length > 1" class="pendientes" aria-label="Requisiciones por despachar">
        <button v-for="p in porAtender" :key="p.id" type="button" class="pendiente" :class="{ on: abiertaPedido === p.id }" @click="atendiendo = p.id">
          <b>{{ p.unidadSeccion }}</b>
          <small>{{ p.renglones }} · {{ diasDesde(p.fechaSolicitud) === 0 ? 'hoy' : `hace ${diasDesde(p.fechaSolicitud)} ${diasDesde(p.fechaSolicitud) === 1 ? 'día' : 'días'}` }}</small>
        </button>
      </nav>
      <AtenderPedido v-if="abiertaPedido" :id="abiertaPedido" class="mt-3" @listo="pedidoListo" />
      <p v-else-if="!porAtender.length" class="b-vacio">No hay requisiciones por despachar.</p>
    </div>

    <!-- Entregar sin pedido -->
    <div v-if="vista === 'nueva'" class="rejilla mt-5">
      <form class="space-y-4" @submit.prevent="entregar">
        <AvisoBorrador v-if="borrador.recuperado.value && renglones.length" texto="Se recuperó la entrega que dejó a medias." @descartar="empezarDeNuevo" />
        <div class="grid gap-3 sm:grid-cols-12">
          <div class="sm:col-span-5">
            <label for="lugar" class="b-etiqueta">Se entrega a</label>
            <select id="lugar" v-model="nueva.ubicacionId" required class="b-campo">
              <option value="">Elija</option>
              <template v-for="[g, titulo] in GRUPOS" :key="g">
                <optgroup v-if="lugares.some((l) => grupoDe(l) === g)" :label="titulo">
                  <option v-for="l in lugares.filter((x) => grupoDe(x) === g)" :key="l.id" :value="l.id">{{ l.nombre }}</option>
                </optgroup>
              </template>
            </select>
          </div>
          <div class="sm:col-span-4">
            <label for="sol" class="b-etiqueta">Solicitante</label>
            <input id="sol" v-model="nueva.solicitante" required minlength="3" maxlength="160" placeholder="A.E. Nombre Apellido" class="b-campo" />
          </div>
          <div class="sm:col-span-3">
            <label for="num" class="b-etiqueta">No. del formulario</label>
            <input id="num" v-model="nueva.numero" maxlength="20" placeholder="Opcional" class="b-campo font-mono" />
          </div>
          <div class="sm:col-span-5">
            <label for="unidad" class="b-etiqueta">Unidad / sección</label>
            <input id="unidad" v-model="nueva.unidadSeccion" maxlength="160" class="b-campo" />
          </div>
          <div class="sm:col-span-4">
            <label for="jefe" class="b-etiqueta">Coordinador / jefe</label>
            <input id="jefe" v-model="nueva.jefe" maxlength="160" class="b-campo" />
          </div>
          <div class="sm:col-span-3">
            <label for="fsol" class="b-etiqueta">Fecha</label>
            <input id="fsol" v-model="nueva.fechaSolicitud" type="date" required class="b-campo" />
          </div>
        </div>

        <div class="agregar">
          <div class="min-w-0 flex-1">
            <span class="b-etiqueta">Producto</span>
            <div v-if="elegido" class="elegido">
              <span class="min-w-0 flex-1 nombre-completo font-semibold text-tinta">{{ elegido.nombreGenerico }}</span>
              <span class="text-[13px] font-semibold text-apagado">hay {{ miles(elegido.saldoTotal) }}</span>
              <button type="button" class="quitar" aria-label="Cambiar" @click="elegido = null"><Icono nombre="cerrar" :tamano="16" /></button>
            </div>
            <BuscadorInsumo v-else :insumos="insumos" placeholder="Buscar producto" @elegir="elegirInsumo" />
          </div>
          <div class="w-[110px]">
            <label for="cant-req" class="b-etiqueta">Cantidad</label>
            <input id="cant-req" v-model="cantidad" inputmode="numeric" class="b-campo num" @keydown.enter.prevent="agregarInsumo" />
          </div>
          <button type="button" class="b-btn secundario" :disabled="!elegido || !entero(cantidad)" @click="agregarInsumo"><Icono nombre="agregar" :tamano="18" /> Agregar</button>
        </div>
        <details class="text-sm">
          <summary class="cursor-pointer font-semibold text-apagado">Equipo u otro artículo que no está en el catálogo</summary>
          <div class="agregar mt-2">
            <input v-model="libre.descripcion" placeholder="Descripción: marca, modelo, Inv. No., SICOIN, valor" aria-label="Descripción" class="b-campo min-w-[16rem] flex-1" />
            <input v-model="libre.unidadMedida" placeholder="Unidad" aria-label="Unidad de medida" class="b-campo w-[120px]" />
            <input v-model="libre.cantidad" inputmode="numeric" placeholder="Cant." aria-label="Cantidad" class="b-campo num w-[90px]" />
            <button type="button" class="b-btn secundario" @click="agregarLibre">Agregar</button>
          </div>
        </details>

        <div class="b-tabla-marco">
          <table class="b-tabla">
            <thead><tr><th class="n">No.</th><th>Descripción del artículo <span class="no-imprime">· lote (no se imprime)</span></th><th>Unidad</th><th class="n">Cantidad</th><th class="n">En bodega</th><th /></tr></thead>
            <tbody>
              <tr v-for="(r, i) in renglones" :key="i">
                <td class="n">{{ i + 1 }}</td>
                <td>
                  <span class="font-semibold text-tinta">{{ r.descripcion }}</span>
                  <div class="lote-celda">
                  <template v-if="r.insumoId">
                    <div v-if="!r.loteElegido" class="lotes-salen">
                      <span v-for="l in r.propuesta" :key="l.loteId" class="lote-chip" :title="`Vence ${venceCorto(l.fechaVence)}`">
                        <b>{{ l.numeroLote }}</b> vence {{ venceCorto(l.fechaVence) }}<template v-if="r.propuesta.length > 1"> · {{ miles(l.cantidad) }}</template>
                      </span>
                      <span v-if="!r.propuesta.length" class="text-apagado">—</span>
                    </div>
                    <select v-model="r.loteElegido" class="lote-sel" :class="{ falta: loteDe(r) && loteDe(r).cantidad < entero(r.cantidad) }" :aria-label="`Lote de ${r.descripcion}`">
                      <option value="">El que vence primero</option>
                      <option v-for="l in r.disponibles" :key="l.loteId" :value="l.loteId">{{ l.numeroLote }} · vence {{ venceCorto(l.fechaVence) }} · hay {{ miles(l.cantidad) }}</option>
                    </select>
                  </template>
                  <span v-else class="text-apagado">—</span>
                  </div>
                </td>
                <td>{{ r.unidadMedida }}</td>
                <td class="n"><input v-model.number="r.cantidad" inputmode="numeric" class="celda" :aria-label="`Cantidad de ${r.descripcion}`" @change="cargarLotes(r)" /></td>
                <td class="n" :class="r.enBodega != null && r.enBodega < entero(r.cantidad) ? 'falta' : ''">{{ r.enBodega == null ? '—' : miles(r.enBodega) }}</td>
                <td class="n"><button type="button" class="quitar" aria-label="Quitar" @click="renglones.splice(i, 1)"><Icono nombre="cerrar" :tamano="16" /></button></td>
              </tr>
              <tr v-if="!renglones.length"><td colspan="6" class="b-vacio">Agregue lo que se entrega.</td></tr>
            </tbody>
          </table>
        </div>
        <p v-if="noAlcanza.length" class="b-aviso atencion text-sm">No alcanza en bodega: {{ noAlcanza.map((r) => r.descripcion).join(', ') }}.</p>
        <div class="flex flex-wrap gap-2">
          <input v-model="nueva.observaciones" maxlength="1000" placeholder="Observaciones: Procedente donación OPS/OMS…" aria-label="Observaciones" class="b-campo min-w-[12rem] flex-1" />
          <button type="submit" class="b-btn primario" :disabled="enviando || !renglones.length || !nueva.ubicacionId || noAlcanza.length > 0">
            <Icono nombre="imprimir" :tamano="20" /> {{ enviando ? 'Registrando…' : 'Entregar e imprimir' }}
          </button>
        </div>
      </form>

      <aside v-if="esBodega" class="b-panel">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Repartir un producto</h2></header>
        <div class="b-panel-cuerpo space-y-3">
          <div v-if="reparto.insumo" class="elegido">
            <span class="min-w-0 flex-1 nombre-completo font-semibold text-tinta">{{ reparto.insumo.nombreGenerico }}</span>
            <button type="button" class="quitar" aria-label="Cambiar producto" @click="reparto.insumo = null; propuesta = null"><Icono nombre="cerrar" :tamano="16" /></button>
          </div>
          <BuscadorInsumo v-else :insumos="insumos" placeholder="Producto a repartir" @elegir="(i) => (reparto.insumo = i)" />
          <div class="b-segmentado w-full" role="radiogroup" aria-label="Modo de reparto">
            <button v-for="m in [['consumo', 'Según consumo'], ['iguales', 'Partes iguales']]" :key="m[0]" type="button" role="radio" class="flex-1" :aria-checked="reparto.modo === m[0]" :class="reparto.modo === m[0] ? 'on' : ''" @click="reparto.modo = m[0]">{{ m[1] }}</button>
          </div>
          <input v-model="reparto.cantidad" inputmode="numeric" placeholder="Toda la existencia" aria-label="Cantidad a repartir" class="b-campo num" />
          <button type="button" class="b-btn secundario w-full" :disabled="!reparto.insumo" @click="proponer">Calcular reparto</button>
          <div v-if="propuesta" class="space-y-2">
            <p class="text-sm font-semibold text-tinta-2">
              <template v-if="propuesta.modo === 'iguales' && propuesta.lugares">{{ miles(propuesta.cantidad) }} ÷ {{ propuesta.lugares }} lugares</template>
              <template v-else>{{ miles(propuesta.cantidad) }} entre {{ propuesta.filas.length }} servicios</template>
              · quedan {{ miles(propuesta.sobrante) }} en bodega
            </p>
            <ul class="reparto">
              <li v-for="f in propuesta.filas" :key="f.ubicacionId">
                <span class="min-w-0 flex-1 nombre-completo text-sm font-semibold text-tinta">{{ f.nombre }}</span>
                <strong class="tabular-nums text-tinta">{{ miles(f.cantidad) }}</strong>
                <button v-if="f.cantidad > 0" type="button" class="b-btn secundario chico" @click="usarFila(f)">Usar</button>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>

    <!-- Entregadas -->
    <div v-if="vista === 'registradas'" class="rejilla-lista mt-5">
      <div>
        <label class="mb-2 flex items-center gap-2 text-sm font-semibold"><input v-model="soloSinNumero" type="checkbox" /> Solo las que no tienen número de formulario</label>
        <div class="b-tabla-marco lista">
          <table class="b-tabla">
            <thead><tr><th>No.</th><th>Fecha</th><th>Se entregó a</th><th>Solicitante</th><th class="n">Renglones</th><th class="n">Unidades</th><th /></tr></thead>
            <tbody>
              <tr v-for="r in mostradas" :key="r.id" class="cursor-pointer" :class="abierta?.id === r.id ? 'activa' : ''" @click="abrir(r.id)">
                <td class="whitespace-nowrap font-mono font-semibold" :class="r.numero ? 'text-[#172A5A]' : 'falta'">{{ r.numero ? textoNumero(r) : 'sin número' }}</td>
                <td class="whitespace-nowrap">{{ fecha(r.fechaSolicitud) }}</td>
                <td class="font-semibold text-tinta">{{ r.unidadSeccion }}</td>
                <td>{{ r.solicitante }}</td>
                <td class="n">{{ r.renglones }}</td>
                <td class="n fuerte">{{ miles(r.despachado || r.solicitado) }}</td>
                <td class="n" @click.stop><RouterLink :to="`/imprimir/requisicion/${r.id}`" target="_blank" class="b-btn secundario chico" aria-label="Imprimir"><Icono nombre="imprimir" :tamano="16" /></RouterLink></td>
              </tr>
              <tr v-if="!mostradas.length"><td colspan="7" class="b-vacio">{{ soloSinNumero ? 'Todas tienen número.' : 'Todavía no hay entregas.' }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <aside v-if="abierta" class="b-panel">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">{{ abierta.unidadSeccion }}</h2>
          <span class="text-sm text-apagado">{{ fecha(abierta.fechaSolicitud) }}</span>
        </header>
        <div class="b-panel-cuerpo space-y-3">
          <form class="flex items-end gap-2" @submit.prevent="guardarNumero">
            <div class="flex-1">
              <label for="nro" class="b-etiqueta">No. del formulario</label>
              <input id="nro" v-model="numero" required maxlength="20" class="b-campo font-mono" />
            </div>
            <button type="submit" class="b-btn secundario" :disabled="!numero.trim() || numero.trim() === abierta.numero">Guardar</button>
          </form>
          <p class="text-sm text-apagado">Solicitó {{ abierta.solicitante }}<template v-if="abierta.despachadaPor"> · entregó {{ abierta.despachadaPor }}</template></p>
          <ul class="renglones">
            <li v-for="g in abierta.renglones" :key="g.id">
              <span class="flex-1"><b>{{ g.descripcion }}</b>
                <small><span v-for="l in g.lotes" :key="l.loteId" class="mr-2 font-mono">lote {{ l.numeroLote }} ×{{ l.cantidad }}</span></small>
              </span>
              <strong class="tabular-nums">{{ miles(g.cantidadDespachada ?? g.cantidadSolicitada) }}</strong>
            </li>
          </ul>
          <RouterLink :to="`/imprimir/requisicion/${abierta.id}`" target="_blank" class="b-btn primario w-full"><Icono nombre="imprimir" :tamano="18" /> Imprimir en el formulario</RouterLink>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.pendientes { display: flex; flex-wrap: wrap; gap: 8px; }
.pendiente { display: grid; min-width: 180px; padding: 8px 14px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 14px; background: #fff; text-align: left; }
.pendiente b { font-size: 15px; font-weight: 900; color: #14244A; }
.pendiente small { font-size: 13px; font-weight: 700; color: #64748B; }
.pendiente.on { border-color: #E8930C; border-bottom-color: #B4610A; background: #FFF6E6; }
.pest-pedidos.hay { background: #FFF1DC; color: #8A4B00; }
.pest-pedidos.hay.on { background: #E8930C; color: #fff; }
.cuenta-pedidos { display: inline-grid; place-items: center; min-width: 22px; height: 22px; margin-left: 4px; padding: 0 6px; border-radius: 11px; background: #D64545; color: #fff; font-size: 12.5px; font-weight: 900; }
.pest-pedidos.hay.on .cuenta-pedidos { background: #fff; color: #B4610A; }
.no-imprime { margin-left: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: none; color: #94A3B8; }
.lote-celda { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.lote-celda .lotes-salen { margin-bottom: 0; }
.lote-celda .lote-sel { width: auto; max-width: 260px; }
.lotes-salen { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.lote-chip { padding: 2px 8px; border-radius: 7px; background: #EAF7F0; color: #145C3C; font-size: 12px; font-weight: 600; white-space: nowrap; }
.lote-chip b { font-family: 'IBM Plex Mono', monospace; font-weight: 700; }
.lote-sel { width: 100%; height: 32px; padding: 0 6px; border: 2px solid #E2E8F0; border-radius: 9px; font-size: 12px; font-weight: 600; color: #334155; background: #fff; }
.lote-sel.falta { border-color: #D64545; }
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
.rejilla-lista { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla, .rejilla-lista { grid-template-columns: 1fr; } }
.lista { max-height: max(400px, calc(100vh - 320px)); }
.agregar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding: 12px; border: 2px dashed #CBD5E1; border-radius: 14px; background: #F8FAFC; }
.elegido { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 6px 0 12px; border: 2px solid #172A5A; border-radius: 10px; background: #EEF2FA; }
.quitar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: #64748B; }
.quitar:hover { background: #FDECEC; color: #C03535; }
.celda { width: 90px; height: 36px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 8px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.falta { color: #B42318; font-weight: 700; }
.activa td { background: #EEF2FA; }
.reparto { max-height: 340px; overflow-y: auto; }
.reparto li { display: flex; align-items: center; gap: 10px; min-height: 46px; border-top: 1px solid #EEF2F6; }
.renglones li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #EEF2F6; }
.renglones b { display: block; font-size: 14px; color: #14244A; }
.renglones small { display: block; font-size: 12px; color: #64748B; }
/* --- Relieve (estilo duo) --- */
.elegido { border-bottom-width: 4px; border-bottom-color: #0B163A; border-radius: 14px; }
.celda { border-radius: 10px; }
</style>
