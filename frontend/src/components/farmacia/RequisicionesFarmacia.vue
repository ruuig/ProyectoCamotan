<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import Icono from '../comunes/Icono.vue';
import { miles } from '../bodega/diseno/PiezasBodega';

/**
 * Las requisiciones que farmacia (post-consulta) ha hecho a bodega: cuándo,
 * cuánto se pidió, cuánto llegó y en qué va cada una. Desde aquí se vuelven a
 * imprimir y se cancela la que bodega todavía no atiende. Al abrir una se ve
 * qué se pidió y qué llegó de cada medicamento, con sus lotes: son las
 * entradas de farmacia, que entran solas al estante cuando bodega despacha.
 */
const emit = defineEmits(['aviso', 'error']);
const lista = ref(null);

async function cargar() {
  try {
    const [u, r] = await Promise.all([bodega.ubicaciones(), bodega.requisiciones()]);
    const lugar = u.ubicaciones.find((x) => x.tipo === 'centro_salud');
    lista.value = r.requisiciones.filter((x) => x.direccion === 'servicio' && x.ubicacion === lugar?.nombre);
  } catch (fallo) {
    emit('error', fallo.message);
  }
}
onMounted(cargar);

const ESTADO = {
  solicitada: { texto: 'Espera a bodega', clase: 'espera' },
  autorizada: { texto: 'Autorizada', clase: 'espera' },
  despachada: { texto: 'Llegó', clase: 'bien' },
  recibida: { texto: 'Llegó', clase: 'bien' },
  parcial: { texto: 'Llegó una parte', clase: 'parte' },
  anulada: { texto: 'Cancelada', clase: 'anulada' },
};
const fecha = (v) => new Date(v).toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const llego = (r) => (['despachada', 'recibida', 'parcial'].includes(r.estado) ? miles(r.despachado) : '–');

// Ver las canceladas o no: casi nunca hacen falta.
const verCanceladas = ref(false);
const canceladas = computed(() => (lista.value ?? []).filter((r) => r.estado === 'anulada').length);
const visibles = computed(() => (lista.value ?? []).filter((r) => verCanceladas.value || r.estado !== 'anulada'));

/* El detalle de una: qué se pidió y qué llegó, renglón por renglón. */
const abierta = ref(null);
const detalle = ref(null);
async function abrir(r) {
  if (abierta.value === r.id) { abierta.value = null; return; }
  abierta.value = r.id;
  detalle.value = null;
  try {
    detalle.value = (await bodega.requisicion(r.id)).requisicion;
  } catch (fallo) {
    emit('error', fallo.message);
  }
}
const llegada = (g) => (g.cantidadDespachada == null ? null : g.cantidadDespachada);
const vence = (v) => new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

const cancelando = ref(null);
async function cancelar(r) {
  cancelando.value = r.id;
  try {
    await bodega.anularRequisicion(r.id, 'Farmacia canceló el pedido antes de que bodega lo atendiera');
    emit('aviso', `Requisición ${r.numero ?? ''} cancelada.`);
    await cargar();
  } catch (fallo) {
    emit('error', fallo.message);
  } finally {
    cancelando.value = null;
  }
}
</script>

<template>
  <div class="hechas">
    <div v-if="canceladas" class="barra">
      <label class="ver-canceladas">
        <input v-model="verCanceladas" type="checkbox" />
        Mostrar las canceladas ({{ canceladas }})
      </label>
    </div>

    <p v-if="!lista" class="b-vacio">Cargando…</p>
    <div v-else class="tabla">
      <div class="fila cabeza">
        <span>No.</span><span>Fecha</span><span class="n">Medicamentos</span><span class="n">Pedido</span><span class="n">Llegó</span><span>Estado</span><span />
      </div>
      <template v-for="r in visibles" :key="r.id">
        <div class="fila" :class="{ apagada: r.estado === 'anulada', abierta: abierta === r.id }" role="button" tabindex="0" :aria-expanded="abierta === r.id" @click="abrir(r)" @keydown.enter="abrir(r)">
          <span class="numero" :class="{ sin: !r.numero }"><small class="et">No.</small>{{ r.numero ?? 'Por asignar' }}</span>
          <span><small class="et">Fecha</small>{{ fecha(r.fechaSolicitud) }}</span>
          <span class="n"><small class="et">Medicamentos</small>{{ r.renglones }}</span>
          <span class="n"><small class="et">Pedido</small>{{ miles(r.solicitado) }}</span>
          <span class="n"><small class="et">Llegó</small>{{ llego(r) }}</span>
          <span><span class="estado" :class="ESTADO[r.estado]?.clase">{{ ESTADO[r.estado]?.texto ?? r.estado }}</span></span>
          <span class="acciones" @click.stop>
            <RouterLink :to="`/imprimir/requisicion/${r.id}`" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Imprimir</RouterLink>
            <button v-if="r.estado === 'solicitada'" type="button" class="b-btn secundario chico" :disabled="cancelando === r.id" @click="cancelar(r)">Cancelar</button>
            <span class="chev"><Icono :nombre="abierta === r.id ? 'cerrar' : 'irA'" :tamano="18" :grosor="2.4" /></span>
          </span>
        </div>
        <!-- Qué se pidió y qué llegó -->
        <div v-if="abierta === r.id" class="detalle">
          <p v-if="!detalle" class="b-vacio">Cargando…</p>
          <template v-else>
            <p v-if="detalle.motivoAnulacion" class="motivo">{{ detalle.motivoAnulacion }}</p>
            <p v-if="detalle.despachadaEn" class="cuando">Bodega lo despachó el {{ fecha(detalle.despachadaEn) }}<template v-if="detalle.despachadaPor"> · {{ detalle.despachadaPor }}</template></p>
            <div class="renglon cabeza"><span>Medicamento</span><span class="n">Pedido</span><span class="n">Llegó</span><span>Lote · vence</span></div>
            <div v-for="g in detalle.renglones" :key="g.id" class="renglon" :class="{ falta: llegada(g) != null && llegada(g) < g.cantidadSolicitada, nada: llegada(g) === 0 }">
              <span class="desc">{{ g.descripcion }}</span>
              <span class="n">{{ miles(g.cantidadSolicitada) }}</span>
              <span class="n fuerte">{{ llegada(g) == null ? '–' : miles(llegada(g)) }}</span>
              <span class="lotes">
                <span v-for="l in g.lotes" :key="l.loteId" class="lote">{{ l.numeroLote }} · {{ vence(l.fechaVence) }} <b>({{ miles(l.cantidad) }})</b></span>
              </span>
            </div>
          </template>
        </div>
      </template>
      <p v-if="!visibles.length" class="b-vacio">Sin requisiciones.</p>
    </div>
  </div>
