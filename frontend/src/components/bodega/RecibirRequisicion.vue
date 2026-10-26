<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { textoNumero } from '../../dominio/hojasRequisicion';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../comunes/Icono.vue';
import { miles } from './diseno/PiezasBodega';
import { usarBorrador } from '../../dominio/borrador';
import CrearInsumoRapido from './CrearInsumoRapido.vue';

/**
 * Recibir contra una requisición a la DDRISS: todo lo que entra a la bodega
 * llega por requisición. Se elige la que llegó y aparecen sus productos con lo
 * que se pidió y lo que aún falta; bodega solo anota cuánto llegó, el lote y
 * el vencimiento. Lo que no llegó queda pendiente en la misma requisición.
 */
const props = defineProps({ inicial: { type: [Number, String], default: null } });
const emit = defineEmits(['aviso', 'error', 'listo']);

const pendientes = ref([]);
const elegida = ref(null);
const filas = ref([]);
const cerrar = ref(false);
const enviando = ref(false);
// Lo anotado de una requisición no se pierde al ir a otra pantalla.
const borrador = usarBorrador(() => `recibir-req-${elegida.value?.id}`, { filas, cerrar }, { vacio: (d) => !d.filas.some((g) => g.lotes.some((l) => l.cantidad || l.numeroLote || l.fechaVence)) });
const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

async function anular(r) {
  try {
    await bodega.anularRequisicion(r.id, 'Bodega anuló la requisición antes de que llegara');
    emit('aviso', 'Requisición anulada.');
    await cargar();
  } catch (fallo) {
    emit('error', fallo.message);
  }
}

async function cargar() {
  const r = await bodega.requisiciones({ direccion: 'superior' });
  pendientes.value = r.requisiciones.filter((x) => ['solicitada', 'autorizada', 'parcial'].includes(x.estado));
  if (props.inicial && !elegida.value) await elegir(Number(props.inicial));
}

async function elegir(id) {
  try {
    const { requisicion } = await bodega.requisicion(id);
    elegida.value = requisicion;
    cerrar.value = false;
    filas.value = requisicion.renglones
      .map((g) => ({ ...g, falta: Math.max(0, g.cantidadSolicitada - (g.cantidadDespachada ?? 0)), lotes: [{ numeroLote: '', fechaVence: '', cantidad: '' }], revisado: false, abierto: false }))
      .filter((g) => g.falta > 0);
    borrador.recuperar();
    // Un borrador anterior no traía la marca de revisado: lo que ya tiene cantidad cuenta como revisado.
    for (const g of filas.value) if (g.revisado === undefined) { g.revisado = llego(g) > 0; g.abierto = false; }
  } catch (fallo) {
    emit('error', fallo.message);
  }
}
watch(() => props.inicial, (v) => { if (v) elegir(Number(v)); });

const llego = (g) => g.lotes.reduce((s, l) => s + entero(l.cantidad), 0);
const conLlegada = computed(() => filas.value.filter((g) => llego(g) > 0));
// Lo escrito a mano que no se creó como producto solo lleva la cantidad.
const conLote = (g) => Boolean(g.insumoId);
const incompletos = computed(() => conLlegada.value.filter((g) => conLote(g) && g.lotes.some((l) => entero(l.cantidad) && (!l.numeroLote.trim() || !l.fechaVence))));
const creandoPara = ref(null);
function creado(insumo) {
  creandoPara.value.insumoId = insumo.id;
  creandoPara.value.creado = insumo.id;
  creandoPara.value = null;
}
const faltaTodo = computed(() => filas.value.reduce((s, g) => s + Math.max(0, g.falta - llego(g)), 0));
const listo = computed(() => conLlegada.value.length > 0 && !incompletos.value.length);

/** «Completo»: pone lo que falta en el primer lote de ese producto. */
function completo(g) {
  g.lotes[0].cantidad = String(g.falta - g.lotes.slice(1).reduce((s, l) => s + entero(l.cantidad), 0));
  g.revisado = true;
  g.abierto = false;
}
/** «Incompleto»: se anota cuánto vino (0 si no vino nada); lo demás queda pendiente. */
function incompleto(g, evento) {
  g.revisado = true;
  g.abierto = true;
  const tarjeta = evento.target.closest('.producto');
  setTimeout(() => tarjeta?.querySelector('input')?.focus(), 0);
}
// Revisado y con sus datos: se muestra en una sola línea para bajar menos.
const faltaDato = (g) => conLote(g) && g.lotes.some((l) => entero(l.cantidad) && (!l.numeroLote.trim() || !l.fechaVence));
const plegado = (g) => g.revisado && !g.abierto && !faltaDato(g);
const revisados = computed(() => filas.value.filter((g) => g.revisado).length);
const soloPendientes = ref(false);
const visibles = computed(() => (soloPendientes.value ? filas.value.filter((g) => !g.revisado || faltaDato(g)) : filas.value));

