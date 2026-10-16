<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import farmacia from '../../services/farmacia';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../../components/comunes/Icono.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import EstanteFarmacia from '../../components/farmacia/EstanteFarmacia.vue';
import PedidoFarmacia from '../../components/farmacia/PedidoFarmacia.vue';
import HoyFarmacia from '../../components/farmacia/HoyFarmacia.vue';

/**
 * Control diario de la farmacia.
 *
 * El día: con cuánto abrió cada medicamento, lo que llegó de bodega, lo que
 * se entregó a los pacientes y lo que no se pudo entregar, y con cuánto
 * cierra. Al final del día se cuenta lo que hay en el estante; si no
 * coincide, se explica por qué y el sistema ajusta la existencia.
 *
 * La existencia: lo que hay en farmacia, lote por lote, con su vencimiento.
 * Lo que va a vencer se devuelve a bodega.
 */
const hoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
// Cuatro preguntas: ¿qué tengo? (estante), ¿qué me falta? (pedir),
// ¿qué entró y salió? (hoy) y ¿cuadra? (contar).
const PESTANAS = [
  { clave: 'existencias', texto: 'Estante', pregunta: '¿Qué tengo?', icono: 'inventario' },
  { clave: 'pedir', texto: 'Pedir a bodega', pregunta: '¿Qué me falta?', icono: 'trasladar' },
  { clave: 'hoy', texto: 'Hoy', pregunta: '¿Qué entró y qué salió?', icono: 'recibir' },
  { clave: 'contar', texto: 'Contar', pregunta: '¿Cuadra lo que hay?', icono: 'correcto' },
];
const route = useRoute();
const router = useRouter();
const pestana = ref(PESTANAS.some((p) => p.clave === route.query.pestana) ? route.query.pestana : 'existencias');
const fecha = ref(hoy);
const dia = ref(null);
const existencias = ref([]);
const buscar = ref('');
const error = ref('');
const aviso = ref('');
const enviando = ref(false);
const contando = ref(false);
const conteo = reactive({});
const motivos = reactive({});
const observacion = ref('');

