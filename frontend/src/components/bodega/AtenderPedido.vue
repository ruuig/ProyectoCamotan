<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { textoNumero, numerosDe } from '../../dominio/hojasRequisicion';
import { usarBorrador } from '../../dominio/borrador';
import bodega from '../../services/bodega';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../comunes/Icono.vue';
import { miles, estiloTono } from './diseno/PiezasBodega';

/**
 * Hoja de despacho de una requisición (FOR-ASB-01): lo que se va a sacar de
 * la bodega, producto por producto en el orden del balance, con el lote que
 * se toma (el que vence primero; si no alcanza, el siguiente en otra línea).
 * Bodega despacha lo que le piden: la cantidad viene llena y solo se cambia si
 * se da menos. La casilla es para ir marcando lo que ya se tomó del estante.
 * Al despachar sale de la bodega con esos lotes y entra donde se pidió.
 */
const props = defineProps({ id: { type: Number, required: true } });
const emit = defineEmits(['listo']);

const r = ref(null);
const existencias = ref({});
const error = ref('');
const enviando = ref(false);
const cantidades = reactive({});
const tomados = reactive({});
const despacho = reactive({ numero: '', recibidoPor: '' });
const rechazando = ref(false);
const motivoRechazo = ref('');

const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;

async function cargar() {
  error.value = '';
  try {
    const d = await bodega.requisicion(props.id);
    r.value = d.requisicion;
    existencias.value = d.existencias ?? {};
    for (const g of d.requisicion.renglones) {
      const hay = g.insumoId ? existencias.value[g.insumoId]?.enBodega ?? 0 : g.cantidadSolicitada;
      cantidades[g.id] = String(g.cantidadAutorizada ?? Math.min(g.cantidadSolicitada, hay));
    }
    despacho.numero = d.requisicion.numero ?? '';
    despacho.recibidoPor = d.requisicion.recibidoPor ?? d.requisicion.solicitante ?? '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}
// Lo marcado y lo cambiado no se pierde al ir a otra pantalla.
const borrador = usarBorrador(() => `atender-${props.id}`, { cantidades, tomados, despacho });
watch(() => props.id, async () => { await cargar(); borrador.recuperar(); }, { immediate: true });

/* Los lotes que se toman para una cantidad: el que vence primero, luego el siguiente. */
function lotesPara(g) {
  if (!g.insumoId) return [];
  let falta = entero(cantidades[g.id]);
  const salen = [];
  for (const l of existencias.value[g.insumoId]?.lotes ?? []) {
    if (falta <= 0) break;
    const n = Math.min(falta, l.cantidad);
    salen.push({ ...l, cantidad: n });
    falta -= n;
  }
  return salen;
}

/* La hoja: en el orden del balance; un renglón por lote. */
const hoja = computed(() => [...(r.value?.renglones ?? [])]
  .sort((a, b) => (a.ordenFormulario ?? 1e6) - (b.ordenFormulario ?? 1e6) || a.orden - b.orden)
  .map((g) => ({ g, lotes: lotesPara(g) })));
const enBodega = (g) => (g.insumoId ? existencias.value[g.insumoId]?.enBodega ?? 0 : null);
const excede = (g) => g.insumoId && entero(cantidades[g.id]) > enBodega(g);
const hayExceso = computed(() => (r.value?.renglones ?? []).some(excede));
const total = computed(() => (r.value?.renglones ?? []).reduce((t, g) => t + entero(cantidades[g.id]), 0));
const marcados = computed(() => hoja.value.filter(({ g }) => tomados[g.id]).length);
const editable = computed(() => ['solicitada', 'autorizada'].includes(r.value?.estado));
const vence = (v) => new Date(v).toLocaleDateString('es-GT', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });

async function despachar() {
  enviando.value = true;
  error.value = '';
  try {
    const renglones = r.value.renglones.map((g) => ({ id: g.id, cantidad: entero(cantidades[g.id]) }));
    await bodega.autorizarRequisicion(r.value.id, renglones.map((x) => ({ id: x.id, cantidadAutorizada: x.cantidad })));
    await bodega.despacharRequisicion(r.value.id, {
      numero: despacho.numero.trim(),
      recibidoPor: despacho.recibidoPor.trim(),
      // Salen los lotes que dice la hoja.
      renglones: r.value.renglones.map((g) => ({
        id: g.id,
        cantidadDespachada: entero(cantidades[g.id]),
        ...(g.insumoId && entero(cantidades[g.id]) ? { lotes: lotesPara(g).map((l) => ({ loteId: l.loteId, cantidad: l.cantidad })) } : {}),
      })),
    }, nuevaClaveIdempotencia());
    window.open(`/imprimir/requisicion/${r.value.id}`, '_blank');
    borrador.limpiar();
    emit('listo', `Despachado: ${r.value.unidadSeccion}, ${miles(total.value)} unidades.`);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function rechazar() {
  enviando.value = true;
  error.value = '';
  try {
    await bodega.anularRequisicion(r.value.id, motivoRechazo.value.trim());
    borrador.limpiar();
    emit('listo', `Rechazado: ${r.value.unidadSeccion}.`);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const ESTADO = {
  solicitada: { texto: 'Por despachar', tono: 'atencion' },
  autorizada: { texto: 'Por despachar', tono: 'atencion' },
  despachada: { texto: 'Despachada', tono: 'bien' },
  anulada: { texto: 'Rechazada', tono: 'critico' },
};
</script>

<template>
  <article class="hoja-despacho">
    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
    <template v-if="r">
      <header class="cabeza">
        <div class="min-w-0">
          <h2>{{ r.unidadSeccion }} <span class="estado" :style="estiloTono(ESTADO[r.estado]?.tono ?? 'neutro')">{{ ESTADO[r.estado]?.texto ?? r.estado }}</span></h2>
          <p class="meta">{{ r.solicitante }} · {{ fecha(r.fechaSolicitud) }} · {{ r.renglones.length }} productos<template v-if="r.numero"> · Formulario {{ textoNumero(r) }}</template></p>
        </div>
      </header>

      <div class="tabla">
        <div class="fila cab">
          <span>Producto</span><span>Lote</span><span>Vence</span><span class="n">Solicitado</span><span class="n">Despachar</span><span class="marca">{{ editable ? `${marcados}/${hoja.length}` : '' }}</span>
        </div>
        <div v-for="{ g, lotes } in hoja" :key="g.id" class="fila" :class="{ hecho: tomados[g.id], sin: g.insumoId && !enBodega(g), excede: excede(g) }">
          <span class="producto">{{ g.descripcion }}</span>
          <span class="lotes">
            <span v-for="l in lotes" :key="l.loteId" class="lote">{{ l.numeroLote }}<b v-if="lotes.length > 1"> × {{ miles(l.cantidad) }}</b></span>
            <span v-if="g.insumoId && !lotes.length" class="nada">Sin existencia</span>
          </span>
          <span class="lotes">
            <span v-for="l in lotes" :key="l.loteId" class="vence">{{ vence(l.fechaVence) }}</span>
          </span>
          <span class="n">{{ miles(g.cantidadSolicitada) }}</span>
          <span class="n">
            <input v-if="editable" v-model="cantidades[g.id]" inputmode="numeric" class="cant" :class="{ menos: entero(cantidades[g.id]) < g.cantidadSolicitada }" :aria-label="`Despachar de ${g.descripcion}`" />
            <b v-else>{{ miles(g.cantidadDespachada ?? 0) }}</b>
          </span>
          <span class="marca">
            <input v-if="editable" v-model="tomados[g.id]" type="checkbox" class="check" :aria-label="`Tomado: ${g.descripcion}`" />
          </span>
        </div>
      </div>

      <div v-if="editable" class="despacho">
        <label><span>No. formulario</span><input v-model="despacho.numero" class="b-campo font-mono" /></label>
        <label><span>Recibe</span><input v-model="despacho.recibidoPor" class="b-campo" /></label>
        <div class="botones">
          <button type="button" class="b-btn secundario" :disabled="enviando" @click="rechazando = !rechazando">Rechazar</button>
          <button type="button" class="b-btn exito" :disabled="enviando || !total || hayExceso || !despacho.numero.trim() || despacho.recibidoPor.trim().length < 3" @click="despachar">
            <Icono nombre="imprimir" :tamano="20" /> {{ enviando ? 'Despachando…' : `Despachar e imprimir · ${miles(total)}` }}
          </button>
        </div>
        <small v-if="numerosDe(despacho.numero, r.renglones.map((g) => g.descripcion)).length > 1" class="hojas">Hojas {{ numerosDe(despacho.numero, r.renglones.map((g) => g.descripcion)).join(', ') }}</small>
        <form v-if="rechazando" class="rechazo" @submit.prevent="rechazar">
          <input v-model="motivoRechazo" minlength="5" class="b-campo" placeholder="Motivo" aria-label="Motivo del rechazo" />
          <button type="submit" class="b-btn peligro" :disabled="enviando || motivoRechazo.trim().length < 5">Rechazar</button>
        </form>
      </div>
      <p v-else-if="r.estado === 'anulada'" class="b-aviso error">Rechazada · {{ r.motivoAnulacion }}</p>
      <p v-else class="b-aviso ok">Despachada {{ fecha(r.despachadaEn) }} · {{ r.despachadaPor }} · recibió {{ r.recibidoPor }}</p>
    </template>
  </article>
</template>

<style scoped>
.hoja-despacho { display: grid; gap: 12px; }
.cabeza { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cabeza h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 22px; font-weight: 900; color: #14244A; }
.meta { margin-top: 2px; font-size: 14.5px; font-weight: 700; color: #475569; }
.estado { padding: 2px 10px; border-radius: 9px; background: var(--t-fondo); color: var(--t-tinta); font-size: 13px; font-weight: 900; }

.tabla { border: 2px solid #E5E9F0; border-radius: 16px; background: #fff; overflow: hidden; }
.fila { display: grid; grid-template-columns: minmax(0, 1fr) 150px 80px 96px 110px 52px; align-items: center; gap: 10px; padding: 6px 14px; border-top: 1px solid #EEF2F6; }
.fila.cab { position: sticky; top: 0; z-index: 1; border-top: 0; background: #F1F5F9; font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.fila:not(.cab):hover { background: #F7FBFE; }
.fila.hecho { background: #F1FAF5; }
.fila.hecho .producto { color: #64748B; text-decoration: line-through; text-decoration-color: #94A3B8; }
.fila.sin .producto, .fila.sin .n { color: #94A3B8; }
.producto { min-width: 0; font-size: 15px; font-weight: 800; color: #14244A; overflow-wrap: anywhere; }
.lotes { display: grid; gap: 2px; }
.lote { font-family: ui-monospace, monospace; font-size: 14px; font-weight: 800; color: #172A5A; }
.lote b { font-family: inherit; font-weight: 700; color: #64748B; }
.vence { font-size: 14px; font-weight: 700; color: #475569; font-variant-numeric: tabular-nums; }
.nada { font-size: 13px; font-weight: 700; color: #A83232; }
.n { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: #334155; }
.cant { width: 100%; height: 38px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 10px; text-align: right; font-size: 16px; font-weight: 900; color: #14244A; background: #fff; }
.cant:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.cant.menos { border-color: #E8930C; background: #FFF8EB; }
.fila.excede .cant { border-color: #D64545; background: #FDF2F2; }
.marca { display: grid; place-items: center; font-size: 11px; }
.check { width: 24px; height: 24px; accent-color: #1E8E5E; cursor: pointer; }

.despacho { position: sticky; bottom: 0; display: grid; grid-template-columns: 180px minmax(0, 1fr) auto; align-items: end; gap: 12px; padding: 12px 0 2px; background: #fff; }
.despacho > label { display: grid; gap: 4px; min-width: 0; }
.despacho > label > span { font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.botones { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.botones .b-btn { height: 48px; }
.hojas { grid-column: 1 / -1; font-size: 12px; font-weight: 800; color: #174E80; }
.rechazo { grid-column: 1 / -1; display: flex; gap: 8px; padding: 10px; border-radius: 14px; background: #FDECEC; }
.rechazo input { flex: 1; }
@media (max-width: 900px) {
  .despacho { position: static; grid-template-columns: 1fr 1fr; }
  .botones { grid-column: 1 / -1; }
}
@media (max-width: 680px) {
  /* En el teléfono: el nombre a lo ancho; debajo, lote, cantidad y la casilla. */
  .fila { grid-template-columns: minmax(0, 1fr) 96px 40px; gap: 4px 8px; padding: 8px 10px; }
  .fila.cab { display: none; }
  .producto { grid-column: 1 / -1; }
  .fila > :nth-child(3), .fila > :nth-child(4) { display: none; }
  .despacho { grid-template-columns: 1fr; }
}
</style>
