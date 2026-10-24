<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { textoNumero, numerosDe } from '../../dominio/hojasRequisicion';
import { usarBorrador, erroresPorRenglon, renglonPedido } from '../../dominio/borrador';
import AvisoBorrador from '../../components/comunes/AvisoBorrador.vue';
import { RouterLink, useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import { useAuthStore } from '../../stores/auth';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../../components/comunes/Icono.vue';
import EditorPedido from '../../components/bodega/EditorPedido.vue';
import { miles, estiloTono } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Requisición de la bodega a la DDRISS.
 *
 * Todo lo que entra a la bodega llega por requisición. Esta sale ya llena con
 * la cantidad a pedir del BRES (columna M); bodega corrige, quita o agrega, la
 * imprime en el FOR-ASB-01 y la envía. Queda esperando hasta que la mercadería
 * llega y se recibe contra ella en «Recibir».
 */
const route = useRoute();
const auth = useAuthStore();
const ALMACEN = 'Almacén DDRISS Chiquimula';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (p) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const local = new Date(Date.now() - 6 * 3600000);
// El mes no se elige aquí: el servidor da el BRES que corresponde por la fecha
// (el último cerrado según el día de corte). Solo desde la pantalla del BRES se
// llega con un mes dado. Así no se pide con las cantidades de otro mes.
const pedido = /^\d{4}-\d{2}$/.test(route.query.periodo ?? '') ? route.query.periodo : null;
const periodo = ref(pedido);

const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;
const hoy = () => local.toISOString().slice(0, 10);
const sugerencia = ref(null);
const lineas = ref([]);
const enviadas = ref([]);
const cabecera = reactive({ solicitante: auth.usuario?.nombre ?? '', jefe: '', numero: '', observaciones: '' });
const error = ref('');
const aviso = ref('');
const enviando = ref(false);
const borrador = usarBorrador('ddriss', { lineas, cabecera, periodo }, { vacio: (d) => !d.lineas.length });
let primeraVez = true;
function empezarDeNuevo() { borrador.limpiar(); llenar(); }

const conDetalle = (r) => ({
  ...r,
  cantidad: r.sugerido ? String(r.sugerido) : '',
  sugerido: r.sugerido ?? 0,
  detalle: `En bodega ${miles(r.existencia)} · consumo ${miles(r.promedio)} al mes${r.meses != null ? ` · alcanza ${r.meses} meses` : ''}`,
});
function llenar() {
  lineas.value = (sugerencia.value?.renglones ?? []).map(conDetalle);
}
const catalogo = computed(() => (sugerencia.value?.catalogo ?? []).map((c) => ({ id: c.insumoId, nombreGenerico: c.nombre, codigoInterno: '' })));
function nuevoRenglon(i) {
  const c = sugerencia.value.catalogo.find((x) => x.insumoId === i.id);
  return { ...conDetalle({ ...c, sugerido: 0 }), cantidad: '' };
}
// Un producto recién creado entra al catálogo para poder pedirlo.
function creado(i) {
  sugerencia.value.catalogo.push({ insumoId: i.id, nombre: [i.nombreGenerico, i.concentracion].filter(Boolean).join(' '), unidad: i.unidadEntrega, existencia: 0, promedio: 0 });
}
const erroresRenglon = ref({});
const aEnviar = computed(() => lineas.value.filter((l) => entero(l.cantidad) > 0));

async function cargarSugerencia() {
  error.value = '';
  try {
    const delBorrador = periodo.value;
    sugerencia.value = await bodega.sugeridaDdriss(pedido);
    // La primera vez se retoma lo que se dejó a medias, pero solo si es del
    // mismo BRES: un borrador de otro mes se descarta para no mezclar cantidades.
    const retomar = primeraVez && borrador.recuperado.value && delBorrador === sugerencia.value.periodo;
    if (primeraVez && borrador.recuperado.value && !retomar) {
      borrador.limpiar();
      cabecera.numero = '';
      cabecera.observaciones = '';
    }
    periodo.value = sugerencia.value.periodo;
    if (!retomar) llenar();
    if (!cabecera.jefe) cabecera.jefe = sugerencia.value.firmas?.vistoBueno ?? '';
    primeraVez = false;
  } catch (fallo) {
    error.value = fallo.message;
  }
}
async function cargarEnviadas() {
  enviadas.value = (await bodega.requisiciones({ direccion: 'superior' })).requisiciones.slice(0, 10);
}

async function enviar() {
  erroresRenglon.value = {};
  error.value = '';
  enviando.value = true;
  try {
    const r = await bodega.crearRequisicion({
      direccion: 'superior',
      almacen: ALMACEN,
      numero: cabecera.numero.trim() || null,
      fechaSolicitud: hoy(),
      solicitante: cabecera.solicitante.trim(),
      jefe: cabecera.jefe.trim() || null,
      observaciones: cabecera.observaciones.trim() || null,
      renglones: aEnviar.value.map(renglonPedido),
    }, nuevaClaveIdempotencia());
    aviso.value = `Requisición a la DDRISS registrada con ${aEnviar.value.length} productos. Cuando llegue la mercadería, recíbala contra esta requisición en «Recibir».`;
    window.open(`/imprimir/requisicion/${r.requisicion.id}`, '_blank');
    lineas.value = [];
    borrador.limpiar();
    cabecera.numero = '';
    cabecera.observaciones = '';
    await cargarEnviadas();
  } catch (fallo) {
    erroresRenglon.value = erroresPorRenglon(fallo, aEnviar.value);
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const ESTADO = {
  solicitada: { texto: 'Esperando que llegue', tono: 'accion' },
  autorizada: { texto: 'Esperando que llegue', tono: 'accion' },
  parcial: { texto: 'Llegó una parte', tono: 'atencion' },
  recibida: { texto: 'Recibida', tono: 'bien' },
  despachada: { texto: 'Recibida', tono: 'bien' },
  anulada: { texto: 'Anulada', tono: 'critico' },
};
const esperando = (r) => ['solicitada', 'autorizada', 'parcial'].includes(r.estado);
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
async function anular(r) {
  try {
    await bodega.anularRequisicion(r.id, 'Bodega anuló la requisición antes de que llegara');
    await cargarEnviadas();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(() => { borrador.recuperar(); cargarSugerencia(); cargarEnviadas().catch((f) => { error.value = f.message; }); });
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div>
        <RouterLink to="/inventario/requisiciones" class="volver"><Icono nombre="volver" :tamano="16" /> Salidas</RouterLink>
        <p class="b-antetitulo">{{ sugerencia ? `BRES ${nombreMes(periodo)}` : 'Bodega' }}</p>
        <h1 class="b-titulo">Requisición</h1>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4" aria-live="polite">{{ aviso }}</p>

    <AvisoBorrador v-if="borrador.recuperado.value && lineas.length" class="mt-4" texto="Se recuperó la requisición que dejó a medias." @descartar="empezarDeNuevo" />

    <div class="rejilla mt-4">
      <EditorPedido v-model="lineas" :errores="erroresRenglon" :catalogo="catalogo" :nuevo-renglon="nuevoRenglon" puede-crear titulo="Qué pedir a la DDRISS" vacio="El BRES no pide nada este mes. Agregue lo que necesite." @volver-a-llenar="llenar" @creado="creado" />

      <aside class="lado">
        <section class="tarjeta">
          <h2>Datos de la requisición</h2>
          <div><label for="num" class="b-etiqueta">N.º del formulario <span class="b-opcional">opcional</span></label><input id="num" v-model="cabecera.numero" maxlength="20" class="b-campo font-mono" />
            <small v-if="numerosDe(cabecera.numero, aEnviar.map((l) => l.nombre)).length > 1" class="pista-hojas">Ocupa {{ numerosDe(cabecera.numero, aEnviar.map((l) => l.nombre)).length }} hojas: {{ textoNumero({ numeros: numerosDe(cabecera.numero, aEnviar.map((l) => l.nombre)) }) }}</small></div>
          <div><label for="sol" class="b-etiqueta">Solicita</label><input id="sol" v-model="cabecera.solicitante" class="b-campo" /></div>
          <div><label for="jefe" class="b-etiqueta">Visto bueno <span class="b-opcional">opcional</span></label><input id="jefe" v-model="cabecera.jefe" class="b-campo" /></div>
          <div><label for="obs" class="b-etiqueta">Observaciones <span class="b-opcional">opcional</span></label><textarea id="obs" v-model="cabecera.observaciones" rows="2" class="b-campo" /></div>
          <button type="button" class="b-btn primario enviar" :disabled="enviando || !sugerencia || !aEnviar.length || cabecera.solicitante.trim().length < 3" @click="enviar">
            <Icono nombre="imprimir" :tamano="22" /> {{ enviando ? 'Registrando…' : `Registrar e imprimir (${aEnviar.length})` }}
          </button>
        </section>

        <section class="tarjeta">
          <h2>Requisiciones a la DDRISS</h2>
          <ul v-if="enviadas.length" class="enviadas">
            <li v-for="r in enviadas" :key="r.id" class="enviada" :style="estiloTono(ESTADO[r.estado]?.tono ?? 'neutro')">
              <span class="min-w-0 flex-1">
                <b>{{ fecha(r.fechaSolicitud) }}<template v-if="r.numero"> · N.º {{ textoNumero(r) }}</template></b>
                <small>{{ ESTADO[r.estado]?.texto ?? r.estado }} · {{ r.renglones }} productos<template v-if="r.estado === 'parcial'"> · llegaron {{ miles(r.despachado) }} de {{ miles(r.solicitado) }}</template></small>
              </span>
              <span class="acciones">
                <RouterLink v-if="esperando(r)" :to="`/inventario/recibir?requisicion=${r.id}`" class="b-btn chico primario">Recibir</RouterLink>
                <RouterLink :to="`/imprimir/requisicion/${r.id}`" target="_blank" class="b-btn chico secundario" aria-label="Imprimir"><Icono nombre="imprimir" :tamano="16" /></RouterLink>
                <button v-if="r.estado === 'solicitada'" type="button" class="b-btn chico secundario" @click="anular(r)">Anular</button>
              </span>
            </li>
          </ul>
          <p v-else class="nota">Todavía no hay requisiciones a la DDRISS.</p>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.pista-hojas { display: block; margin-top: 4px; font-size: 13px; font-weight: 800; color: #174E80; }
.volver { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 4px; font-size: 14px; font-weight: 700; color: #475569; }
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
@media (max-width: 1100px) { .rejilla { grid-template-columns: 1fr; } }
.lado { display: grid; gap: 16px; }
.tarjeta { display: grid; gap: 12px; padding: 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.tarjeta h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.enviar { width: 100%; height: 60px; font-size: 17px; border-radius: 16px; }
.nota { font-size: 13px; font-weight: 600; color: #64748B; }
.enviadas { display: grid; gap: 8px; }
.enviada { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 14px; background: var(--t-fondo); color: var(--t-tinta); }
.enviada b { display: block; font-size: 14px; font-weight: 900; color: #14244A; }
.enviada small { display: block; font-size: 13px; font-weight: 700; }
.enviada > span:first-child { flex: 1 1 180px; }
.acciones { display: flex; gap: 6px; }
</style>
