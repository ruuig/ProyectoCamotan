<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import { useAuthStore } from '../../stores/auth';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/**
 * Requisición Despacho de Almacén (FOR-ASE-01). Es lo que antes se llamaba
 * traslado, y va en dos direcciones:
 *   - un servicio (o la farmacia) pide a la bodega: se autoriza y se
 *     despacha por los lotes que vencen primero;
 *   - la bodega pide al almacén de la DDRISS: lo que llega se recibe desde
 *     la misma requisición y entra con sus lotes.
 * El número es el del formulario impreso: se anota, no se inventa.
 */
const auth = useAuthStore();
const esBodega = computed(() => auth.rol !== 'farmacia');

const vista = ref('pendientes');
const lista = ref([]);
const tipos = ref([]);
const servicios = ref([]);
const insumos = ref([]);
const error = ref('');
const aviso = ref('');
const ocupado = ref(false);

const ESTADO = {
  solicitada: { texto: 'Solicitada', clase: 'amarillo' },
  autorizada: { texto: 'Autorizada', clase: 'azul' },
  despachada: { texto: 'Despachada', clase: 'verde' },
  parcial: { texto: 'Llegó una parte', clase: 'azul' },
  recibida: { texto: 'Recibida', clase: 'verde' },
  anulada: { texto: 'Anulada', clase: 'gris' },
};
const ALMACEN = 'Almacén DDRISS Chiquimula';

const hoy = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const entero = (v) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
const clave = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const quienPide = (r) => (r.direccion === 'superior' ? `Bodega → ${r.almacen ?? ALMACEN}` : r.unidadSeccion);