async function registrar() {
  enviando.value = true;
  try {
    await bodega.recibirRequisicion(elegida.value.id, {
      completa: cerrar.value || faltaTodo.value === 0,
      renglones: conLlegada.value.map((g) => (conLote(g)
        ? {
          id: g.id,
          ...(g.creado ? { insumoId: g.creado } : {}),
          lotes: g.lotes.filter((l) => entero(l.cantidad)).map((l) => ({ numeroLote: l.numeroLote.trim(), fechaVence: l.fechaVence, cantidad: entero(l.cantidad) })),
        }
        : { id: g.id, cantidad: llego(g) })),
    }, nuevaClaveIdempotencia());
    const total = conLlegada.value.reduce((s, g) => s + llego(g), 0);
    emit('aviso', `Recibido: ${miles(total)} unidades, ${conLlegada.value.length} productos.${faltaTodo.value && !cerrar.value ? ` Pendiente: ${miles(faltaTodo.value)} unidades.` : ''}`);
    borrador.limpiar();
    elegida.value = null;
    filas.value = [];
    await cargar();
    emit('listo');
  } catch (fallo) {
    emit('error', fallo.message);
  } finally {
    enviando.value = false;
  }
}

onMounted(() => cargar().catch((f) => emit('error', f.message)));
</script>

