<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { usarBorrador, erroresPorRenglon, renglonPedido } from '../../dominio/borrador';
import AvisoBorrador from '../comunes/AvisoBorrador.vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import { useAuthStore } from '../../stores/auth';
import Icono from '../comunes/Icono.vue';
import EditorPedido from '../bodega/EditorPedido.vue';
import { miles, estiloTono } from '../bodega/diseno/PiezasBodega';

/**
 * Pedido de farmacia (post-consulta) a la bodega del centro.
 *
 * Como el BRES de cualquier servicio: con la demanda real de los últimos tres
 * meses (lo entregado más lo que no hubo) se calcula cuánto pedir para tener
 * dos meses en el estante. Farmacia revisa, corrige si quiere y lo envía; la
 * bodega lo autoriza y lo despacha, y al despacharlo entra al estante.
 * Sale impreso en la Requisición Despacho de Almacén (FOR-ASB-01).
 */
const props = defineProps({ existencias: { type: Array, required: true } });
const emit = defineEmits(['aviso', 'error']);
const auth = useAuthStore();

const hoy = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;

const farmaciaId = ref(null);
const enviados = ref([]);
const cabecera = reactive({ solicitante: auth.usuario?.nombre ?? '', jefe: '' });
const lineas = ref([]);
const enviando = ref(false);

/* Un renglón del editor: lo que hay, lo que se entrega y si bodega alcanza. */
function renglon(x, cantidad) {
  return {
    insumoId: x.insumoId,
    nombre: x.nombre,
    unidad: x.unidadEntrega ?? '',
    cantidad,
    sugerido: x.pedir ?? 0,
    tono: x.situacion === 'agotado' ? 'critico' : x.situacion === 'pedir' ? 'atencion' : '',
    detalle: `${x.situacion === 'agotado' ? 'Agotado · ' : x.situacion === 'pedir' ? 'Menos de un mes · ' : ''}Hay ${miles(x.entregable)} · se entregan ${miles(x.demandaMensual)} al mes`,
    x,
  };
}

/* Lo sugerido: agotados primero, luego lo que no llega a un mes. */
function sugerir() {
  lineas.value = props.existencias
    .filter((x) => x.pedir > 0)
    .sort((a, b) => Number(b.situacion === 'agotado') - Number(a.situacion === 'agotado') || a.nombre.localeCompare(b.nombre, 'es'))
    .map((x) => renglon(x, String(x.pedir)));
}
// Lo que se está armando no se pierde al ir a otra pantalla.
const borrador = usarBorrador('pedido-farmacia', { lineas, cabecera }, { vacio: (d) => !d.lineas.length });
borrador.recuperar();
function empezarDeNuevo() { borrador.limpiar(); sugerir(); }
watch(() => props.existencias, () => { if (!lineas.value.length) sugerir(); }, { immediate: true });

async function cargar() {
  try {
    const [u, r, s] = await Promise.all([bodega.ubicaciones(), bodega.requisiciones(), bodega.solicitantes().catch(() => ({ solicitantes: {} }))]);
    farmaciaId.value = u.ubicaciones.find((x) => x.tipo === 'centro_salud')?.id ?? null;
    enviados.value = r.requisiciones.filter((x) => x.direccion === 'servicio' && x.ubicacion === u.ubicaciones.find((y) => y.id === farmaciaId.value)?.nombre).slice(0, 6);
    const ultima = s.solicitantes?.[farmaciaId.value];
    if (ultima?.jefe && !cabecera.jefe) cabecera.jefe = ultima.jefe;
  } catch (fallo) {
    emit('error', fallo.message);
  }
}
onMounted(cargar);

/* Agregar algo que no está en la sugerencia. */
const catalogo = computed(() => props.existencias.map((x) => ({ id: x.insumoId, nombreGenerico: x.nombre, codigoInterno: '' })));
const nuevoRenglon = (i) => renglon(props.existencias.find((e) => e.insumoId === i.id), '');

const erroresRenglon = ref({});
const aEnviar = computed(() => lineas.value.filter((l) => entero(l.cantidad) > 0));

async function enviar() {
  erroresRenglon.value = {};
  enviando.value = true;
  try {
    const r = await bodega.crearRequisicion({
      ubicacionId: farmaciaId.value,
      fechaSolicitud: hoy(),
      solicitante: cabecera.solicitante.trim(),
      jefe: cabecera.jefe.trim() || null,
      observaciones: 'Pedido calculado con la demanda real de farmacia (últimos 3 meses), para 2 meses de existencia.',
      renglones: aEnviar.value.map(renglonPedido),
    }, nuevaClaveIdempotencia());
    emit('aviso', `Pedido enviado a bodega con ${aEnviar.value.length} ${aEnviar.value.length === 1 ? 'medicamento' : 'medicamentos'}. Cuando bodega lo despache, entra solo al estante.`);
    window.open(`/imprimir/requisicion/${r.requisicion.id}`, '_blank');
    lineas.value = [];
    borrador.limpiar();
    await cargar();
  } catch (fallo) {
    erroresRenglon.value = erroresPorRenglon(fallo, aEnviar.value);
    emit('error', fallo.message);
  } finally {
    enviando.value = false;
  }
}