async function cargar() {
  try {
    const [r, u, i] = await Promise.all([bodega.requisiciones(), bodega.ubicaciones().catch(() => ({ ubicaciones: [] })), inventario.insumos()]);
    lista.value = r.requisiciones;
    tipos.value = r.tipos;
    servicios.value = [
      ...u.ubicaciones.filter((x) => x.tipo === 'centro_salud').map((x) => ({ ...x, nombre: 'Farmacia (post-consulta)' })),
      ...(esBodega.value ? u.ubicaciones.filter((x) => x.reporta) : []),
    ];
    insumos.value = i.insumos.map((x) => ({ ...x, saldoTotal: x.saldoBodega ?? x.saldoTotal }));
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const pendientes = computed(() => lista.value.filter((r) => ['solicitada', 'autorizada', 'parcial'].includes(r.estado)));
const mostradas = computed(() => (vista.value === 'pendientes' ? pendientes.value : lista.value));

// --- Nueva requisición ---------------------------------------------------------------
const VACIA = () => ({
  direccion: 'servicio', almacen: ALMACEN, numero: '', ubicacionId: '', unidadSeccion: '', fechaSolicitud: hoy(),
  solicitante: '', jefe: '', tipos: [], observaciones: '',
});
const nueva = reactive(VACIA());
const renglones = ref([]);
const elegido = ref(null);
const cantidad = ref('');
const libre = reactive({ descripcion: '', unidadMedida: 'Unidad', cantidad: '' });
const haciaArriba = computed(() => nueva.direccion === 'superior');

function limpiar() {
  Object.assign(nueva, VACIA());
  renglones.value = [];
}

async function elegirInsumo(i) {
  elegido.value = i;
  await nextTick();
  document.getElementById('cant-req')?.focus();
}

function sumarRenglon(insumo, n) {
  const ya = renglones.value.find((r) => r.insumoId === insumo.id);
  if (ya) ya.cantidadSolicitada += n;
  else renglones.value.push({ insumoId: insumo.id, descripcion: insumo.nombreGenerico, unidadMedida: insumo.unidadEntrega, cantidadSolicitada: n, enBodega: insumo.saldoTotal });
}

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
  renglones.value.push({ insumoId: null, descripcion: libre.descripcion.trim(), unidadMedida: libre.unidadMedida || 'Unidad', cantidadSolicitada: n, enBodega: null });
  Object.assign(libre, { descripcion: '', unidadMedida: 'Unidad', cantidad: '' });
}

async function registrar() {
  error.value = '';
  aviso.value = '';
  ocupado.value = true;
  try {
    const r = await bodega.crearRequisicion({
      ...nueva,
      ubicacionId: haciaArriba.value ? null : Number(nueva.ubicacionId),
      numero: nueva.numero.trim() || null,
      renglones: renglones.value.map(({ insumoId, descripcion, unidadMedida, cantidadSolicitada }) => ({
        insumoId, descripcion: insumoId ? null : descripcion, unidadMedida: insumoId ? null : unidadMedida, cantidadSolicitada: entero(cantidadSolicitada),
      })),
    }, clave('requisicion'));
    aviso.value = `Requisición ${r.requisicion.numero ?? 'sin número'} registrada.`;
    limpiar();
    await cargar();
    await abrir(r.requisicion.id);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    ocupado.value = false;
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

/** Lleva una fila del reparto a una requisición nueva de ese servicio. */
function usarFila(f) {
  limpiar();
  nueva.ubicacionId = f.ubicacionId;
  sumarRenglon(reparto.insumo, f.cantidad);
  vista.value = 'nueva';
}

// --- Detalle: autorizar, despachar, recibir, anular -------------------------------
const abierta = ref(null);
const existencias = ref({});
const despacho = reactive({ numero: '', recibidoPor: '' });
const recepcion = reactive({ completa: false });
const anulando = ref(false);
const motivo = ref('');

async function abrir(id) {
  error.value = '';
  try {
    const r = await bodega.requisicion(id);
    abierta.value = {
      ...r.requisicion,
      renglones: r.requisicion.renglones.map((g) => ({
        ...g,
        autorizar: g.cantidadAutorizada ?? Math.min(g.cantidadSolicitada, r.existencias[g.insumoId]?.enBodega ?? g.cantidadSolicitada),
        // Lo que llega de la DDRISS: lotes del catálogo, o solo la cantidad.
        llegan: g.insumoId ? [{ numeroLote: '', fechaVence: '', cantidad: '', costoUnitario: '' }] : [],
        llegaCantidad: '',
      })),
    };
    existencias.value = r.existencias;
    Object.assign(despacho, { numero: r.requisicion.numero ?? '', recibidoPor: r.requisicion.direccion === 'superior' ? '' : r.requisicion.solicitante });
    recepcion.completa = false;
    anulando.value = false;
    vista.value = 'detalle';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const superior = computed(() => abierta.value?.direccion === 'superior');
const editable = computed(() => ['solicitada', 'autorizada'].includes(abierta.value?.estado));
const recibible = computed(() => superior.value && ['solicitada', 'autorizada', 'parcial'].includes(abierta.value?.estado));

async function autorizar() {
  error.value = '';
  try {
    const r = await bodega.autorizarRequisicion(abierta.value.id, abierta.value.renglones.map((g) => ({ id: g.id, cantidadAutorizada: entero(g.autorizar) })));
    aviso.value = `Requisición ${r.requisicion.numero ?? ''} autorizada.`;
    await abrir(abierta.value.id);
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function despachar() {
  error.value = '';
  ocupado.value = true;
  try {
    const r = await bodega.despacharRequisicion(abierta.value.id, {
      numero: despacho.numero.trim() || null,
      recibidoPor: despacho.recibidoPor,
      renglones: abierta.value.renglones.map((g) => ({ id: g.id, cantidadDespachada: entero(g.autorizar) })),
    }, clave('despacho'));
    aviso.value = `Requisición ${r.requisicion.numero} despachada.`;
    await abrir(abierta.value.id);
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    ocupado.value = false;
  }
}

async function recibir() {
  error.value = '';
  ocupado.value = true;
  try {
    const renglonesRecibidos = abierta.value.renglones.map((g) => ({
      id: g.id,
      ...(g.insumoId
        ? {
          lotes: g.llegan.filter((l) => l.numeroLote.trim() && entero(l.cantidad)).map((l) => ({
            numeroLote: l.numeroLote.trim(), fechaVence: l.fechaVence, cantidad: entero(l.cantidad),
            costoUnitario: l.costoUnitario === '' ? null : Number(l.costoUnitario),
          })),
        }
        : { cantidad: entero(g.llegaCantidad) }),
    })).filter((g) => (g.lotes ? g.lotes.length : g.cantidad));
    if (!renglonesRecibidos.length) {
      error.value = 'Anote al menos un lote o una cantidad recibida.';
      return;
    }
    const r = await bodega.recibirRequisicion(abierta.value.id, {
      numero: despacho.numero.trim() || null,
      recibidoPor: despacho.recibidoPor.trim() || null,
      completa: recepcion.completa,
      renglones: renglonesRecibidos,
    }, clave('recepcion'));
    aviso.value = `Recepción registrada: la requisición quedó ${ESTADO[r.requisicion.estado].texto.toLowerCase()}.`;
    await abrir(abierta.value.id);
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    ocupado.value = false;
  }
}

async function anular() {
  error.value = '';
  try {
    await bodega.anularRequisicion(abierta.value.id, motivo.value.trim());
    aviso.value = 'Requisición anulada.';
    motivo.value = '';
    await abrir(abierta.value.id);
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargar);
</script>

<template>
  <section>
    <header class="b-cabecera">
      <h1 class="b-titulo">Requisiciones</h1>
      <div class="flex flex-wrap items-center gap-2">
        <div class="b-segmentado" role="radiogroup" aria-label="Vista">
          <button v-for="m in [['pendientes', `Por atender (${pendientes.length})`], ['nueva', 'Nueva requisición'], ['todas', `Registradas (${lista.length})`]]" :key="m[0]" type="button" role="radio" :aria-checked="vista === m[0]" :class="vista === m[0] ? 'on' : ''" @click="vista = m[0]">{{ m[1] }}</button>
        </div>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4" aria-live="polite">{{ aviso }}</p>

    <!-- Lista -->
    <div v-if="vista === 'pendientes' || vista === 'todas'" class="b-tabla-marco lista mt-5">
      <table class="b-tabla">
        <thead><tr><th>No.</th><th>Fecha</th><th>Quién pide</th><th>Solicitante</th><th class="n">Renglones</th><th class="n">Solicitado</th><th class="n">Entregado</th><th>Estado</th><th /></tr></thead>
        <tbody>
          <tr v-for="r in mostradas" :key="r.id" class="cursor-pointer" @click="abrir(r.id)">
            <td class="whitespace-nowrap font-mono font-semibold text-[#172A5A]">{{ r.numero ?? '—' }}</td>
            <td class="whitespace-nowrap">{{ fecha(r.fechaSolicitud) }}</td>
            <td class="font-semibold text-tinta">
              <span v-if="r.direccion === 'superior'" class="sentido arriba" title="Pedida a la DDRISS">↑</span>
              <span v-else class="sentido" title="Pedida a la bodega">↓</span>
              {{ quienPide(r) }}
            </td>
            <td>{{ r.solicitante }}</td>
            <td class="n">{{ r.renglones }}</td>
            <td class="n">{{ miles(r.solicitado) }}</td>
            <td class="n fuerte">{{ r.despachado ? miles(r.despachado) : '' }}</td>
            <td><span class="estado" :class="ESTADO[r.estado].clase">{{ ESTADO[r.estado].texto }}</span></td>
            <td class="n" @click.stop><RouterLink :to="`/imprimir/requisicion/${r.id}`" target="_blank" class="b-btn secundario chico" aria-label="Imprimir"><Icono nombre="imprimir" :tamano="16" /></RouterLink></td>
          </tr>
          <tr v-if="!mostradas.length"><td colspan="9" class="b-vacio">{{ vista === 'pendientes' ? 'No hay requisiciones por atender.' : 'Todavía no hay requisiciones.' }}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Nueva -->
    <div v-else-if="vista === 'nueva'" class="rejilla mt-5">
      <form class="space-y-4" @submit.prevent="registrar">
        <div v-if="esBodega" class="b-segmentado w-full" role="radiogroup" aria-label="Quién pide">
          <button type="button" role="radio" class="flex-1" :aria-checked="!haciaArriba" :class="!haciaArriba ? 'on' : ''" @click="nueva.direccion = 'servicio'">↓ Un servicio pide a bodega</button>
          <button type="button" role="radio" class="flex-1" :aria-checked="haciaArriba" :class="haciaArriba ? 'on' : ''" @click="nueva.direccion = 'superior'">↑ Bodega pide a la DDRISS</button>
        </div>

        <div class="grid gap-3 sm:grid-cols-12">
          <div class="sm:col-span-3">
            <label for="num" class="b-etiqueta">No. del formulario</label>
            <input id="num" v-model="nueva.numero" maxlength="20" placeholder="016618" class="b-campo font-mono" />
          </div>
          <div v-if="haciaArriba" class="sm:col-span-5">
            <label for="alm" class="b-etiqueta">Se pide a</label>
            <input id="alm" v-model="nueva.almacen" required maxlength="160" class="b-campo" />
          </div>
          <div v-else class="sm:col-span-5">
            <label for="serv" class="b-etiqueta">Servicio que pide</label>
            <select id="serv" v-model="nueva.ubicacionId" required class="b-campo">
              <option value="">Elija</option>
              <option v-for="s in servicios" :key="s.id" :value="s.id">{{ s.nombre }}</option>
            </select>
          </div>
          <div class="sm:col-span-4">
            <label for="fsol" class="b-etiqueta">Fecha de solicitud</label>
            <input id="fsol" v-model="nueva.fechaSolicitud" type="date" required class="b-campo" />
          </div>
          <div class="sm:col-span-4">
            <label for="unidad" class="b-etiqueta">Unidad / sección</label>
            <input id="unidad" v-model="nueva.unidadSeccion" maxlength="160" :placeholder="haciaArriba ? 'Oficina Bodega C/S Camotán' : 'Como dice el formulario'" class="b-campo" />
          </div>
          <div class="sm:col-span-4">
            <label for="sol" class="b-etiqueta">Solicitante</label>
            <input id="sol" v-model="nueva.solicitante" required minlength="3" maxlength="160" placeholder="A.E. Nombre Apellido" class="b-campo" />
          </div>
          <div class="sm:col-span-4">
            <label for="jefe" class="b-etiqueta">Coordinador / jefe</label>
            <input id="jefe" v-model="nueva.jefe" maxlength="160" class="b-campo" />
          </div>
          <fieldset class="sm:col-span-12">
            <legend class="b-etiqueta">Se pide</legend>
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <label v-for="t in tipos" :key="t.valor" class="flex items-center gap-1"><input v-model="nueva.tipos" type="checkbox" :value="t.valor" /> {{ t.etiqueta }}</label>
            </div>
          </fieldset>
        </div>

        <div class="agregar">
          <div class="min-w-0 flex-1">
            <span class="b-etiqueta">Del catálogo</span>
            <div v-if="elegido" class="elegido">
              <span class="min-w-0 flex-1 truncate font-semibold text-tinta">{{ elegido.nombreGenerico }}</span>
              <span class="text-[13px] font-semibold text-apagado">bodega {{ miles(elegido.saldoTotal) }}</span>
              <button type="button" class="quitar" aria-label="Cambiar" @click="elegido = null"><Icono nombre="cerrar" :tamano="16" /></button>
            </div>
            <BuscadorInsumo v-else :insumos="insumos" placeholder="Buscar insumo" @elegir="elegirInsumo" />
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
            <thead><tr><th class="n">No.</th><th>Descripción del artículo</th><th>Unidad</th><th class="n">Solicitada</th><th class="n">En bodega</th><th /></tr></thead>
            <tbody>
              <tr v-for="(r, i) in renglones" :key="i">
                <td class="n">{{ i + 1 }}</td>
                <td class="font-semibold text-tinta">{{ r.descripcion }}</td>
                <td>{{ r.unidadMedida }}</td>
                <td class="n"><input v-model.number="r.cantidadSolicitada" inputmode="numeric" class="celda" :aria-label="`Cantidad de ${r.descripcion}`" /></td>
                <td class="n" :class="!haciaArriba && r.enBodega != null && r.enBodega < r.cantidadSolicitada ? 'falta' : ''">{{ r.enBodega == null ? '—' : miles(r.enBodega) }}</td>
                <td class="n"><button type="button" class="quitar" aria-label="Quitar" @click="renglones.splice(i, 1)"><Icono nombre="cerrar" :tamano="16" /></button></td>
              </tr>
              <tr v-if="!renglones.length"><td colspan="6" class="b-vacio">Copie los renglones del formulario.</td></tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap gap-2">
          <input v-model="nueva.observaciones" maxlength="1000" placeholder="Observaciones: Procedente donación OPS/OMS…" aria-label="Observaciones" class="b-campo min-w-[12rem] flex-1" />
          <button type="submit" class="b-btn primario" :disabled="ocupado || !renglones.length || (!haciaArriba && !nueva.ubicacionId)">Registrar requisición</button>
        </div>
      </form>

      <!-- Repartir entre servicios -->
      <aside v-if="esBodega" class="b-panel">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Repartir un insumo</h2></header>
        <div class="b-panel-cuerpo space-y-3">
          <div v-if="reparto.insumo" class="elegido">
            <span class="min-w-0 flex-1 truncate font-semibold text-tinta">{{ reparto.insumo.nombreGenerico }}</span>
            <button type="button" class="quitar" aria-label="Cambiar insumo" @click="reparto.insumo = null; propuesta = null"><Icono nombre="cerrar" :tamano="16" /></button>
          </div>
          <BuscadorInsumo v-else :insumos="insumos" placeholder="Insumo a repartir" @elegir="(i) => (reparto.insumo = i)" />
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
            <p v-if="propuesta.aviso" class="b-aviso atencion text-sm">{{ propuesta.aviso }}</p>
            <ul class="reparto">
              <li v-for="f in propuesta.filas" :key="f.ubicacionId">
                <span class="min-w-0 flex-1 truncate text-sm font-semibold text-tinta">{{ f.nombre }}</span>
                <strong class="tabular-nums text-tinta">{{ miles(f.cantidad) }}</strong>
                <button v-if="f.cantidad > 0" type="button" class="b-btn secundario chico" @click="usarFila(f)">Usar</button>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>

    <!-- Detalle -->
    <div v-else-if="vista === 'detalle' && abierta" class="mt-5 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xl font-bold text-tinta">
            No. <span class="font-mono">{{ abierta.numero ?? 'sin número' }}</span> · {{ superior ? `Bodega pide a ${abierta.almacen}` : abierta.unidadSeccion }}
            <span class="estado ml-2" :class="ESTADO[abierta.estado].clase">{{ ESTADO[abierta.estado].texto }}</span>
          </p>
          <p class="text-sm text-apagado">
            Solicitó {{ abierta.solicitante }} el {{ fecha(abierta.fechaSolicitud) }}
            <template v-if="abierta.autorizadaPor && !superior"> · autorizó {{ abierta.autorizadaPor }}</template>
            <template v-if="abierta.despachadaPor"> · {{ superior ? 'recibió' : 'despachó' }} {{ abierta.despachadaPor }}</template>
            <template v-if="abierta.recibidoPor && !superior">, recibió {{ abierta.recibidoPor }}</template>
            <template v-if="abierta.observaciones"> · {{ abierta.observaciones }}</template>
            <template v-if="abierta.motivoAnulacion"> · anulada: {{ abierta.motivoAnulacion }}</template>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="b-btn secundario chico" @click="vista = 'pendientes'">Volver a la lista</button>
          <RouterLink :to="`/imprimir/requisicion/${abierta.id}`" target="_blank" class="b-btn primario chico"><Icono nombre="imprimir" :tamano="16" /> Imprimir en el formulario</RouterLink>
        </div>
      </div>

      <div class="b-tabla-marco">
        <table class="b-tabla">
          <thead>
            <tr>
              <th class="n">No.</th><th>Descripción del artículo</th><th>Unidad</th><th class="n">Solicitada</th>
              <template v-if="!superior">
                <th class="n">{{ editable && esBodega ? 'Autorizar' : 'Autorizada' }}</th><th class="n">Despachada</th>
                <th class="n">En bodega</th><th class="n">A cada lugar</th>
              </template>
              <th v-else class="n">Recibida</th>
              <th>Lotes</th>
              <th v-if="recibible && esBodega">Llega ahora</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in abierta.renglones" :key="g.id">
              <td class="n">{{ g.orden }}</td>
              <td class="font-semibold text-tinta">{{ g.descripcion }}</td>
              <td>{{ g.unidadMedida }}</td>
              <td class="n">{{ miles(g.cantidadSolicitada) }}</td>
              <template v-if="!superior">
                <td class="n">
                  <input v-if="editable && esBodega" v-model="g.autorizar" inputmode="numeric" class="celda" :aria-label="`Autorizar ${g.descripcion}`" />
                  <template v-else>{{ g.cantidadAutorizada ?? '' }}</template>
                </td>
                <td class="n fuerte">{{ g.cantidadDespachada ?? '' }}</td>
                <td class="n" :class="g.insumoId && editable && (existencias[g.insumoId]?.enBodega ?? 0) < entero(g.autorizar) ? 'falta' : ''">{{ g.insumoId ? miles(existencias[g.insumoId]?.enBodega ?? 0) : '—' }}</td>
                <td class="n">{{ g.insumoId ? miles(existencias[g.insumoId]?.aCadaLugar ?? 0) : '' }}</td>
              </template>
              <td v-else class="n fuerte">{{ g.cantidadDespachada ?? '' }}</td>
              <td class="text-xs">
                <span v-for="l in g.lotes" :key="l.loteId" class="mr-2 whitespace-nowrap font-mono">{{ l.numeroLote }} ×{{ l.cantidad }}</span>
              </td>
              <td v-if="recibible && esBodega" class="llega">
                <template v-if="g.insumoId">
                  <div v-for="(l, k) in g.llegan" :key="k" class="flex flex-wrap gap-1.5 py-0.5">
                    <input v-model="l.numeroLote" placeholder="Lote" :aria-label="`Lote de ${g.descripcion}`" class="b-campo chico w-[110px]" />
                    <input v-model="l.fechaVence" type="date" :aria-label="`Vence ${g.descripcion}`" class="b-campo chico w-[150px]" />
                    <input v-model="l.cantidad" inputmode="numeric" placeholder="Cant." :aria-label="`Cantidad ${g.descripcion}`" class="b-campo chico num w-[80px]" />
                    <input v-model="l.costoUnitario" inputmode="decimal" placeholder="Q c/u" :aria-label="`Precio ${g.descripcion}`" class="b-campo chico num w-[80px]" />
                  </div>
                  <button type="button" class="text-xs font-semibold text-[#172A5A] underline" @click="g.llegan.push({ numeroLote: '', fechaVence: '', cantidad: '', costoUnitario: '' })">+ otro lote</button>
                </template>
                <input v-else v-model="g.llegaCantidad" inputmode="numeric" placeholder="Cant." :aria-label="`Recibido ${g.descripcion}`" class="b-campo chico num w-[80px]" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="esBodega && (editable || recibible)" class="flex flex-wrap items-end gap-3">
        <div class="w-[150px]">
          <label for="dnum" class="b-etiqueta">No. del formulario</label>
          <input id="dnum" v-model="despacho.numero" maxlength="20" class="b-campo font-mono" />
        </div>
        <template v-if="!superior">
          <div class="min-w-[14rem] flex-1">
            <label for="drec" class="b-etiqueta">Recibe conforme</label>
            <input id="drec" v-model="despacho.recibidoPor" minlength="3" maxlength="160" class="b-campo" />
          </div>
          <button v-if="abierta.estado === 'solicitada'" type="button" class="b-btn secundario" @click="autorizar">Solo autorizar</button>
          <button type="button" class="b-btn primario" :disabled="ocupado || !despacho.numero.trim() || despacho.recibidoPor.trim().length < 3" @click="despachar">
            <Icono nombre="trasladar" :tamano="18" /> {{ ocupado ? 'Despachando…' : 'Despachar' }}
          </button>
        </template>
        <template v-else>
          <label class="flex items-center gap-2 text-sm font-semibold"><input v-model="recepcion.completa" type="checkbox" /> Ya llegó todo: cerrar la requisición</label>
          <button type="button" class="b-btn primario" :disabled="ocupado" @click="recibir">
            <Icono nombre="recibir" :tamano="18" /> {{ ocupado ? 'Registrando…' : 'Registrar lo recibido' }}
          </button>
        </template>
        <template v-if="editable">
          <button v-if="!anulando" type="button" class="b-btn secundario" @click="anulando = true">Anular</button>
          <form v-else class="flex flex-1 flex-wrap items-end gap-2" @submit.prevent="anular">
            <input v-model="motivo" required minlength="5" placeholder="Por qué se anula" aria-label="Motivo" class="b-campo min-w-[14rem] flex-1" />
            <button type="button" class="b-btn secundario" @click="anulando = false">No anular</button>
            <button type="submit" class="b-btn primario" :disabled="motivo.trim().length < 5">Anular requisición</button>
          </form>
        </template>
      </div>
      <div v-else-if="!esBodega && editable" class="flex gap-2">
        <button v-if="!anulando" type="button" class="b-btn secundario" @click="anulando = true">Anular</button>
        <form v-else class="flex flex-1 flex-wrap items-end gap-2" @submit.prevent="anular">
          <input v-model="motivo" required minlength="5" placeholder="Por qué se anula" aria-label="Motivo" class="b-campo min-w-[14rem] flex-1" />
          <button type="submit" class="b-btn primario" :disabled="motivo.trim().length < 5">Anular requisición</button>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lista { max-height: max(400px, calc(100vh - 300px)); }
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.agregar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding: 12px; border: 2px dashed #CBD5E1; border-radius: 14px; background: #F8FAFC; }
.elegido { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 6px 0 12px; border: 2px solid #172A5A; border-radius: 10px; background: #EEF2FA; }
.quitar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: #64748B; }
.quitar:hover { background: #FDECEC; color: #C03535; }
.celda { width: 90px; height: 36px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 8px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.falta { color: #B42318; font-weight: 700; }
.sentido { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 4px; border-radius: 6px; background: #EEF2F6; color: #475569; font-weight: 800; }
.sentido.arriba { background: #E3EAFB; color: #172A5A; }
.estado { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; white-space: nowrap; }
.estado.amarillo { background: #FFF4D6; color: #7A4F05; }
.estado.azul { background: #E3EAFB; color: #172A5A; }
.estado.verde { background: #E2F5EA; color: #145C3C; }
.estado.gris { background: #EEF2F6; color: #64748B; }
.reparto { max-height: 340px; overflow-y: auto; }
.reparto li { display: flex; align-items: center; gap: 10px; min-height: 46px; border-top: 1px solid #EEF2F6; }
.llega { min-width: 440px; }
.b-campo.chico { height: 34px; padding: 0 8px; font-size: 14px; }
</style>
