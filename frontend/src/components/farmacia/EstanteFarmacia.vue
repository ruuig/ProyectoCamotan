<script setup>
import { ref, reactive, computed } from 'vue';
import farmacia from '../../services/farmacia';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../comunes/Icono.vue';
import { miles, estiloTono } from '../bodega/diseno/PiezasBodega';

/**
 * Estante de la farmacia (post-consulta), como un inventario: una fila por
 * medicamento con lo que hay para entregar, para cuánto alcanza y qué hacer.
 * Los lotes se ven al abrir la fila; ahí se pone el lote a lo que llegó sin
 * él y se devuelve a bodega lo vencido o lo que vence pronto.
 *
 * "Alcanza" se mide con la demanda real de los últimos tres meses (lo
 * entregado más lo que no hubo): menos de un mes es pedir; cero es agotado.
 */
const props = defineProps({
  existencias: { type: Array, required: true },
  buscar: { type: String, default: '' },
});
const emit = defineEmits(['recargar', 'aviso', 'error', 'pedir']);

const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const entero = (v) => (String(v ?? '').trim() === '' ? null : Number(String(v).replace(/[^0-9]/g, '')));
const esSinLote = (l) => l.numeroLote === 'SIN-LOTE';
const esVencido = (l) => l.semaforo === 'vencido';
const vencePronto = (l) => l.semaforo === 'rojo';

/* Cada medicamento con lo que hay que hacer con él, en orden de urgencia. */
const filas = computed(() => props.existencias
  .filter((x) => x.enFarmacia > 0 || x.situacion === 'agotado')
  .map((x) => {
    const lotes = [...x.lotes].sort((a, b) => Number(esSinLote(b)) - Number(esSinLote(a)) || new Date(a.fechaVence) - new Date(b.fechaVence));
    // Una sola etiqueta por medicamento: lo más urgente que hay que hacer.
    let etiqueta = null;
    if (lotes.some(esVencido)) etiqueta = { texto: 'Devolver: vencido', tono: 'critico' };
    else if (x.situacion === 'agotado') etiqueta = { texto: 'Agotado', tono: 'critico' };
    else if (lotes.some(esSinLote)) etiqueta = { texto: 'Ponerle lote', tono: 'atencion' };
    else if (x.situacion === 'pedir') etiqueta = { texto: 'Pedir', tono: 'atencion' };
    const urgencia = lotes.some(esVencido) ? 0 : x.situacion === 'agotado' ? 1 : x.situacion === 'poner_lote' ? 2 : x.situacion === 'pedir' ? 3 : lotes.some(esSinLote) ? 4 : lotes.some(vencePronto) ? 5 : 6;
    // Lo que está pero no se puede entregar: sin lote, o en cuarentena.
    const sinLote = lotes.filter(esSinLote).reduce((t, l) => t + l.cantidad, 0);
    return { ...x, lotes, etiqueta, urgencia, sinLote };
  }));

const visibles = computed(() => {
  const q = sinTildes(props.buscar);
  return filas.value
    .filter((x) => !q || sinTildes(x.nombre).includes(q))
    .sort((a, b) => a.urgencia - b.urgencia || a.nombre.localeCompare(b.nombre, 'es'));
});

const abierto = ref(null);
const alternar = (id) => { abierto.value = abierto.value === id ? null : id; };

const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '');
const enMeses = (l) => {
  if (esVencido(l)) return 'Ya venció';
  const m = l.mesesParaVencer;
  return m < 1 ? 'Vence este mes' : `Vence en ${Math.round(m)} ${Math.round(m) === 1 ? 'mes' : 'meses'}`;
};
const proximoVence = (x) => {
  const l = x.lotes.find((y) => !esSinLote(y));
  return l ? `Vence primero: ${fecha(l.fechaVence)}` : '';
};

