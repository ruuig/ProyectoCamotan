<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import { useAuthStore } from '../../stores/auth';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/**
 * Requisiciones: la bodega registra lo que entrega y el sistema genera la
 * requisición (FOR-ASE-01) lista para imprimir sobre el formulario.
 * Sale de los lotes que vencen primero. El número del formulario se puede
 * anotar después.
 */
const route = useRoute();
const auth = useAuthStore();
const esBodega = computed(() => auth.rol !== 'farmacia');

const vista = ref(route.query.ver === 'sin_numero' ? 'registradas' : 'nueva');
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
    tipos.value = r.tipos;
    lugares.value = u.ubicaciones
      .filter((x) => x.activo !== false && (x.tipo === 'centro_salud' || (esBodega.value && (x.tipo === 'unidad_interna' || x.reporta))))
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
const elegido = ref(null);
const cantidad = ref('');
const libre = reactive({ descripcion: '', unidadMedida: 'Unidad', cantidad: '' });
const ultima = ref(null);

// Al elegir el lugar se propone quien firmó la última vez.
watch(() => nueva.ubicacionId, (id) => {
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
  const ya = renglones.value.find((r) => r.insumoId === insumo.id);
  if (ya) ya.cantidad += n;
  else renglones.value.push({ insumoId: insumo.id, descripcion: insumo.nombreGenerico, unidadMedida: insumo.unidadEntrega, cantidad: n, enBodega: insumo.saldoTotal });
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
  renglones.value.push({ insumoId: null, descripcion: libre.descripcion.trim(), unidadMedida: libre.unidadMedida || 'Unidad', cantidad: n, enBodega: null });
  Object.assign(libre, { descripcion: '', unidadMedida: 'Unidad', cantidad: '' });
}

const noAlcanza = computed(() => renglones.value.filter((r) => r.enBodega != null && r.enBodega < entero(r.cantidad)));

async function entregar() {
  error.value = '';
  aviso.value = '';
  enviando.value = true;
  try {
    const r = await bodega.entregar({
      ...nueva,
      ubicacionId: Number(nueva.ubicacionId),
      numero: nueva.numero.trim() || null,
      renglones: renglones.value.map(({ insumoId, descripcion, unidadMedida, cantidad: c }) => ({
        insumoId, descripcion: insumoId ? null : descripcion, unidadMedida: insumoId ? null : unidadMedida, cantidad: entero(c),
      })),
    }, `entrega-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    ultima.value = r.requisicion;
    aviso.value = `Entregado a ${r.requisicion.unidadSeccion}.${r.requisicion.numero ? '' : ' Falta anotar el número del formulario.'}`;
    Object.assign(nueva, VACIA());
    renglones.value = [];
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
const mostradas = computed(() => (soloSinNumero.value ? lista.value.filter((r) => !r.numero && r.estado !== 'anulada') : lista.value));
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

onMounted(cargar);
</script>

<template>
  <section>
    <header class="b-cabecera">
      <h1 class="b-titulo">Requisiciones</h1>
      <div class="b-segmentado" role="radiogroup" aria-label="Vista">
        <button v-for="m in [['nueva', 'Entregar'], ['registradas', `Entregadas (${lista.length})`]]" :key="m[0]" type="button" role="radio" :aria-checked="vista === m[0]" :class="vista === m[0] ? 'on' : ''" @click="vista = m[0]">{{ m[1] }}</button>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <div v-if="aviso" class="b-aviso ok mt-4 items-center justify-between" aria-live="polite">
      <span>{{ aviso }}</span>
      <RouterLink v-if="ultima" :to="`/imprimir/requisicion/${ultima.id}`" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Imprimir otra vez</RouterLink>
    </div>

    <!-- Entregar -->
    <div v-if="vista === 'nueva'" class="rejilla mt-5">
      <form class="space-y-4" @submit.prevent="entregar">
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
              <span class="min-w-0 flex-1 truncate font-semibold text-tinta">{{ elegido.nombreGenerico }}</span>
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
            <thead><tr><th class="n">No.</th><th>Descripción del artículo</th><th>Unidad</th><th class="n">Cantidad</th><th class="n">En bodega</th><th /></tr></thead>
            <tbody>
              <tr v-for="(r, i) in renglones" :key="i">
                <td class="n">{{ i + 1 }}</td>
                <td class="font-semibold text-tinta">{{ r.descripcion }}</td>
                <td>{{ r.unidadMedida }}</td>
                <td class="n"><input v-model.number="r.cantidad" inputmode="numeric" class="celda" :aria-label="`Cantidad de ${r.descripcion}`" /></td>
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
            <span class="min-w-0 flex-1 truncate font-semibold text-tinta">{{ reparto.insumo.nombreGenerico }}</span>
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
                <span class="min-w-0 flex-1 truncate text-sm font-semibold text-tinta">{{ f.nombre }}</span>
                <strong class="tabular-nums text-tinta">{{ miles(f.cantidad) }}</strong>
                <button v-if="f.cantidad > 0" type="button" class="b-btn secundario chico" @click="usarFila(f)">Usar</button>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>

    <!-- Entregadas -->
    <div v-else class="rejilla-lista mt-5">
      <div>
        <label class="mb-2 flex items-center gap-2 text-sm font-semibold"><input v-model="soloSinNumero" type="checkbox" /> Solo las que no tienen número de formulario</label>
        <div class="b-tabla-marco lista">
          <table class="b-tabla">
            <thead><tr><th>No.</th><th>Fecha</th><th>Se entregó a</th><th>Solicitante</th><th class="n">Renglones</th><th class="n">Unidades</th><th /></tr></thead>
            <tbody>
              <tr v-for="r in mostradas" :key="r.id" class="cursor-pointer" :class="abierta?.id === r.id ? 'activa' : ''" @click="abrir(r.id)">
                <td class="whitespace-nowrap font-mono font-semibold" :class="r.numero ? 'text-[#172A5A]' : 'falta'">{{ r.numero ?? 'sin número' }}</td>
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
</style>