<template>
  <div class="recibir-req">
    <!-- Las requisiciones a la DDRISS que esperan mercadería -->
    <template v-if="!elegida">
      <div v-if="pendientes.length" class="tabla-pend">
        <div class="fila-pend cab"><span>No.</span><span>Fecha</span><span class="n">Productos</span><span class="n">Unidades</span><span>Estado</span><span /></div>
        <div v-for="r in pendientes" :key="r.id" class="fila-pend">
          <span class="num">{{ r.numero ? textoNumero(r) : '—' }}</span>
          <span>{{ fecha(r.fechaSolicitud) }}</span>
          <span class="n">{{ r.renglones }}<small class="suf"> productos</small></span>
          <span class="n">{{ miles(r.solicitado) }}<small class="suf"> unidades</small></span>
          <span><span class="est" :class="{ parte: r.estado === 'parcial' }">{{ r.estado === 'parcial' ? `Llegaron ${miles(r.despachado)}` : 'Por recibir' }}</span></span>
          <span class="acc">
            <button type="button" class="b-btn primario chico" @click="elegir(r.id)">Recibir</button>
            <RouterLink :to="`/imprimir/requisicion/${r.id}`" target="_blank" class="b-btn secundario chico" aria-label="Imprimir"><Icono nombre="imprimir" :tamano="16" /></RouterLink>
            <button v-if="r.estado === 'solicitada'" type="button" class="b-btn secundario chico" @click="anular(r)">Anular</button>
          </span>
        </div>
      </div>
      <p v-else class="b-vacio">No hay requisiciones por recibir.</p>
    </template>

    <!-- 2. Lo que llegó de esa requisición -->
    <template v-else>
      <div class="cabeza">
        <div>
          <button type="button" class="b-btn secundario chico mb-2" @click="elegida = null"><Icono nombre="volver" :tamano="16" :grosor="2.4" /> Volver</button>
          <h2 class="paso-titulo">Requisición {{ elegida.numero ? `N.º ${textoNumero(elegida)}` : `del ${fecha(elegida.fechaSolicitud)}` }}</h2>
          <p class="sub">{{ elegida.almacen }}</p>
        </div>
      </div>

      <div class="avance">
        <div class="avance-texto">
          <b>{{ revisados }} de {{ filas.length }} revisados</b>
          <label class="solo"><input v-model="soloPendientes" type="checkbox" /> Solo por revisar</label>
        </div>
        <div class="barra"><span :style="{ width: (filas.length ? (revisados / filas.length) * 100 : 0) + '%' }" /></div>
      </div>

      <ul class="productos">
        <li v-for="g in visibles" :key="g.id" class="producto" :class="{ hay: llego(g) > 0, nollego: g.revisado && !llego(g), plegado: plegado(g) }">
          <!-- Revisado: una línea -->
          <button v-if="plegado(g)" type="button" class="linea" @click="g.abierto = true">
            <span class="marca"><Icono :nombre="llego(g) ? 'correcto' : 'cerrar'" :tamano="18" :grosor="3" /></span>
            <span class="min-w-0 flex-1">
              <b class="nombre">{{ g.descripcion }}</b>
              <small>{{ llego(g) >= g.falta ? 'Completo' : 'Incompleto' }} · {{ miles(llego(g)) }}<template v-if="llego(g) < g.falta"> de {{ miles(g.falta) }}</template> {{ g.unidadMedida }}<template v-if="conLote(g) && llego(g)"> · lote {{ g.lotes.map((l) => l.numeroLote).filter(Boolean).join(', ') }}</template></small>
            </span>
            <span class="editar"><Icono nombre="lapiz" :tamano="16" /></span>
          </button>

          <template v-else>
            <div class="info">
              <b class="nombre">{{ g.descripcion }}</b>
              <p v-if="!g.insumoId" class="libre">
                Sin catálogo
                <button type="button" @click="creandoPara = g">Crear producto</button>
              </p>
              <p v-else-if="g.creado" class="libre creado">Producto creado</p>
              <p class="pidio">Pedido <b>{{ miles(g.falta) }}</b> {{ g.unidadMedida }}<template v-if="g.cantidadDespachada"> · recibido antes {{ miles(g.cantidadDespachada) }}</template></p>
            </div>

            <div v-if="!g.revisado" class="decidir">
              <button type="button" class="b-btn exito grande" @click="completo(g)"><Icono nombre="correcto" :tamano="20" /> Completo</button>
              <button type="button" class="b-btn secundario grande" @click="incompleto(g, $event)"><Icono nombre="lapiz" :tamano="18" /> Incompleto</button>
            </div>

            <div v-else class="lotes">
              <div v-for="(l, k) in g.lotes" :key="k" class="lote">
                <label class="cant"><span>Cantidad</span><input v-model="l.cantidad" inputmode="numeric" placeholder="0" class="b-campo num" /></label>
                <template v-if="conLote(g)">
                  <label class="nlote"><span>Lote</span><input v-model="l.numeroLote" maxlength="60" class="b-campo font-mono" :required="Boolean(entero(l.cantidad))" /></label>
                  <label class="vence"><span>Vence</span><input v-model="l.fechaVence" type="date" class="b-campo" :required="Boolean(entero(l.cantidad))" /></label>
                </template>
                <button v-if="k > 0" type="button" class="quitar" aria-label="Quitar este lote" @click="g.lotes.splice(k, 1)"><Icono nombre="cerrar" :tamano="16" /></button>
              </div>
              <div class="acciones-lote">
                <button v-if="conLote(g)" type="button" class="b-btn chico secundario" @click="g.lotes.push({ numeroLote: '', fechaVence: '', cantidad: '' })"><Icono nombre="agregar" :tamano="16" /> Otro lote</button>
                <button type="button" class="b-btn chico primario" :disabled="faltaDato(g)" @click="g.abierto = false"><Icono nombre="correcto" :tamano="16" /> Listo</button>
                <span v-if="llego(g) > g.falta" class="exceso">Más de lo pedido</span>
              </div>
            </div>
          </template>
        </li>
      </ul>
      <CrearInsumoRapido v-if="creandoPara" :nombre-inicial="creandoPara.descripcion" @creado="creado" @cerrar="creandoPara = null" />

      <div class="pie">
        <label v-if="faltaTodo > 0 && conLlegada.length" class="cerrar">
          <input v-model="cerrar" type="checkbox" />
          Cerrar la requisición (pendiente {{ miles(faltaTodo) }})
        </label>
        <p v-if="incompletos.length" class="falta-dato">Sin lote o vencimiento: {{ incompletos.length }}</p>
        <button type="button" class="b-btn primario registrar" :disabled="enviando || !listo" @click="registrar">
          <Icono nombre="recibir" :tamano="22" /> {{ enviando ? 'Registrando…' : `Registrar (${conLlegada.length})` }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tabla-pend { border: 2px solid #E5E9F0; border-radius: 16px; background: #fff; overflow: hidden; }
.fila-pend { display: grid; grid-template-columns: 120px 130px 90px 110px minmax(120px, 1fr) auto; align-items: center; gap: 12px; padding: 8px 14px; border-top: 1px solid #EEF2F6; font-size: 15px; font-weight: 700; color: #1E293B; }
.fila-pend.cab { border-top: 0; background: #F1F5F9; font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.fila-pend .n { text-align: right; font-variant-numeric: tabular-nums; }
.fila-pend .num { font-family: ui-monospace, monospace; font-weight: 900; color: #172A5A; }
.est { padding: 2px 10px; border-radius: 9px; background: #EAF3FB; color: #174E80; font-size: 13px; font-weight: 900; }
.est.parte { background: #FFF1DC; color: #8A4B00; }
.acc { display: flex; gap: 6px; justify-content: flex-end; }
.suf { display: none; }
@media (max-width: 760px) {
  .fila-pend { grid-template-columns: 1fr 1fr; }
  .fila-pend .n { text-align: left; }
  .suf { display: inline; font-size: 13px; font-weight: 600; color: #64748B; }
  .fila-pend.cab { display: none; }
  .acc { grid-column: 1 / -1; justify-content: flex-start; }
}
.recibir-req { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
.recibir-req > *, .productos, .producto, .info, .lotes, .lote > *, .decidir > *, .pie { min-width: 0; }
.lote input { width: 100%; min-width: 0; }
.paso-titulo { font-size: 20px; font-weight: 900; color: #14244A; }
.sub { font-size: 14px; font-weight: 600; color: #64748B; }
.cabeza { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; }
.pendientes { display: grid; gap: 10px; }
.pendiente { display: flex; width: 100%; align-items: center; gap: 14px; padding: 16px 18px; border: 2px solid #9FCDEC; border-bottom-width: 4px; border-radius: 18px; background: #F4F9FE; text-align: left; }
.pendiente:hover { border-color: #2F83C4; }
.pendiente b { display: block; font-size: 17px; font-weight: 900; color: #14244A; }
.pendiente small { display: block; font-size: 14px; font-weight: 600; color: #475569; }
.pendiente .parte { color: #8A4B00; font-weight: 800; }
.ir { display: inline-flex; align-items: center; gap: 4px; padding: 8px 14px; border-radius: 12px; background: #2F83C4; color: #fff; font-weight: 900; }
.sin-pendientes { display: grid; justify-items: center; gap: 4px; padding: 26px; border: 2px dashed #CBD5E1; border-radius: 18px; text-align: center; color: #64748B; }
.sin-pendientes b { font-size: 17px; color: #14244A; }
.productos { display: grid; gap: 10px; }
.avance { position: sticky; top: 0; z-index: 2; display: grid; gap: 6px; padding: 10px 0; background: #fff; }
.avance-texto { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.avance-texto b { font-size: 16px; font-weight: 900; color: #14244A; }
.solo { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 800; color: #334155; }
.solo input { width: 20px; height: 20px; }
.barra { height: 10px; border-radius: 6px; background: #E5E9F0; overflow: hidden; }
.barra span { display: block; height: 100%; background: #1A8F57; transition: width 0.2s; }
.decidir { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; align-content: center; }
.grande { min-height: 52px; font-size: 16px; border-radius: 14px; }
.producto.nollego { border-color: #F1C6C6; background: #FFF8F8; }
.producto.plegado { padding: 0; grid-template-columns: 1fr; }
.linea { display: flex; width: 100%; align-items: center; gap: 12px; padding: 12px 14px; text-align: left; }
.linea small { display: block; font-size: 14px; font-weight: 700; color: #475569; }
.marca { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 50%; background: #1A8F57; color: #fff; }
.nollego .marca { background: #A83232; }
.editar { flex: none; color: #64748B; }
.producto { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr); gap: 14px; padding: 14px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px; }
.producto.hay { border-color: #9BD3B5; background: #F6FCF8; }
@media (max-width: 900px) { .producto { grid-template-columns: 1fr; } }
.nombre { display: block; font-size: 17px; font-weight: 900; line-height: 1.25; color: #14244A; overflow-wrap: anywhere; }
.libre { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; font-size: 13.5px; font-weight: 800; color: #8A4B00; }
.libre button { padding: 3px 10px; border: 2px solid #E8C27A; border-radius: 9px; background: #FFFBEB; color: #8A4B00; font-weight: 800; }
.libre.creado { color: #1E7A4C; }
.pidio { margin-top: 2px; font-size: 14px; font-weight: 600; color: #475569; }
.pidio b { color: #14244A; font-weight: 900; }
.lotes { display: grid; gap: 8px; }
.lote { display: grid; grid-template-columns: 110px minmax(0, 1fr) 160px 32px; gap: 8px; align-items: end; }
@media (max-width: 640px) {
  .lote { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .lote .nlote { grid-column: 1 / -1; }
  .decidir { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .grande { font-size: 15px; padding-left: 8px; padding-right: 8px; }
  .lote .b-campo { font-size: 16px; min-height: 48px; }
  .producto { padding: 12px; }
  .pie { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .registrar { width: 100%; }
}
.lote label { display: grid; gap: 2px; }
.lote span { font-size: 12px; font-weight: 800; text-transform: uppercase; color: #64748B; }
.lote .num { text-align: right; font-weight: 900; }
.quitar { display: grid; place-items: center; width: 32px; height: 40px; color: #94A3B8; }
.acciones-lote { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.exceso { font-size: 13px; font-weight: 800; color: #8A4B00; }
.pie { position: sticky; bottom: 0; display: grid; gap: 8px; padding: 12px 0; background: #fff; border-top: 2px solid #E2E8F0; }
.cerrar { display: flex; align-items: flex-start; gap: 8px; font-size: 14px; font-weight: 700; color: #334155; }
.falta-dato { font-size: 13px; font-weight: 800; color: #A83232; }
.registrar { height: 56px; font-size: 17px; border-radius: 16px; }
</style>
