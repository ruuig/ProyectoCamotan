<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import farmacia from '../../services/farmacia';
import bodega from '../../services/bodega';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import { usarBorrador, erroresPorRenglon } from '../../dominio/borrador';
import { useAuthStore } from '../../stores/auth';
import Icono from '../comunes/Icono.vue';
import { miles } from '../bodega/diseno/PiezasBodega';

/**
 * Requisición de la farmacia (post-consulta) a bodega, una vez al mes. El
 * BRES y el kardex tienen su propia entrada en el menú (Balance y Kardex).
 *      imprimen o se copian a mano.
 *   2. Pedir a bodega con las cantidades del BRES del mes en curso.
 *
 * El BRES del mes en curso va al día: su saldo es lo que hay en el estante y
 * su promedio (PMDR) es la demanda real (entregado + no entregado) de los tres
 * meses anteriores; los meses de antes del sistema salen del informe de
 * post-consulta cargado del Excel. Lo que se pide es la columna M: lo que falta
 * para llegar al nivel máximo. Las cantidades se pueden corregir.
 *
 * Se pide todo lo que dice el BRES: si bodega no tiene, ella lo pide a la
 * DDRISS. Antes de enviar se muestra el resumen para confirmarlo.
 */
const emit = defineEmits(['aviso', 'error']);
const auth = useAuthStore();

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const local = new Date(Date.now() - 6 * 3600000);
const hoy = local.toISOString().slice(0, 10);
const mesActual = hoy.slice(0, 7);
const nombreMes = (p) => MESES[Number(p.slice(5, 7)) - 1];
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;

const bres = ref(null);
// Lo que hay en el estante, por medicamento.
const existencias = ref([]);
const farmaciaId = ref(null);
const pedidos = ref([]);
const firmas = reactive({ solicita: auth.usuario?.nombre ?? '', vistoBueno: '' });
// Lo que se pide de cada medicamento; se guarda en el equipo por si los interrumpen.
const cantidades = reactive({});
const borrador = usarBorrador(`pedido-farmacia-${mesActual}`, { cantidades, firmas });

function llenar() {
  for (const k of Object.keys(cantidades)) delete cantidades[k];
  for (const r of bres.value?.renglones ?? []) {
    if (r.cantidadSolicitar > 0) cantidades[r.insumoId] = String(Math.ceil(r.cantidadSolicitar));
  }
}

async function cargarPedidos() {
  const [u, r] = await Promise.all([bodega.ubicaciones(), bodega.requisiciones()]);
  const lugar = u.ubicaciones.find((x) => x.tipo === 'centro_salud');
  farmaciaId.value = lugar?.id ?? null;
  pedidos.value = r.requisiciones.filter((x) => x.direccion === 'servicio' && x.ubicacion === lugar?.nombre);
}

async function cargar() {
  try {
    const [b, e] = await Promise.all([farmacia.bres(mesActual), farmacia.existencias(), cargarPedidos()]);
    existencias.value = e.insumos;
    bres.value = b;
    if (!borrador.recuperar()) llenar();
    if (!firmas.vistoBueno) firmas.vistoBueno = b.firmas?.coordinadorMunicipal ?? '';
  } catch (fallo) {
    emit('error', fallo.message);
  }
}
onMounted(cargar);

/* Una fila por medicamento del BRES: estante, consumo y lo que se pide. */
const filas = computed(() => {
  const estante = new Map(existencias.value.map((x) => [x.insumoId, x]));
  return (bres.value?.renglones ?? [])
    .map((r) => ({
      insumoId: r.insumoId,
      nombre: r.nombre,
      hay: estante.get(r.insumoId)?.entregable ?? r.saldoFinal,
      alMes: r.pmdr > 0 && r.pmdr < 1 ? 'menos de 1' : miles(Math.round(r.pmdr)),
      sugerido: Math.ceil(Math.max(0, r.cantidadSolicitar)),
    }))
    .sort((a, b) => Number(b.hay <= 0) - Number(a.hay <= 0) || a.nombre.localeCompare(b.nombre, 'es'));
});
// Se ve lo que se va a pedir; al buscar, cualquier medicamento, para agregarlo.
const buscar = ref('');
const aPedir = computed(() => filas.value.filter((f) => entero(cantidades[f.insumoId]) > 0));
const visibles = computed(() => {
  const q = sinTildes(buscar.value.trim());
  return q ? filas.value.filter((f) => sinTildes(f.nombre).includes(q)) : filas.value.filter((f) => f.sugerido > 0 || entero(cantidades[f.insumoId]) > 0);
});
const totalUnidades = computed(() => aPedir.value.reduce((s, f) => s + entero(cantidades[f.insumoId]), 0));
// El resumen se revisa antes de enviar.
const revisando = ref(false);

