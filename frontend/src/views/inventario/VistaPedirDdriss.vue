<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { textoNumero, numerosDe } from '../../dominio/hojasRequisicion';
import { usarBorrador, erroresPorRenglon, renglonPedido } from '../../dominio/borrador';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import { useAuthStore } from '../../stores/auth';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../../components/comunes/Icono.vue';
import EditorPedido from '../../components/bodega/EditorPedido.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Requisición de la bodega a la DDRISS.
 *
 * Todo lo que entra a la bodega llega por requisición. Esta sale ya llena con
 * la cantidad a pedir del BRES (columna M); bodega corrige, quita o agrega, la
 * imprime en el FOR-ASB-01 y la envía. Queda esperando hasta que la mercadería
 * llega y se recibe contra ella en «Recibir» (ahí se ven, se reimprimen o se
 * anulan las requisiciones enviadas).
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
const cabecera = reactive({ solicitante: auth.usuario?.nombre ?? '', jefe: '', numero: '', observaciones: '' });
const error = ref('');
const aviso = ref('');
const enviando = ref(false);
const borrador = usarBorrador('ddriss', { lineas, cabecera, periodo }, { vacio: (d) => !d.lineas.length });
let primeraVez = true;

// Columnas de cada renglón: lo que hay, lo que se consume y para cuánto alcanza.
const COLUMNAS = ['En bodega', 'Consumo / mes', 'Meses'];
const conDetalle = (r) => ({
  ...r,
  cantidad: r.sugerido ? String(r.sugerido) : '',
  sugerido: r.sugerido ?? 0,
  datos: [miles(r.existencia), miles(r.promedio), r.meses ?? '—'],
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
const totalUnidades = computed(() => aEnviar.value.reduce((s, l) => s + entero(l.cantidad), 0));
// El resumen se revisa antes de registrar.
const revisando = ref(false);

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

async function enviar() {
  revisando.value = false;
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
    aviso.value = `Requisición registrada: ${aEnviar.value.length} productos.`;
    window.open(`/imprimir/requisicion/${r.requisicion.id}`, '_blank');
    lineas.value = [];
    borrador.limpiar();
    cabecera.numero = '';
    cabecera.observaciones = '';
  } catch (fallo) {
    erroresRenglon.value = erroresPorRenglon(fallo, aEnviar.value);
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

onMounted(() => { borrador.recuperar(); cargarSugerencia(); });
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div>
        <p class="b-antetitulo">{{ sugerencia ? `BRES ${nombreMes(periodo)}` : 'Bodega' }}</p>
        <h1 class="b-titulo">Requisición</h1>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4" aria-live="polite">{{ aviso }}</p>

    <div class="rejilla mt-4">
      <EditorPedido v-model="lineas" :errores="erroresRenglon" :catalogo="catalogo" :nuevo-renglon="nuevoRenglon" :columnas="COLUMNAS" puede-crear @creado="creado" />

      <aside class="lado">
        <section class="tarjeta">
          <div><label for="num" class="b-etiqueta">N.º del formulario <span class="b-opcional">opcional</span></label><input id="num" v-model="cabecera.numero" maxlength="20" class="b-campo font-mono" />
            <small v-if="numerosDe(cabecera.numero, aEnviar.map((l) => l.nombre)).length > 1" class="pista-hojas">Ocupa {{ numerosDe(cabecera.numero, aEnviar.map((l) => l.nombre)).length }} hojas: {{ textoNumero({ numeros: numerosDe(cabecera.numero, aEnviar.map((l) => l.nombre)) }) }}</small></div>
          <div><label for="sol" class="b-etiqueta">Solicita</label><input id="sol" v-model="cabecera.solicitante" class="b-campo" /></div>
          <div><label for="jefe" class="b-etiqueta">Visto bueno <span class="b-opcional">opcional</span></label><input id="jefe" v-model="cabecera.jefe" class="b-campo" /></div>
          <div><label for="obs" class="b-etiqueta">Observaciones <span class="b-opcional">opcional</span></label><textarea id="obs" v-model="cabecera.observaciones" rows="2" class="b-campo" /></div>
          <button type="button" class="b-btn primario enviar" :disabled="enviando || !sugerencia || !aEnviar.length || cabecera.solicitante.trim().length < 3" @click="revisando = true">
            <Icono nombre="correcto" :tamano="22" /> {{ enviando ? 'Registrando…' : `Revisar y registrar (${aEnviar.length})` }}
          </button>
        </section>

      </aside>
    </div>

    <!-- Resumen antes de registrar -->
    <div v-if="revisando" class="velo" role="dialog" aria-modal="true" aria-labelledby="titulo-resumen" @click.self="revisando = false" @keydown.esc="revisando = false">
      <div class="ventana">
        <header>
          <h2 id="titulo-resumen">Requisición a la DDRISS</h2>
          <p>{{ aEnviar.length }} productos · {{ miles(totalUnidades) }} unidades</p>
        </header>
        <ul class="resumen">
          <li v-for="l in aEnviar" :key="l.insumoId">
            <span class="min-w-0 flex-1">{{ l.nombre }}</span>
            <b>{{ miles(entero(l.cantidad)) }}</b>
            <small>{{ l.unidad }}</small>
          </li>
        </ul>
        <dl class="firmas">
          <div><dt>N.º del formulario</dt><dd>{{ cabecera.numero || '—' }}</dd></div>
          <div><dt>Solicita</dt><dd>{{ cabecera.solicitante }}</dd></div>
          <div><dt>Visto bueno</dt><dd>{{ cabecera.jefe || '—' }}</dd></div>
          <div v-if="cabecera.observaciones.trim()" class="col-span-full"><dt>Observaciones</dt><dd>{{ cabecera.observaciones }}</dd></div>
        </dl>
        <footer class="ventana-pie">
          <button type="button" class="b-btn secundario" @click="revisando = false">Seguir revisando</button>
          <button type="button" class="b-btn primario" :disabled="enviando" @click="enviar"><Icono nombre="imprimir" :tamano="20" /> {{ enviando ? 'Registrando…' : 'Registrar e imprimir' }}</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pista-hojas { display: block; margin-top: 4px; font-size: 13px; font-weight: 800; color: #174E80; }
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
@media (max-width: 1100px) { .rejilla { grid-template-columns: 1fr; } }
.lado { display: grid; gap: 16px; }
.tarjeta { display: grid; gap: 12px; padding: 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.tarjeta h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.enviar { width: 100%; height: 60px; font-size: 17px; border-radius: 16px; }

.velo { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .5); }
.ventana { display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 12px; width: min(620px, 100%); max-height: calc(100vh - 32px); padding: 20px; border-radius: 22px; background: #fff; }
.ventana h2 { font-size: 22px; font-weight: 900; color: #14244A; }
.ventana header p { font-size: 15px; font-weight: 700; color: #475569; }
.resumen { overflow-y: auto; border: 2px solid #E5E9F0; border-radius: 14px; }
.resumen li { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1px solid #EEF2F6; font-size: 14.5px; font-weight: 700; color: #1E293B; }
.resumen li:first-child { border-top: 0; }
.resumen li b { font-variant-numeric: tabular-nums; color: #14244A; }
.resumen li small { width: 62px; font-size: 12.5px; font-weight: 700; color: #64748B; }
.firmas { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.firmas dt { font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.firmas dd { font-size: 15px; font-weight: 800; color: #14244A; overflow-wrap: anywhere; }
.ventana-pie { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
@media (max-width: 560px) { .firmas { grid-template-columns: 1fr; } }
</style>