/* --- Poner lote ----------------------------------------------------------------- */
const enviando = ref(false);
const poniendo = ref(null);
const nuevoLote = reactive({ numeroLote: '', fechaVence: '', cantidad: '' });
function abrirPonerLote(insumo, lote) {
  poniendo.value = { insumo, lote };
  Object.assign(nuevoLote, { numeroLote: '', fechaVence: '', cantidad: String(lote.cantidad) });
}
async function guardarLote() {
  enviando.value = true;
  try {
    const r = await farmacia.ponerLote({
      loteId: poniendo.value.lote.loteId,
      numeroLote: nuevoLote.numeroLote.trim(),
      fechaVence: nuevoLote.fechaVence,
      cantidad: entero(nuevoLote.cantidad),
    }, nuevaClaveIdempotencia());
    emit('aviso', `${r.insumo}: ${miles(r.cantidad)} quedaron en el lote ${r.numeroLote}. Ya se pueden entregar.`);
    poniendo.value = null;
    emit('recargar');
  } catch (fallo) {
    emit('error', fallo.message);
  } finally {
    enviando.value = false;
  }
}

/* --- Devolver a bodega ---------------------------------------------------------- */
const devolviendo = ref(null);
const devolucion = reactive({ cantidad: '', motivo: '' });
const MOTIVOS = ['Vencido', 'Próximo a vencer', 'Dañado', 'Sobra en farmacia'];
function abrirDevolucion(insumo, lote) {
  devolviendo.value = { insumo, lote };
  devolucion.cantidad = String(lote.cantidad);
  devolucion.motivo = esVencido(lote) ? 'Vencido' : vencePronto(lote) ? 'Próximo a vencer' : '';
}
async function devolver() {
  enviando.value = true;
  try {
    await farmacia.devolver({
      renglones: [{ loteId: devolviendo.value.lote.loteId, cantidad: entero(devolucion.cantidad) }],
      motivo: devolucion.motivo.trim(),
    }, nuevaClaveIdempotencia());
    emit('aviso', `Se devolvieron ${devolucion.cantidad} de ${devolviendo.value.insumo.nombre} (lote ${devolviendo.value.lote.numeroLote}) a bodega.`);
    devolviendo.value = null;
    emit('recargar');
  } catch (fallo) {
    emit('error', fallo.message);
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="estante-farmacia">
    <div class="tabla">
      <ul>
        <li v-for="x in visibles" :key="x.insumoId" class="fila" :class="{ abierta: abierto === x.insumoId }" :style="estiloTono(x.etiqueta?.tono ?? 'neutro')">
          <button type="button" class="resumen" :aria-expanded="abierto === x.insumoId" @click="alternar(x.insumoId)">
            <span class="med">
              <b class="nombre">{{ x.nombre }}</b>
              <small>{{ proximoVence(x) }}</small>
            </span>
            <span v-if="x.etiqueta" class="etiqueta">{{ x.etiqueta.texto }}</span>
            <span v-else />
            <span class="cant"><b>{{ miles(x.entregable) }}</b><small>para entregar</small></span>
            <span class="chev"><Icono :nombre="abierto === x.insumoId ? 'cerrar' : 'irA'" :tamano="20" :grosor="2.4" /></span>
          </button>

          <!-- Detalle: lotes y lo que se puede hacer con cada uno -->
          <div v-if="abierto === x.insumoId" class="detalle">
            <ul class="lotes">
              <li v-for="l in x.lotes" :key="l.loteId" class="lote" :class="esSinLote(l) ? 'sin-lote' : l.semaforo">
                <span class="punto" />
                <span class="l-num">{{ esSinLote(l) ? 'Sin número de lote' : l.numeroLote }}</span>
                <span class="l-vence">
                  <template v-if="esSinLote(l)">No se puede entregar hasta ponerle el lote</template>
                  <template v-else><b>{{ enMeses(l) }}</b> · {{ fecha(l.fechaVence) }}</template>
                </span>
                <b class="l-cant">{{ miles(l.cantidad) }}</b>
                <button v-if="esSinLote(l)" type="button" class="b-btn exito" @click="abrirPonerLote(x, l)"><Icono nombre="lapiz" :tamano="18" /> Poner lote</button>
                <button v-else type="button" class="b-btn" :class="esVencido(l) ? 'peligro' : 'secundario'" @click="abrirDevolucion(x, l)"><Icono nombre="trasladar" :tamano="18" /> Devolver</button>
              </li>
              <li v-if="!x.lotes.length" class="vacio">No hay nada en el estante.</li>
            </ul>
          </div>
        </li>
        <li v-if="!visibles.length" class="b-vacio">Ningún medicamento con ese nombre.</li>
      </ul>
    </div>

    <!-- Poner lote -->
    <div v-if="poniendo" class="fondo" role="dialog" aria-modal="true" aria-labelledby="titulo-lote" @click.self="poniendo = null">
      <form class="b-panel ventana" @submit.prevent="guardarLote">
        <header class="b-panel-cabeza"><h2 id="titulo-lote" class="b-panel-titulo">Poner lote</h2></header>
        <div class="b-panel-cuerpo space-y-3">
          <p class="caja-med"><b>{{ poniendo.insumo.nombre }}</b><span>{{ miles(poniendo.lote.cantidad) }} sin lote en farmacia</span></p>
          <div>
            <label for="pl-lote" class="b-etiqueta">Número de lote (como dice la caja)</label>
            <input id="pl-lote" v-model="nuevoLote.numeroLote" required minlength="2" autocomplete="off" class="b-campo grande font-mono uppercase" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="pl-vence" class="b-etiqueta">Vence</label>
              <input id="pl-vence" v-model="nuevoLote.fechaVence" type="date" required class="b-campo grande" />
            </div>
            <div>
              <label for="pl-cant" class="b-etiqueta">Cantidad de ese lote</label>
              <input id="pl-cant" v-model="nuevoLote.cantidad" inputmode="numeric" required class="b-campo grande num" />
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="b-btn secundario" @click="poniendo = null">Cancelar</button>
            <button type="submit" class="b-btn exito" :disabled="enviando || !nuevoLote.numeroLote.trim() || !nuevoLote.fechaVence || !entero(nuevoLote.cantidad) || entero(nuevoLote.cantidad) > poniendo.lote.cantidad">
              <Icono nombre="correcto" :tamano="20" /> Guardar lote
            </button>
          </div>
        </div>
      </form>
    </div>

    <!-- Devolver a bodega -->
    <div v-if="devolviendo" class="fondo" role="dialog" aria-modal="true" aria-labelledby="titulo-devolver" @click.self="devolviendo = null">
      <form class="b-panel ventana" @submit.prevent="devolver">
        <header class="b-panel-cabeza"><h2 id="titulo-devolver" class="b-panel-titulo">Devolver a bodega</h2></header>
        <div class="b-panel-cuerpo space-y-3">
          <p class="caja-med"><b>{{ devolviendo.insumo.nombre }}</b><span>Lote {{ devolviendo.lote.numeroLote }} · hay {{ miles(devolviendo.lote.cantidad) }} en farmacia</span></p>
          <div>
            <label for="dev-cantidad" class="b-etiqueta">Cuántos regresan</label>
            <input id="dev-cantidad" v-model="devolucion.cantidad" inputmode="numeric" required class="b-campo grande num" />
          </div>
          <div>
            <span class="b-etiqueta">Por qué</span>
            <div class="motivos" role="radiogroup" aria-label="Motivo">
              <button v-for="m in MOTIVOS" :key="m" type="button" role="radio" :aria-checked="devolucion.motivo === m" :class="{ on: devolucion.motivo === m }" @click="devolucion.motivo = m">{{ m }}</button>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="b-btn secundario" @click="devolviendo = null">Cancelar</button>
            <button type="submit" class="b-btn primario" :disabled="enviando || !devolucion.motivo || !entero(devolucion.cantidad) || entero(devolucion.cantidad) > devolviendo.lote.cantidad">Devolver a bodega</button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.estante-farmacia { display: grid; gap: 14px; }

/* Tabla: columnas alineadas, filas grandes para tocar. */
.tabla { overflow: hidden; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.resumen { display: grid; grid-template-columns: minmax(0, 1fr) auto 120px 30px; align-items: center; column-gap: 16px; }
.der { text-align: right; }
.fila { border-top: 2px solid #F1F4F8; box-shadow: inset 6px 0 0 var(--t); }
.fila:first-child { border-top: 0; }
.resumen { width: 100%; min-height: 76px; padding: 12px 18px 12px 24px; text-align: left; }
.resumen:hover { background: #F8FAFC; }
.abierta .resumen { background: var(--t-fondo); }
.med { display: grid; gap: 2px; min-width: 0; }
.nombre { font-size: 17px; font-weight: 900; color: #14244A; }
.med small { font-size: 13.5px; font-weight: 600; color: #64748B; }
.etiqueta { padding: 4px 12px; border-radius: 10px; background: var(--t); color: #fff; font-size: 13.5px; font-weight: 900; white-space: nowrap; box-shadow: inset 0 -3px 0 rgba(0, 0, 0, .18); }
.cant { display: grid; justify-items: end; }
.cant b { font-size: 24px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.cant small { font-size: 12px; font-weight: 700; color: #64748B; }
.chev { color: #94A3B8; }

.detalle { display: grid; gap: 10px; padding: 4px 18px 18px 24px; background: var(--t-fondo); }
.lotes { display: grid; gap: 8px; }
.lote { --sem: #22A06B; display: grid; grid-template-columns: 14px 170px minmax(0, 1fr) 90px auto; align-items: center; gap: 12px; min-height: 60px; padding: 8px 12px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px; background: #fff; }
.lote .punto { width: 14px; height: 14px; border-radius: 50%; background: var(--sem); }
.l-num { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 15px; font-weight: 700; color: #14244A; }
.l-vence { font-size: 14px; color: #475569; }
.l-vence b { color: #14244A; }
.l-cant { text-align: right; font-size: 20px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.lote.amarillo { --sem: #D9A30A; }
.lote.rojo { --sem: #E8590C; border-color: #F5C26B; }
.lote.vencido { --sem: #9B2C2C; border-color: #F3B1B1; background: #FFF7F7; }
.lote.vencido .l-vence b { color: #A83232; }
.lote.sin-lote { --sem: #94A3B8; border-style: dashed; }
.lote.sin-lote .l-num { font-family: inherit; color: #8A4B00; }
.lote .vacio, .lotes .vacio { padding: 12px; font-weight: 700; color: #64748B; }

@media (max-width: 900px) {
  .resumen { grid-template-columns: minmax(0, 1fr) auto; row-gap: 8px; }
  .etiqueta { grid-row: 2; justify-self: start; }
  .chev { display: none; }
  .lote { grid-template-columns: 14px minmax(0, 1fr) auto; }
  .l-vence { grid-column: 2 / -1; }
}

.caja-med { display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; background: #F1F5F9; }
.caja-med b { color: #14244A; }
.caja-med span { font-size: 13px; font-weight: 700; color: #475569; }
.b-campo.grande { height: 56px; font-size: 18px; }
.motivos { display: flex; flex-wrap: wrap; gap: 8px; }
.motivos button { min-height: 48px; padding: 0 16px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 14px; background: #fff; font-size: 15px; font-weight: 800; color: #334155; }
.motivos button.on { border-color: #2F83C4; background: #EAF3FB; color: #174E80; }
.fondo { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
.ventana { width: min(480px, 100%); }
</style>
