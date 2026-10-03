<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import { estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/**
 * Traslados de la bodega a los puestos y centros comunitarios.
 *
 * Cada renglón lleva su lote: si mañana hay un retiro sanitario, se sabe a
 * qué servicio fue a parar. El sistema propone el lote que vence primero
 * (PEPE); la cantidad de cada renglón se puede cambiar antes de confirmar.
 */
const modo = ref('nuevo');
const servicios = ref([]);
const insumos = ref([]);
const historial = ref([]);
const error = ref('');
const aviso = ref('');
const enviando = ref(false);
const ultimo = ref(null);

const nuevo = reactive({ ubicacionId: '', recibidoPor: '', observacion: '' });
const renglones = ref([]);
const elegido = ref(null);
const cantidad = ref('');

async function cargar() {
  try {
    const [u, i, t] = await Promise.all([bodega.ubicaciones(), inventario.insumos(), bodega.traslados()]);
    servicios.value = u.ubicaciones.filter((x) => x.reporta);
    insumos.value = i.insumos.filter((x) => x.saldoTotal > 0);
    historial.value = t.traslados;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const entero = (v) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;

async function elegirInsumo(i) {
  elegido.value = i;
  await nextTick();
  document.getElementById('cantidad-traslado')?.focus();
}

/** Agrega el insumo: el servidor propone los lotes por PEPE. */
async function agregarInsumo(insumo = elegido.value, n = entero(cantidad.value)) {
  error.value = '';
  aviso.value = '';
  if (!insumo || !n) return;
  try {
    const r = await bodega.propuestaLotes(insumo.id, n);
    if (!r.propuesta.length) {
      error.value = `No hay lotes disponibles y vigentes de ${insumo.nombreGenerico}.`;
      return;
    }
    for (const p of r.propuesta) renglones.value.push({ ...p, insumoId: insumo.id, insumo: insumo.nombreGenerico, categoria: insumo.categoria });
    if (r.faltante > 0) aviso.value = `De ${insumo.nombreGenerico} solo hay ${miles(n - r.faltante)}: faltan ${miles(r.faltante)}.`;
    elegido.value = null;
    cantidad.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const quitar = (i) => renglones.value.splice(i, 1);
const totalUnidades = computed(() => renglones.value.reduce((s, r) => s + entero(r.cantidad), 0));
const destino = computed(() => servicios.value.find((s) => s.id === Number(nuevo.ubicacionId)));

async function confirmar() {
  error.value = '';
  aviso.value = '';
  enviando.value = true;
  try {
    const r = await bodega.trasladar({
      ubicacionId: Number(nuevo.ubicacionId),
      recibidoPor: nuevo.recibidoPor,
      observacion: nuevo.observacion || null,
      renglones: renglones.value.map((x) => ({ loteId: x.loteId, cantidad: entero(x.cantidad) })),
    }, `traslado-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    aviso.value = `Traslado ${r.traslado.numero} registrado.`;
    ultimo.value = r.traslado;
    renglones.value = [];
    Object.assign(nuevo, { ubicacionId: '', recibidoPor: '', observacion: '' });
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

// --- Propuesta de distribución -------------------------------------------------
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

/** Lleva una fila de la propuesta al traslado. */
async function trasladarFila(f) {
  nuevo.ubicacionId = f.ubicacionId;
  renglones.value = [];
  await agregarInsumo(insumos.value.find((i) => i.id === propuesta.value.insumo.id), f.cantidad);
}

onMounted(cargar);
</script>

<template>
  <section>
    <header class="b-cabecera">
      <h1 class="b-titulo">Traslados</h1>
      <div class="b-segmentado" role="radiogroup" aria-label="Vista">
        <button v-for="m in [['nuevo', 'Nuevo traslado'], ['historial', `Registrados (${historial.length})`]]" :key="m[0]" type="button" role="radio" :aria-checked="modo === m[0]" :class="modo === m[0] ? 'on' : ''" @click="modo = m[0]">{{ m[1] }}</button>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <div v-if="aviso" class="b-aviso ok mt-4 items-center justify-between" aria-live="polite">
      <span>{{ aviso }}</span>
      <RouterLink v-if="ultimo" :to="`/imprimir/traslado/${ultimo.id}`" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Comprobante</RouterLink>
    </div>

    <!-- Nuevo traslado -->
    <div v-if="modo === 'nuevo'" class="rejilla mt-5">
      <form class="space-y-4" @submit.prevent="confirmar">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="destino" class="b-etiqueta">Servicio de destino</label>
            <select id="destino" v-model="nuevo.ubicacionId" required class="b-campo">
              <option value="">Elija el servicio</option>
              <option v-for="s in servicios" :key="s.id" :value="s.id">{{ s.nombre }}</option>
            </select>
          </div>
          <div>
            <label for="recibe" class="b-etiqueta">Quién recibe</label>
            <input id="recibe" v-model="nuevo.recibidoPor" required minlength="3" maxlength="160" placeholder="Nombre y cargo" class="b-campo" />
          </div>
        </div>

        <div class="agregar">
          <div class="min-w-0 flex-1">
            <span class="b-etiqueta">Insumo</span>
            <div v-if="elegido" class="elegido" :style="estiloCategoria(elegido.categoria)">
              <span class="cat-mini"><Pictograma :categoria="elegido.categoria" :grosor="2" /></span>
              <span class="min-w-0 flex-1 truncate font-semibold text-tinta">{{ elegido.nombreGenerico }}</span>
              <span class="text-[13px] font-semibold text-apagado">hay {{ miles(elegido.saldoTotal) }}</span>
              <button type="button" class="quitar" aria-label="Cambiar insumo" @click="elegido = null"><Icono nombre="cerrar" :tamano="16" :grosor="2.2" /></button>
            </div>
            <BuscadorInsumo v-else :insumos="insumos" placeholder="Buscar insumo para agregar" @elegir="elegirInsumo" />
          </div>
          <div class="w-[130px]">
            <label for="cantidad-traslado" class="b-etiqueta">Cantidad</label>
            <input id="cantidad-traslado" v-model="cantidad" inputmode="numeric" class="b-campo num" @keydown.enter.prevent="agregarInsumo()" />
          </div>
          <button type="button" class="b-btn secundario" :disabled="!elegido || !entero(cantidad)" @click="agregarInsumo()"><Icono nombre="agregar" :tamano="20" /> Agregar</button>
        </div>

        <div class="comprobante">
          <header>
            <span>{{ destino ? destino.nombre : 'Traslado' }}</span>
            <span class="tabular-nums">{{ renglones.length }} {{ renglones.length === 1 ? 'renglón' : 'renglones' }} · {{ miles(totalUnidades) }} unidades</span>
          </header>
          <table v-if="renglones.length" class="b-tabla">
            <thead><tr><th>Insumo</th><th>Lote</th><th>Vence</th><th class="n">Cantidad</th><th /></tr></thead>
            <tbody>
              <tr v-for="(r, i) in renglones" :key="`${r.loteId}-${i}`">
                <td>
                  <span class="flex items-center gap-2.5" :style="estiloCategoria(r.categoria)">
                    <span class="cat-mini"><Pictograma :categoria="r.categoria" :grosor="2" /></span>
                    <span class="font-semibold text-tinta">{{ r.insumo }}</span>
                  </span>
                </td>
                <td class="whitespace-nowrap font-mono">{{ r.numeroLote }}</td>
                <td><SelloVence :fecha="r.fechaVence" :semaforo="r.semaforo ?? 'verde'" /></td>
                <td class="n"><input v-model="r.cantidad" inputmode="numeric" :aria-label="`Cantidad del lote ${r.numeroLote}`" class="celda" /></td>
                <td class="n"><button type="button" class="quitar" :aria-label="`Quitar lote ${r.numeroLote}`" @click="quitar(i)"><Icono nombre="cerrar" :tamano="16" :grosor="2.2" /></button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="b-vacio">Agregue los insumos que se van.</p>
        </div>

        <div class="pie">
          <input v-model="nuevo.observacion" maxlength="500" placeholder="Observación" aria-label="Observación" class="b-campo min-w-[12rem] flex-1" />
          <button type="submit" class="b-btn primario" :disabled="enviando || !renglones.length || !nuevo.ubicacionId">
            <Icono nombre="trasladar" :tamano="20" :grosor="2.2" /> {{ enviando ? 'Registrando…' : 'Registrar traslado' }}
          </button>
        </div>
      </form>

      <!-- Propuesta de distribución -->
      <aside class="b-panel">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Repartir un insumo</h2></header>
        <div class="b-panel-cuerpo space-y-3">
          <div v-if="reparto.insumo" class="elegido" :style="estiloCategoria(reparto.insumo.categoria)">
            <span class="cat-mini"><Pictograma :categoria="reparto.insumo.categoria" :grosor="2" /></span>
            <span class="min-w-0 flex-1 truncate font-semibold text-tinta">{{ reparto.insumo.nombreGenerico }}</span>
            <button type="button" class="quitar" aria-label="Cambiar insumo" @click="reparto.insumo = null; propuesta = null"><Icono nombre="cerrar" :tamano="16" :grosor="2.2" /></button>
          </div>
          <BuscadorInsumo v-else :insumos="insumos" placeholder="Insumo a repartir" @elegir="(i) => (reparto.insumo = i)" />
          <div class="b-segmentado w-full" role="radiogroup" aria-label="Modo de reparto">
            <button v-for="m in [['consumo', 'Según consumo'], ['iguales', 'Partes iguales']]" :key="m[0]" type="button" role="radio" class="flex-1" :aria-checked="reparto.modo === m[0]" :class="reparto.modo === m[0] ? 'on' : ''" @click="reparto.modo = m[0]">{{ m[1] }}</button>
          </div>
          <input v-model="reparto.cantidad" inputmode="numeric" placeholder="Toda la existencia" aria-label="Cantidad a repartir" class="b-campo num" />
          <button type="button" class="b-btn secundario w-full" :disabled="!reparto.insumo" @click="proponer">Calcular reparto</button>

          <div v-if="propuesta" class="space-y-2">
            <p class="text-sm font-semibold text-tinta-2">
              {{ miles(propuesta.cantidad) }} entre {{ propuesta.filas.length }} servicios · quedan {{ miles(propuesta.sobrante) }} en bodega
            </p>
            <p v-if="propuesta.aviso" class="b-aviso atencion text-sm">{{ propuesta.aviso }}</p>
            <ul class="reparto">
              <li v-for="f in propuesta.filas" :key="f.ubicacionId">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-tinta">{{ f.nombre }}</span>
                  <span v-if="propuesta.modo === 'consumo'" class="text-xs font-semibold text-apagado">{{ miles(f.promedio) }} al mes</span>
                </span>
                <strong class="tabular-nums text-tinta">{{ miles(f.cantidad) }}</strong>
                <button v-if="f.cantidad > 0" type="button" class="b-btn secundario chico" @click="trasladarFila(f)">Usar</button>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>

    <!-- Registrados -->
    <div v-else class="b-tabla-marco historial mt-5">
      <table class="b-tabla">
        <thead><tr><th>Número</th><th>Fecha</th><th>Servicio</th><th>Recibe</th><th class="n">Renglones</th><th class="n">Unidades</th><th /></tr></thead>
        <tbody>
          <tr v-for="t in historial" :key="t.id">
            <td class="whitespace-nowrap font-mono font-semibold text-[#172A5A]">{{ t.numero }}</td>
            <td class="whitespace-nowrap">{{ fecha(t.registradoEn) }}</td>
            <td class="font-semibold text-tinta">{{ t.ubicacion }}</td>
            <td>{{ t.recibidoPor }}</td>
            <td class="n">{{ t.renglones }}</td>
            <td class="n fuerte">{{ miles(t.unidades) }}</td>
            <td class="n"><RouterLink :to="`/imprimir/traslado/${t.id}`" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Comprobante</RouterLink></td>
          </tr>
          <tr v-if="!historial.length"><td colspan="7" class="b-vacio">Todavía no hay traslados.</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.agregar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding: 14px; border: 2px dashed #CBD5E1; border-radius: 14px; background: #F8FAFC; }
.elegido { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 6px 0 10px; border: 2px solid var(--cat); border-radius: 10px; background: var(--cat-fondo); }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 26px; height: 26px; border-radius: 7px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 16px; height: 16px; }
.quitar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: #64748B; }
.quitar:hover { background: #FDECEC; color: #C03535; }
.comprobante { border: 2px solid #E2E8F0; border-radius: 14px; overflow: hidden; }
.comprobante header { display: flex; justify-content: space-between; gap: 12px; padding: 10px 16px; background: #14244A; color: #fff; font-weight: 700; }
.comprobante header span:last-child { font-weight: 600; color: #CBD5E1; }
.celda { width: 96px; height: 36px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 8px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.celda:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.pie { display: flex; flex-wrap: wrap; gap: 8px; }
.reparto { max-height: 360px; overflow-y: auto; }
.reparto li { display: flex; align-items: center; gap: 10px; min-height: 48px; border-top: 1px solid #EEF2F6; }
.historial { max-height: max(400px, calc(100vh - 330px)); }
</style>