/* El pedido de este mes, si ya se hizo. */
const ESTADO = {
  solicitada: 'Enviado · espera a bodega',
  autorizada: 'Bodega lo autorizó',
  despachada: 'Ya está en el estante',
  parcial: 'Llegó una parte',
  recibida: 'Ya está en el estante',
};
const delMes = computed(() => pedidos.value.find((p) => String(p.fechaSolicitud ?? '').slice(0, 7) === mesActual && p.estado !== 'anulada') ?? null);
const fecha = (v) => new Date(v).toLocaleDateString('es-GT', { day: 'numeric', month: 'long', timeZone: 'UTC' });

const enviando = ref(false);
const errores = ref({});
async function enviar() {
  errores.value = {};
  enviando.value = true;
  const renglones = aPedir.value.map((f) => ({ insumoId: f.insumoId, cantidadSolicitada: entero(cantidades[f.insumoId]) }));
  try {
    const r = await bodega.crearRequisicion({
      ubicacionId: farmaciaId.value,
      fechaSolicitud: hoy,
      solicitante: firmas.solicita.trim(),
      jefe: firmas.vistoBueno.trim() || null,
      observaciones: `Pedido del mes con el BRES de farmacia de ${nombreMes(mesActual)}.`,
      renglones,
    }, nuevaClaveIdempotencia());
    revisando.value = false;
    emit('aviso', `Pedido enviado a bodega: ${renglones.length} medicamentos.`);
    window.open(`/imprimir/requisicion/${r.requisicion.id}`, '_blank');
    borrador.limpiar();
    await cargarPedidos();
  } catch (fallo) {
    revisando.value = false;
    errores.value = erroresPorRenglon(fallo, aPedir.value);
    emit('error', fallo.message);
  } finally {
    enviando.value = false;
  }
}
async function cancelar(p) {
  try {
    await bodega.anularRequisicion(p.id, 'Farmacia canceló el pedido antes de que bodega lo atendiera');
    emit('aviso', 'Pedido cancelado.');
    await cargarPedidos();
  } catch (fallo) {
    emit('error', fallo.message);
  }
}
</script>

<template>
  <div class="mes">
    <!-- El pedido a bodega, con las cantidades del BRES -->
    <section class="paso pedido">
      <div class="paso-cabeza">
        <div class="paso-txt">
          <b>Pedido de {{ nombreMes(mesActual) }} a bodega</b>
          <small v-if="bres">{{ aPedir.length }} medicamentos · {{ miles(totalUnidades) }} unidades</small>
        </div>
      </div>

      <div v-if="delMes" class="hecho">
        <Icono nombre="correcto" :tamano="22" :grosor="2.6" />
        <span class="min-w-0 flex-1"><b>Pedido del {{ fecha(delMes.fechaSolicitud) }}</b> · {{ ESTADO[delMes.estado] ?? delMes.estado }}</span>
        <RouterLink :to="`/imprimir/requisicion/${delMes.id}`" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Ver</RouterLink>
        <button v-if="delMes.estado === 'solicitada'" type="button" class="b-btn secundario chico" @click="cancelar(delMes)">Cancelar</button>
      </div>

      <template v-if="bres">
        <div class="herramientas">
          <label class="buscar">
            <Icono nombre="buscar" :tamano="20" />
            <input v-model="buscar" type="search" autocomplete="off" placeholder="Buscar medicamento" aria-label="Buscar medicamento" />
          </label>
        </div>

        <div class="tabla">
          <div class="fila cabeza">
            <span>Medicamento</span><span class="n">En estante</span><span class="n">Consumo al mes</span><span class="n">Pedir</span>
          </div>
          <div v-for="f in visibles" :key="f.insumoId" class="fila" :class="{ cero: f.hay <= 0 }">
            <span class="nombre">{{ f.nombre }}<small v-if="errores[f.insumoId]" class="error">{{ errores[f.insumoId] }}</small></span>
            <span class="n hay">{{ miles(f.hay) }}</span>
            <span class="n">{{ f.alMes }}</span>
            <span class="n">
              <input v-model="cantidades[f.insumoId]" inputmode="numeric" class="cant" :class="{ cambiada: entero(cantidades[f.insumoId]) !== f.sugerido }" :aria-label="`Pedir de ${f.nombre}`" placeholder="0" />
            </span>
          </div>
          <p v-if="!visibles.length" class="b-vacio">{{ buscar ? 'Ninguno con ese nombre.' : 'Nada por pedir.' }}</p>
        </div>

        <div class="pie">
          <label><span>Solicita</span><input v-model="firmas.solicita" class="b-campo" /></label>
          <label><span>Visto bueno</span><input v-model="firmas.vistoBueno" class="b-campo" /></label>
          <button type="button" class="b-btn primario enviar" :disabled="enviando || !aPedir.length || firmas.solicita.trim().length < 3 || !farmaciaId" @click="revisando = true">
            <Icono nombre="trasladar" :tamano="22" /> Revisar y enviar ({{ aPedir.length }})
          </button>
        </div>
      </template>
      <p v-else class="b-vacio">Cargando…</p>
    </section>

    <!-- Resumen antes de enviar -->
    <div v-if="revisando" class="velo" role="dialog" aria-modal="true" aria-labelledby="titulo-resumen" @click.self="revisando = false" @keydown.esc="revisando = false">
      <div class="ventana">
        <header>
          <h2 id="titulo-resumen">Pedido a bodega</h2>
          <p>{{ aPedir.length }} medicamentos · {{ miles(totalUnidades) }} unidades</p>
        </header>
        <ul class="resumen">
          <li v-for="f in aPedir" :key="f.insumoId">
            <span class="min-w-0 flex-1">{{ f.nombre }}</span>
            <b>{{ miles(entero(cantidades[f.insumoId])) }}</b>
          </li>
        </ul>
        <dl class="firmas">
          <div><dt>Solicita</dt><dd>{{ firmas.solicita }}</dd></div>
          <div><dt>Visto bueno</dt><dd>{{ firmas.vistoBueno || '—' }}</dd></div>
        </dl>
        <footer class="ventana-pie">
          <button type="button" class="b-btn secundario" @click="revisando = false">Seguir revisando</button>
          <button type="button" class="b-btn primario" :disabled="enviando" @click="enviar"><Icono nombre="trasladar" :tamano="20" /> {{ enviando ? 'Enviando…' : 'Enviar a bodega' }}</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mes { display: grid; gap: 16px; }