const ESTADO_REQ = {
  solicitada: { texto: 'Enviado: espera que bodega lo revise', tono: 'accion' },
  autorizada: { texto: 'Bodega lo autorizó: falta despacharlo', tono: 'accion' },
  despachada: { texto: 'Ya está en el estante', tono: 'bien' },
  parcial: { texto: 'Llegó una parte', tono: 'atencion' },
  recibida: { texto: 'Ya está en el estante', tono: 'bien' },
  anulada: { texto: 'Rechazado', tono: 'critico' },
};
/* Lo que pasó con el pedido, en una frase. */
function detalle(r) {
  if (r.estado === 'anulada') return r.motivoAnulacion ? `Motivo: ${r.motivoAnulacion}` : '';
  if (['despachada', 'recibida', 'parcial'].includes(r.estado) && r.despachado < r.solicitado) return `Llegaron ${miles(r.despachado)} de ${miles(r.solicitado)}: lo demás lo pide bodega al Área`;
  if (r.estado === 'autorizada' && r.autorizado != null && r.autorizado < r.solicitado) return `Se autorizaron ${miles(r.autorizado)} de ${miles(r.solicitado)}`;
  return '';
}
const cancelando = ref(null);
async function cancelar(r) {
  cancelando.value = r.id;
  try {
    await bodega.anularRequisicion(r.id, 'Farmacia canceló el pedido antes de que bodega lo atendiera');
    emit('aviso', 'Pedido cancelado.');
    await cargar();
  } catch (fallo) {
    emit('error', fallo.message);
  } finally {
    cancelando.value = null;
  }
}
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '');
</script>

<template>
  <div class="pedido">
    <!-- Cómo se calcula, en una línea -->
    <div class="explica">
      <span class="ic"><Icono nombre="informacion" :tamano="22" :grosor="2.2" /></span>
      <p>Se pide lo que no alcanza para un mes, hasta tener <b>dos meses</b> en el estante. El cálculo usa lo que se entregó y lo que <b>no hubo</b> en los últimos tres meses. Revise las cantidades y envíelo.</p>
    </div>

    <div class="rejilla">
      <AvisoBorrador v-if="borrador.recuperado.value && lineas.length" class="col-span-full" texto="Se recuperó el pedido que dejó a medias." @descartar="empezarDeNuevo" />
      <EditorPedido v-model="lineas" :errores="erroresRenglon" :catalogo="catalogo" :nuevo-renglon="nuevoRenglon" titulo="Qué pedir a bodega" vacio="Nada que pedir: todo alcanza para más de un mes." @volver-a-llenar="sugerir" />

      <aside class="lado">
        <section class="tarjeta">
          <h2>Firmas del pedido</h2>
          <div>
            <label for="sol" class="b-etiqueta">Solicita</label>
            <input id="sol" v-model="cabecera.solicitante" class="b-campo" />
          </div>
          <div>
            <label for="jefe" class="b-etiqueta">Visto bueno <span class="b-opcional">opcional</span></label>
            <input id="jefe" v-model="cabecera.jefe" class="b-campo" placeholder="Jefe o coordinador" />
          </div>
          <button type="button" class="b-btn primario enviar" :disabled="enviando || !aEnviar.length || cabecera.solicitante.trim().length < 3 || !farmaciaId" @click="enviar">
            <Icono nombre="trasladar" :tamano="22" /> {{ enviando ? 'Enviando…' : `Enviar pedido a bodega (${aEnviar.length})` }}
          </button>
          <p class="nota">Se imprime en la Requisición FOR-ASB-01 para firmarla.</p>
        </section>

        <section class="tarjeta">
          <h2>Pedidos enviados</h2>
          <ul v-if="enviados.length" class="enviados">
            <li v-for="r in enviados" :key="r.id" class="enviado" :style="estiloTono(ESTADO_REQ[r.estado]?.tono ?? 'neutro')">
              <span class="min-w-0 flex-1">
                <b>{{ fecha(r.fechaSolicitud) }} · {{ r.renglones }} {{ r.renglones === 1 ? 'medicamento' : 'medicamentos' }}</b>
                <small>{{ ESTADO_REQ[r.estado]?.texto ?? r.estado }}</small>
                <em v-if="detalle(r)">{{ detalle(r) }}</em>
                <button v-if="r.estado === 'solicitada'" type="button" class="cancelar" :disabled="cancelando === r.id" @click="cancelar(r)">Cancelar el pedido</button>
              </span>
              <RouterLink :to="`/imprimir/requisicion/${r.id}`" target="_blank" class="imp" aria-label="Imprimir"><Icono nombre="imprimir" :tamano="18" /></RouterLink>
            </li>
          </ul>
          <p v-else class="nota">Todavía no hay pedidos.</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.pedido { display: grid; gap: 14px; }
.explica { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-radius: 18px; background: #EAF3FB; color: #174E80; font-size: 15px; font-weight: 600; }
.explica .ic { flex-shrink: 0; color: #2F83C4; }
.explica b { font-weight: 900; }
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
@media (max-width: 1050px) { .rejilla { grid-template-columns: 1fr; } }

.tarjeta { display: grid; gap: 12px; padding: 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.tarjeta h2 { font-size: 18px; font-weight: 900; color: #14244A; }

.lado { display: grid; gap: 16px; }
.enviar { width: 100%; height: 60px; font-size: 17px; border-radius: 16px; }
.nota { font-size: 13px; font-weight: 600; color: #64748B; }
.enviados { display: grid; gap: 8px; }
.enviado { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--t-fondo); color: var(--t-tinta); }
.enviado em { display: block; margin-top: 2px; font-style: normal; font-size: 12.5px; font-weight: 700; color: #334155; }
.cancelar { margin-top: 6px; padding: 4px 10px; border: 2px solid var(--t-borde); border-radius: 10px; background: #fff; font-size: 12.5px; font-weight: 800; color: var(--t-tinta); }
.imp { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: var(--t-tinta); }
.imp:hover { background: #fff; }
.enviado b { display: block; font-size: 14px; font-weight: 900; color: #14244A; }
.enviado small { font-size: 13px; font-weight: 800; }

</style>
