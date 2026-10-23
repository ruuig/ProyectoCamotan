<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import Icono from '../comunes/Icono.vue';
import { miles } from '../bodega/diseno/PiezasBodega';

/**
 * Las requisiciones que farmacia (post-consulta) ha hecho a bodega: cuándo,
 * cuánto se pidió, cuánto llegó y en qué va cada una. Desde aquí se vuelven a
 * imprimir y se cancela la que bodega todavía no atiende.
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
      <div v-for="r in visibles" :key="r.id" class="fila" :class="{ apagada: r.estado === 'anulada' }">
        <span class="numero" :class="{ sin: !r.numero }">{{ r.numero ?? 'Por asignar' }}</span>
        <span>{{ fecha(r.fechaSolicitud) }}</span>
        <span class="n">{{ r.renglones }}</span>
        <span class="n">{{ miles(r.solicitado) }}</span>
        <span class="n">{{ llego(r) }}</span>
        <span><span class="estado" :class="ESTADO[r.estado]?.clase">{{ ESTADO[r.estado]?.texto ?? r.estado }}</span></span>
        <span class="acciones">
          <RouterLink :to="`/imprimir/requisicion/${r.id}`" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Imprimir</RouterLink>
          <button v-if="r.estado === 'solicitada'" type="button" class="b-btn secundario chico" :disabled="cancelando === r.id" @click="cancelar(r)">Cancelar</button>
        </span>
      </div>
      <p v-if="!visibles.length" class="b-vacio">Todavía no ha hecho requisiciones. Se hacen desde Requisición.</p>
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
.acciones { display: flex; gap: 6px; justify-content: flex-end; }
.tabla .b-vacio { padding: 20px; }
@media (max-width: 860px) {
  .fila { grid-template-columns: 1fr 1fr; }
  .fila.cabeza { display: none; }
  .acciones { grid-column: 1 / -1; justify-content: flex-start; }
}
</style>
