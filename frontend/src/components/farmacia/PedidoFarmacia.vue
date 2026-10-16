<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import { useAuthStore } from '../../stores/auth';
import Icono from '../comunes/Icono.vue';
import BuscadorInsumo from '../bodega/diseno/BuscadorInsumo.vue';
import { miles, estiloTono } from '../bodega/diseno/PiezasBodega';

/**
 * Pedido de farmacia (post-consulta) a la bodega del centro.
 *
 * Como el BRES de cualquier servicio: con la demanda real de los últimos tres
 * meses (lo entregado más lo que no hubo) se calcula cuánto pedir para tener
 * dos meses en el estante. Farmacia revisa, corrige si quiere y lo envía; la
 * bodega lo autoriza y lo despacha, y al despacharlo entra al estante.
 * Sale impreso en la Requisición Despacho de Almacén (FOR-ASE-01).
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

/* Lo sugerido: agotados primero, luego lo que no llega a un mes. */
function sugerir() {
  lineas.value = props.existencias
    .filter((x) => x.pedir > 0)
    .sort((a, b) => Number(b.situacion === 'agotado') - Number(a.situacion === 'agotado') || a.nombre.localeCompare(b.nombre, 'es'))
    .map((x) => ({ insumoId: x.insumoId, nombre: x.nombre, incluido: true, cantidad: String(x.pedir), sugerido: x.pedir, x }));
}
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
function agregar(i) {
  if (lineas.value.some((l) => l.insumoId === i.id)) return;
  const x = props.existencias.find((e) => e.insumoId === i.id);
  lineas.value.push({ insumoId: i.id, nombre: x.nombre, incluido: true, cantidad: '', sugerido: 0, x });
}

const aEnviar = computed(() => lineas.value.filter((l) => l.incluido && entero(l.cantidad) > 0));
const faltaEnBodega = (l) => entero(l.cantidad) > l.x.enBodega;