</template>

<style scoped>
.hechas { display: grid; gap: 12px; }
.barra { display: flex; justify-content: flex-end; }
.ver-canceladas { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: #475569; cursor: pointer; }
.ver-canceladas input { width: 18px; height: 18px; }
.tabla { border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; background: #fff; overflow: hidden; }
.fila { display: grid; grid-template-columns: 110px 130px 110px 100px 100px minmax(120px, 1fr) auto; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid #EEF2F6; font-size: 15px; font-weight: 700; color: #1E293B; }
.fila.cabeza { border-top: 0; background: #F1F5F9; font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.fila.apagada { color: #94A3B8; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
.numero { font-family: ui-monospace, monospace; font-weight: 900; color: #172A5A; }
.numero.sin { font-family: inherit; font-size: 13px; font-weight: 700; color: #94A3B8; }
.estado { display: inline-block; padding: 3px 10px; border-radius: 9px; font-size: 13px; font-weight: 900; }
.estado.espera { background: #EAF3FB; color: #174E80; }
.estado.bien { background: #E2F5EA; color: #145C3C; }
.estado.parte { background: #FFF1DC; color: #8A4B00; }
.estado.anulada { background: #F1F5F9; color: #64748B; }
.acciones { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.fila:not(.cabeza) { cursor: pointer; }
.fila:not(.cabeza):hover, .fila.abierta { background: #F7FBFE; }
.chev { display: grid; place-items: center; width: 28px; color: #64748B; }
.et { display: none; }
.detalle { display: grid; gap: 2px; padding: 8px 16px 14px; background: #F7FBFE; border-top: 1px solid #EEF2F6; }
.cuando, .motivo { padding: 4px 0 8px; font-size: 14px; font-weight: 700; color: #475569; }
.motivo { color: #8A4B00; }
.renglon { display: grid; grid-template-columns: minmax(0, 1fr) 90px 90px minmax(0, 1.2fr); align-items: start; gap: 12px; padding: 6px 10px; border-radius: 10px; font-size: 14px; font-weight: 700; color: #1E293B; background: #fff; }
.renglon.cabeza { background: transparent; font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.renglon.falta .fuerte { color: #B4610A; }
.renglon.nada .fuerte { color: #A52A2A; }
.renglon .desc { overflow-wrap: anywhere; }
.fuerte { font-weight: 900; color: #14244A; }
.lotes { display: flex; flex-wrap: wrap; gap: 4px; }
.lote { padding: 1px 8px; border-radius: 8px; background: #F1F5F9; font-size: 12.5px; font-weight: 700; color: #334155; }
.lote b { font-weight: 900; }
.tabla .b-vacio { padding: 20px; }
@media (max-width: 860px) {
  .fila { grid-template-columns: 1fr 1fr; }
  .fila.cabeza { display: none; }
  .renglon.cabeza > :nth-child(4) { display: none; }
  /* En el teléfono cada cifra lleva su nombre. */
  .et { display: block; font-size: 11px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
  .n { text-align: left; }
  .acciones { grid-column: 1 / -1; justify-content: flex-start; }
  .renglon { grid-template-columns: minmax(0, 1fr) 70px 70px; }
  .renglon .lotes { grid-column: 1 / -1; }
}
</style>