async function cargarDia() {
  error.value = '';
  try {
    dia.value = await farmacia.dia(fecha.value);
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function cargarExistencias() {
  error.value = '';
  try {
    existencias.value = (await farmacia.existencias()).insumos;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

watch(fecha, cargarDia);
watch(pestana, (p) => {
  router.replace({ query: { pestana: p } });
  if (p === 'existencias' || p === 'pedir') cargarExistencias();
  else cargarDia();
});
const porPedir = computed(() => existencias.value.filter((x) => x.pedir > 0).length);



const entero = (v) => (String(v ?? '').trim() === '' ? null : Number(String(v).replace(/[^0-9]/g, '')));
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const filasDia = computed(() => (dia.value?.filas ?? []).filter((f) => !buscar.value || sinTildes(f.nombre).includes(sinTildes(buscar.value))));

// --- Cierre del día --------------------------------------------------------------

function empezarConteo() {
  for (const k of Object.keys(conteo)) delete conteo[k];
  for (const k of Object.keys(motivos)) delete motivos[k];
  contando.value = true;
  aviso.value = '';
}

const diferencia = (f) => {
  const c = entero(conteo[f.insumoId]);
  return c === null ? null : c - f.saldoFinal;
};
const contados = computed(() => (dia.value?.filas ?? []).filter((f) => entero(conteo[f.insumoId]) !== null));
const faltaMotivo = computed(() => contados.value.some((f) => diferencia(f) !== 0 && !String(motivos[f.insumoId] ?? '').trim()));

async function cerrarDia() {
  error.value = '';
  enviando.value = true;
  try {
    const r = await farmacia.cerrarDia({
      conteos: contados.value.map((f) => ({
        insumoId: f.insumoId,
        contado: entero(conteo[f.insumoId]),
        ...(diferencia(f) !== 0 ? { motivo: motivos[f.insumoId].trim() } : {}),
      })),
      observacion: observacion.value.trim() || null,
    }, nuevaClaveIdempotencia());
    aviso.value = r.ajustes.length
      ? `Día cerrado. Se ajustaron ${r.ajustes.length} ${r.ajustes.length === 1 ? 'lote' : 'lotes'} por las diferencias del conteo.`
      : 'Día cerrado. Lo contado coincide con el sistema.';
    contando.value = false;
    await cargarDia();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const SEMAFORO = { vencido: 'Vencido', rojo: 'Menos de 12 meses', amarillo: '12 a 18 meses', verde: 'Más de 18 meses', sin_fecha: 'Sin fecha' };
const fechaCorta = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const hora = (v) => (v ? new Date(v).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) : '');
// Imprimir: el informe del inventario de un día (por defecto hoy), en su propia hoja.
const fechaInforme = ref(hoy);
const eligiendoFecha = ref(false);
function imprimir() {
  window.open(`/imprimir/inventario-farmacia?fecha=${fechaInforme.value}`, '_blank');
  eligiendoFecha.value = false;
}

onMounted(() => { cargarDia(); cargarExistencias(); });


</script>

<template>
  <section>
    <RouterLink to="/dispensacion" class="b-volver no-imprimir"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Dispensación</RouterLink>
    <header class="b-cabecera">
      <div>
        <p class="b-antetitulo">Farmacia</p>
        <h1 class="b-titulo">Estante y pedidos</h1>
      </div>
      <div class="relative no-imprimir">
        <button type="button" class="b-btn secundario" @click="eligiendoFecha = !eligiendoFecha"><Icono nombre="imprimir" :tamano="20" /> Imprimir</button>
        <div v-if="eligiendoFecha" class="elegir-informe">
          <b>Informe del inventario</b>
          <label for="fecha-informe" class="b-etiqueta">Día</label>
          <input id="fecha-informe" v-model="fechaInforme" type="date" :max="hoy" class="b-campo" />
          <button type="button" class="b-btn primario w-full" :disabled="!fechaInforme" @click="imprimir"><Icono nombre="imprimir" :tamano="18" /> Imprimir</button>
        </div>
      </div>
    </header>

    <nav class="pestanas-grandes mt-5 no-imprimir" aria-label="Estante y pedidos">
      <button v-for="p in PESTANAS" :key="p.clave" type="button" :class="{ on: pestana === p.clave }" :aria-current="pestana === p.clave ? 'page' : undefined" @click="pestana = p.clave">
        <Icono :nombre="p.icono" :tamano="24" />
        <span><b>{{ p.texto }}<span v-if="p.clave === 'pedir' && porPedir" class="globo">{{ porPedir }}</span></b><small>{{ p.pregunta }}</small></span>
      </button>
    </nav>

    <p v-if="aviso" class="b-aviso ok mt-4 no-imprimir" aria-live="polite">{{ aviso }}</p>
    <p v-if="error" role="alert" class="b-aviso error mt-4 no-imprimir">{{ error }}</p>

    <div class="mt-5 flex flex-wrap items-end gap-3 no-imprimir">
      <label v-if="pestana === 'existencias' || pestana === 'contar'" class="buscador">
        <Icono nombre="buscar" :tamano="24" :grosor="2.4" />
        <input v-model="buscar" type="search" autocomplete="off" placeholder="Buscar medicamento" aria-label="Buscar medicamento" />
      </label>
    </div>

    <!-- ===== El día ===== -->
    <template v-if="(pestana === 'contar' || pestana === 'hoy') && dia">
      <template v-if="pestana === 'contar'">

      <div v-if="dia.cierre" class="b-aviso ok mt-4">
        <Icono nombre="correcto" :tamano="20" />
        <span>Día cerrado por {{ dia.cierre.cerradoPor }} a las {{ hora(dia.cierre.cerradoEn) }}.
          {{ dia.cierre.conteos.filter((c) => c.diferencia).length ? `${dia.cierre.conteos.filter((c) => c.diferencia).length} medicamento(s) con diferencia.` : 'Lo contado coincidió con el sistema.' }}</span>
      </div>
      <div v-else-if="dia.esHoy && !contando" class="mt-4 flex justify-end no-imprimir">
        <button type="button" class="b-btn primario grande" @click="empezarConteo"><Icono nombre="lapiz" :tamano="22" /> Empezar a contar</button>
      </div>

      <div class="b-tabla-marco mt-4">
        <table class="b-tabla">
          <thead>
            <tr>
              <th>Medicamento</th>
              <th class="text-right">Debe haber</th>
              <th v-if="contando" class="text-right">Contado</th>
              <th v-if="contando" class="text-right">Diferencia</th>
              <th v-if="contando">Por qué</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in filasDia" :key="f.insumoId">
              <td class="font-semibold text-tinta">{{ f.nombre }}</td>
              <td class="text-right"><b class="debe">{{ miles(f.saldoFinal) }}</b></td>
              <td v-if="contando" class="text-right">
                <input v-model="conteo[f.insumoId]" inputmode="numeric" :aria-label="`Contado de ${f.nombre}`" class="b-campo num contado" />
              </td>
              <td v-if="contando" class="text-right">
                <span v-if="diferencia(f) !== null" class="dif" :class="diferencia(f) === 0 ? 'ok' : diferencia(f) < 0 ? 'menos' : 'mas'">
                  {{ diferencia(f) === 0 ? 'Cuadra' : `${diferencia(f) > 0 ? '+' : ''}${diferencia(f)}` }}
                </span>
              </td>
              <td v-if="contando">
                <input v-if="diferencia(f)" v-model="motivos[f.insumoId]" :aria-label="`Motivo de la diferencia de ${f.nombre}`" placeholder="Ej.: frasco quebrado" class="b-campo" />
              </td>
            </tr>
            <tr v-if="!filasDia.length"><td :colspan="contando ? 5 : 2" class="b-vacio">Sin existencia.</td></tr>
          </tbody>
        </table>
      </div>

      <div v-if="contando" class="b-panel mt-4 p-4 no-imprimir">
        <label for="obs-cierre" class="b-etiqueta">Observación del día <span class="b-opcional">opcional</span></label>
        <input id="obs-cierre" v-model="observacion" class="b-campo" />
        <div class="mt-3 flex justify-end gap-2">
          <button type="button" class="b-btn secundario" @click="contando = false">Cancelar</button>
          <button type="button" class="b-btn exito grande" :disabled="enviando || !contados.length || faltaMotivo" @click="cerrarDia">
            {{ enviando ? 'Cerrando…' : `Cerrar el día (${contados.length} contados)` }}
          </button>
        </div>
      </div>

      </template>

      <template v-else>
        <HoyFarmacia v-model:fecha="fecha" class="mt-4" :dia="dia" :hoy="hoy" />
      </template>
    </template>

    <!-- ===== Estante ===== -->
    <EstanteFarmacia
      v-if="pestana === 'existencias'" class="mt-4" :existencias="existencias" :buscar="buscar"
      @recargar="cargarExistencias" @aviso="(t) => (aviso = t)" @error="(t) => (error = t)" @pedir="pestana = 'pedir'"
    />

    <!-- ===== Pedir a bodega ===== -->
    <PedidoFarmacia v-if="pestana === 'pedir'" class="mt-4" :existencias="existencias" @aviso="(t) => (aviso = t)" @error="(t) => (error = t)" />
  </section>
</template>

<style scoped>
.pestanas-grandes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.globo { margin-left: 8px; padding: 1px 9px; border-radius: 9px; background: #D64545; color: #fff; font-size: 13px; vertical-align: 2px; }
.solo-imprimir { display: none; }
.elegir-informe { position: absolute; right: 0; top: calc(100% + 8px); z-index: 30; display: grid; gap: 8px; width: 260px; padding: 16px;
  background: #fff; border: 2px solid #172A5A; border-bottom-width: 4px; border-radius: 16px; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, .35); }
.elegir-informe b { color: #14244A; font-size: 16px; }
.pestanas-grandes button { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border: 2px solid #E2E8F0; border-bottom-width: 5px; border-radius: 18px; background: #fff; text-align: left; color: #475569; transition: transform .06s; }
.pestanas-grandes button:active { transform: translateY(2px); border-bottom-width: 3px; }
.pestanas-grandes button svg { flex-shrink: 0; color: #2F83C4; }
.pestanas-grandes b { display: block; font-size: 18px; font-weight: 900; color: #14244A; }
.pestanas-grandes small { display: block; font-size: 13px; font-weight: 700; color: #64748B; }
.pestanas-grandes button.on { background: #EAF3FB; border-color: #4A9BD6; border-bottom-color: #2F83C4; }
@media (max-width: 1000px) { .pestanas-grandes { grid-template-columns: 1fr 1fr; } }
.b-btn.grande { height: 56px; padding: 0 26px; border-radius: 16px; font-size: 17px; }
.debe { font-size: 17px; font-weight: 900; color: #14244A; }
.dif { display: inline-block; min-width: 64px; padding: 3px 10px; border-radius: 9px; font-weight: 900; text-align: center; }
.dif.ok { background: #E2F5EA; color: #145C3C; }
.dif.menos { background: #FDECEC; color: #A52A2A; }
.dif.mas { background: #FFF4D6; color: #8A5A06; }
.contador-pestana { margin-left: 4px; min-width: 22px; padding: 0 7px; border-radius: 8px; background: #172A5A; color: #fff; font-size: 12px; }
/* --- Buscador ---------------------------------------------------------------- */
.buscador { display: flex; flex: 1; min-width: 16rem; align-items: center; gap: 10px; height: 56px; padding: 0 16px; background: #fff; color: #64748B;
  border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; }
.buscador:focus-within { border-color: #4A9BD6; border-bottom-color: #2F83C4; color: #2F83C4; box-shadow: 0 0 0 4px rgba(74, 155, 214, .15); }
.buscador input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: 17px; font-weight: 700; color: #14244A; }
.buscador input::placeholder { font-weight: 600; color: #94A3B8; }

.poner-med { display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; background: #FFF7E6; }
.poner-med b { color: #14244A; }
.poner-med span { font-size: 13px; font-weight: 700; color: #8A5A06; }
.grande-campo { height: 52px; font-size: 18px; }
.tarjetas { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .tarjetas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tarjeta { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; }
.tarjeta span { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.tarjeta b { font-size: 28px; line-height: 1; color: #14244A; font-variant-numeric: tabular-nums; }
.tarjeta.alerta b { color: #8A5A06; }
.contado { width: 84px; height: 34px; margin-left: auto; }
/* El nombre del medicamento no se pierde al desplazar la tabla. */
.b-tabla :is(th, td):first-child { position: sticky; left: 0; z-index: 1; min-width: 200px; background: #fff; }
.b-tabla th:first-child { z-index: 2; background: #F1F5F9; }
.grupo span { margin-left: 4px; color: #14244A; }
.bodega li { padding: 12px 16px; }
.bodega li + li { border-top: 1px solid #EEF2F6; }
.lote { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 0; }
.punto { width: 10px; height: 10px; border-radius: 50%; background: #94A3B8; }
.punto.vencido { background: #111827; }
.punto.rojo { background: #C03535; }
.punto.amarillo { background: #D9A400; }
.punto.verde { background: #1E8E5E; }
.fondo { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
.ventana { width: min(460px, 100%); }
@media print {
  .no-imprimir { display: none !important; }
  .solo-imprimir { display: block; }
}
</style>