async function enviar() {
  enviando.value = true;
  try {
    const r = await bodega.crearRequisicion({
      ubicacionId: farmaciaId.value,
      fechaSolicitud: hoy(),
      solicitante: cabecera.solicitante.trim(),
      jefe: cabecera.jefe.trim() || null,
      observaciones: 'Pedido calculado con la demanda real de farmacia (últimos 3 meses), para 2 meses de existencia.',
      renglones: aEnviar.value.map((l) => ({ insumoId: l.insumoId, cantidadSolicitada: entero(l.cantidad) })),
    }, nuevaClaveIdempotencia());
    emit('aviso', `Pedido enviado a bodega con ${aEnviar.value.length} ${aEnviar.value.length === 1 ? 'medicamento' : 'medicamentos'}. Cuando bodega lo despache, entra solo al estante.`);
    window.open(`/imprimir/requisicion/${r.requisicion.id}`, '_blank');
    lineas.value = [];
    await cargar();
  } catch (fallo) {
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
      <section class="lista">
        <header class="lista-cabeza">
          <h2>Qué pedir <span>{{ aEnviar.length }}</span></h2>
          <button v-if="lineas.length" type="button" class="b-btn chico secundario" @click="sugerir"><Icono nombre="actualizar" :tamano="16" /> Volver a calcular</button>
        </header>

        <ul v-if="lineas.length">
          <li v-for="(l, i) in lineas" :key="l.insumoId" class="linea" :class="{ fuera: !l.incluido }" :style="estiloTono(l.x.situacion === 'agotado' ? 'critico' : l.x.situacion === 'pedir' ? 'atencion' : 'accion')">
            <label class="incluir" :aria-label="`Incluir ${l.nombre}`">
              <input v-model="l.incluido" type="checkbox" />
              <span class="caja"><Icono nombre="correcto" :tamano="18" :grosor="3" /></span>
            </label>
            <div class="min-w-0">
              <b class="nombre">{{ l.nombre }}</b>
              <p class="datos">
                <span class="estado">{{ l.x.situacion === 'agotado' ? 'Agotado' : l.x.situacion === 'pedir' ? 'Menos de un mes' : 'Agregado' }}</span>
                Hay <b>{{ miles(l.x.entregable) }}</b> · se entregan <b>{{ miles(l.x.demandaMensual) }}</b> al mes
              </p>
              <p v-if="l.incluido && entero(l.cantidad) && faltaEnBodega(l)" class="falta">
                <Icono nombre="alerta" :tamano="16" :grosor="2.4" />
                {{ l.x.enBodega ? `Bodega solo tiene ${miles(l.x.enBodega)}: lo demás lo pide bodega al Área.` : 'Bodega no tiene: lo pide bodega al Área de Salud.' }}
              </p>
            </div>
            <div class="cantidad">
              <label :for="`c-${l.insumoId}`">Pedir</label>
              <input :id="`c-${l.insumoId}`" v-model="l.cantidad" inputmode="numeric" :disabled="!l.incluido" class="b-campo num" />
              <small v-if="l.sugerido && entero(l.cantidad) !== l.sugerido">Sugerido {{ miles(l.sugerido) }}</small>
            </div>
            <button type="button" class="quitar" :aria-label="`Quitar ${l.nombre}`" @click="lineas.splice(i, 1)"><Icono nombre="cerrar" :tamano="18" :grosor="2.4" /></button>
          </li>
        </ul>
        <p v-else class="b-vacio">Nada que pedir: todo alcanza para más de un mes.</p>

        <div class="agregar">
          <span class="b-etiqueta">Agregar otro medicamento</span>
          <BuscadorInsumo :insumos="catalogo" placeholder="Buscar medicamento" @elegir="agregar" />
        </div>
      </section>

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
          <p class="nota">Se imprime en la Requisición FOR-ASE-01 para firmarla.</p>
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

.lista, .tarjeta { display: grid; gap: 12px; padding: 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.lista-cabeza { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lista h2, .tarjeta h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.lista h2 span { margin-left: 6px; padding: 1px 9px; border-radius: 9px; background: #172A5A; color: #fff; font-size: 14px; }
.lista ul { display: grid; gap: 8px; }
.linea { display: grid; grid-template-columns: 44px minmax(0, 1fr) 130px 36px; align-items: center; gap: 12px; padding: 12px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px; box-shadow: inset 6px 0 0 var(--t); }
.linea.fuera { opacity: .55; }
.incluir { position: relative; display: grid; place-items: center; width: 44px; height: 44px; cursor: pointer; }
.incluir input { position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.caja { display: grid; place-items: center; width: 34px; height: 34px; border: 2px solid #CBD5E1; border-bottom-width: 4px; border-radius: 10px; color: transparent; }
.incluir input:checked + .caja { background: #22A06B; border-color: #17784F; color: #fff; }
.incluir input:focus-visible + .caja { outline: 3px solid #9FCDEC; }
.nombre { display: block; font-size: 17px; font-weight: 900; color: #14244A; }
.datos { margin-top: 2px; font-size: 14px; font-weight: 600; color: #475569; }
.datos b { font-weight: 900; color: #14244A; }
.estado { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 8px; background: var(--t-fondo); color: var(--t-tinta); font-size: 12.5px; font-weight: 900; }
.falta { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 13px; font-weight: 700; color: #8A4B00; }
.cantidad { display: grid; gap: 2px; }
.cantidad label { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; color: #64748B; }
.cantidad input { height: 52px; font-size: 20px; font-weight: 900; text-align: right; }
.cantidad small { font-size: 12px; font-weight: 700; color: #64748B; text-align: right; }
.quitar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: #94A3B8; }
.quitar:hover { background: #FDECEC; color: #A83232; }
@media (max-width: 640px) {
  .linea { grid-template-columns: 44px minmax(0, 1fr) 36px; }
  .cantidad { grid-column: 2 / 3; }
}
.agregar { display: grid; gap: 6px; padding-top: 6px; border-top: 2px dashed #E2E8F0; }

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