.paso { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 16px 18px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.paso.pedido { display: grid; gap: 12px; }
.paso-cabeza { display: flex; align-items: center; gap: 14px; }
.num { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 12px; background: #172A5A; color: #fff; font-size: 19px; font-weight: 900; }
.paso-txt { display: grid; flex: 1; min-width: 10rem; }
.paso-txt b { font-size: 19px; font-weight: 900; color: #14244A; }
.paso-txt small { font-size: 14px; font-weight: 700; color: #64748B; }
.paso-btns { display: flex; flex-wrap: wrap; gap: 8px; }

.hecho { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 14px; background: #E2F5EA; color: #145C3C; font-size: 15px; }
.hecho b { font-weight: 900; }

.herramientas { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.buscar { display: flex; flex: 1; min-width: 12rem; align-items: center; gap: 8px; height: 46px; padding: 0 14px; border: 2px solid #E5E9F0; border-radius: 14px; background: #fff; color: #64748B; }
.buscar:focus-within { border-color: #4A9BD6; }
.buscar input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: 16px; font-weight: 700; color: #14244A; }

.tabla { border: 2px solid #E5E9F0; border-radius: 16px; overflow: hidden; }
.fila { display: grid; grid-template-columns: minmax(0, 1fr) 100px 110px 110px; align-items: center; gap: 10px; padding: 8px 14px; border-top: 1px solid #EEF2F6; }
.fila.cabeza { border-top: 0; background: #F1F5F9; font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.cabeza .n { white-space: normal; line-height: 1.2; }
.fila:not(.cabeza):hover { background: #F7FBFE; }
.n { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: #334155; }
.nombre { min-width: 0; font-size: 15.5px; font-weight: 800; color: #14244A; overflow-wrap: anywhere; }
.nombre .error { display: block; font-size: 12.5px; font-weight: 700; color: #A52A2A; }
.fila.cero .hay { color: #A83232; font-weight: 900; }
.cant { width: 100%; height: 42px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 12px; text-align: right; font-size: 17px; font-weight: 900; color: #14244A; }
.cant:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.cant.cambiada { border-color: #E8930C; background: #FFF8EB; }
.tabla .b-vacio { padding: 20px; }

.pie { position: sticky; bottom: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 12px; padding: 12px 0 4px; background: #fff; }
.pie label { display: grid; gap: 4px; min-width: 0; }
.pie span { font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.enviar { height: 52px; padding: 0 22px; font-size: 17px; border-radius: 14px; }

.velo { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .5); }
.ventana { display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 12px; width: min(560px, 100%); max-height: calc(100vh - 32px); padding: 20px; border-radius: 22px; background: #fff; }
.ventana h2 { font-size: 22px; font-weight: 900; color: #14244A; }
.ventana header p { font-size: 15px; font-weight: 700; color: #475569; }
.resumen { overflow-y: auto; border: 2px solid #E5E9F0; border-radius: 14px; }
.resumen li { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1px solid #EEF2F6; font-size: 14.5px; font-weight: 700; color: #1E293B; }
.resumen li:first-child { border-top: 0; }
.resumen li b { font-variant-numeric: tabular-nums; color: #14244A; }
.firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.firmas dt { font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.firmas dd { font-size: 15px; font-weight: 800; color: #14244A; }
.ventana-pie { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }

@media (max-width: 760px) {
  .pie { position: static; grid-template-columns: 1fr; }
  .fila { grid-template-columns: minmax(0, 1fr) 64px 72px 92px; }
}
</style>
