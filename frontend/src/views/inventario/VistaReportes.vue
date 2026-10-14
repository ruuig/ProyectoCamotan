<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import PasosCierre from '../../components/bodega/PasosCierre.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import { estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';
import { cierre } from '../../dominio/bodega';

/**
 * Paso 1 del cierre: el reporte mensual de cada puesto y centro comunitario.
 * Las entradas vienen de los traslados de la bodega; se captura lo entregado,
 * lo no entregado y el saldo que manda el servicio. Enter baja de fila.
 */
const estado = ref(null);
const elegido = ref(null);
const form = ref(null);
const alcance = ref('maneja');
const error = ref('');
const aviso = ref('');
const guardando = ref(false);
const observacionRevision = ref('');

async function cargarEstado() {
  try {
    estado.value = await bodega.estadoReportes(cierre.periodo);
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function abrir(s) {
  error.value = '';
  aviso.value = '';
  elegido.value = s;
  try {
    form.value = await bodega.reporte(s.ubicacionId, cierre.periodo);
    await nextTick();
    document.getElementById('r-0-e')?.focus();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function cerrar() {
  form.value = null;
  elegido.value = null;
  aviso.value = '';
}

watch(() => cierre.periodo, () => {
  cerrar();
  cargarEstado();
});

const servicios = computed(() => estado.value?.servicios ?? []);
const grupos = computed(() => ({
  diferencia: servicios.value.filter((s) => s.reportado && s.diferencias && !s.revisado),
  pendiente: servicios.value.filter((s) => !s.reportado),
  listo: servicios.value.filter((s) => s.reportado && !(s.diferencias && !s.revisado)),
}));
const FILTROS = [
  { clave: 'todos', texto: 'Todos' },
  { clave: 'diferencia', texto: 'No cuadran' },
  { clave: 'pendiente', texto: 'Pendientes' },
  { clave: 'listo', texto: 'Listos' },
];
const ACCION = { diferencia: 'Revisar', pendiente: 'Capturar', listo: 'Ver' };
const ORDEN = { diferencia: 0, pendiente: 1, listo: 2 };
const filtroEstado = ref('todos');
const lugares = computed(() => ['diferencia', 'pendiente', 'listo']
  .flatMap((e) => grupos.value[e].map((s) => ({ ...s, estado: e })))
  .filter((s) => filtroEstado.value === 'todos' || s.estado === filtroEstado.value)
  .sort((x, y) => ORDEN[x.estado] - ORDEN[y.estado]));

const visibles = computed(() => (form.value?.renglones ?? []).filter((r) => alcance.value === 'todos' || r.maneja || r.entregado || r.noEntregado));

const vacio = (v) => v === null || v === undefined || v === '';
const numero = (v) => (vacio(v) ? 0 : Number(String(v).replace(/[^\d]/g, '')) || 0);
const saldoSiguiente = (r) => r.saldoAnterior + r.entradas - numero(r.entregado);
const diferenciaSaldo = (r) => (vacio(r.saldoReportado) ? null : numero(r.saldoReportado) - saldoSiguiente(r));
const diferenciaEntradas = (r) => (vacio(r.entradasReportadas) ? null : numero(r.entradasReportadas) - r.entradas);
const conDiferencia = computed(() => visibles.value.filter((r) => diferenciaSaldo(r) || diferenciaEntradas(r)).length);

/** Enter baja a la misma columna de la fila siguiente. */
function bajar(evento, i, columna) {
  evento.preventDefault();
  document.getElementById(`r-${i + 1}-${columna}`)?.focus();
}

async function guardar() {
  error.value = '';
  aviso.value = '';
  guardando.value = true;
  try {
    const r = await bodega.guardarReporte(elegido.value.ubicacionId, cierre.periodo, {
      renglones: form.value.renglones
        .filter((x) => x.maneja || numero(x.entregado) || numero(x.noEntregado) || !vacio(x.saldoReportado))
        .map((x) => ({
          insumoId: x.insumoId,
          entregado: numero(x.entregado),
          noEntregado: numero(x.noEntregado),
          saldoReportado: vacio(x.saldoReportado) ? null : numero(x.saldoReportado),
          entradasReportadas: vacio(x.entradasReportadas) ? null : numero(x.entradasReportadas),
        })),
    });
    aviso.value = r.diferencias ? `Reporte guardado. ${r.diferencias} insumo(s) no cuadran.` : 'Reporte guardado. Todo cuadra.';
    await Promise.all([cargarEstado(), abrir(elegido.value)]);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

async function aceptarDiferencias() {
  try {
    await bodega.revisarReporte(elegido.value.ubicacionId, cierre.periodo, observacionRevision.value);
    observacionRevision.value = '';
    aviso.value = 'Diferencias aceptadas.';
    await Promise.all([cargarEstado(), abrir(elegido.value)]);
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargarEstado);
</script>

<template>
  <section>
    <PasosCierre :estado="{ reportes: estado ? `${grupos.listo.length} de ${servicios.length} listos` : '' }" />

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4" aria-live="polite">{{ aviso }}</p>

    <!-- Tablero de los servicios -->
    <template v-if="estado && !form">
      <div class="avance mt-4">
        <div class="flex items-baseline gap-2 whitespace-nowrap">
          <span class="text-[34px] font-bold leading-none tabular-nums text-tinta">{{ grupos.listo.length }}</span>
          <span class="text-xl font-bold text-apagado">/ {{ servicios.length }}</span>
          <span class="b-antetitulo ml-1">reportes listos</span>
        </div>
        <div class="barra" aria-hidden="true">
          <span class="ok" :style="{ flexGrow: grupos.listo.length }" />
          <span class="rev" :style="{ flexGrow: grupos.diferencia.length }" />
          <span class="pen" :style="{ flexGrow: grupos.pendiente.length }" />
        </div>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3">
        <div class="b-segmentado" role="radiogroup" aria-label="Estado">
          <button v-for="o in FILTROS" :key="o.clave" type="button" role="radio" :aria-checked="filtroEstado === o.clave" :class="filtroEstado === o.clave ? 'on' : ''" @click="filtroEstado = o.clave">
            {{ o.texto }} <span class="tabular-nums text-apagado">{{ o.clave === 'todos' ? servicios.length : grupos[o.clave].length }}</span>
          </button>
        </div>
      </div>

      <ul class="lugares mt-3">
        <li v-for="s in lugares" :key="s.ubicacionId" class="lugar">
          <span class="marca" :class="s.estado" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-tinta">{{ s.nombre }}</span>
            <small v-if="s.estado === 'diferencia'" class="text-[#B7710A]">{{ s.diferencias }} {{ s.diferencias === 1 ? 'insumo' : 'insumos' }} sin cuadrar</small>
            <small v-else-if="s.estado === 'pendiente'">Sin reporte</small>
            <small v-else>{{ new Date(s.capturadoEn).toLocaleDateString('es-GT') }} · {{ s.capturadoPor }}</small>
          </span>
          <button type="button" class="b-btn chico" :class="s.estado === 'listo' ? 'secundario' : 'primario'" @click="abrir(s)">{{ ACCION[s.estado] }}</button>
        </li>
        <li v-if="!lugares.length" class="b-vacio col-span-full">Ningún servicio en este estado.</li>
      </ul>
    </template>

    <!-- Captura de un servicio -->
    <form v-if="form" class="mt-4" @submit.prevent="guardar">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <button type="button" class="b-btn secundario chico" @click="cerrar"><Icono nombre="volver" :tamano="16" :grosor="2.2" /> Servicios</button>
          <div>
            <h2 class="text-[22px] font-semibold leading-tight text-tinta">{{ form.ubicacion.nombre }}</h2>
            <p class="text-sm font-semibold text-apagado">
              <template v-if="form.reporte">Capturado por {{ form.reporte.capturadoPor }} · {{ new Date(form.reporte.capturadoEn).toLocaleDateString('es-GT') }}</template>
              <template v-else>Sin capturar</template>
            </p>
          </div>
        </div>
        <div class="b-segmentado" role="radiogroup" aria-label="Insumos">
          <button v-for="o in [['maneja', 'Los que maneja'], ['todos', 'Todos']]" :key="o[0]" type="button" role="radio" :aria-checked="alcance === o[0]" :class="alcance === o[0] ? 'on' : ''" @click="alcance = o[0]">{{ o[1] }}</button>
        </div>
      </div>

      <div class="b-tabla-marco captura mt-3">
        <table class="b-tabla">
          <thead>
            <tr>
              <th>Insumo</th>
              <th class="n">Saldo anterior</th>
              <th class="n">Entradas</th>
              <th class="n col-captura">Entregado</th>
              <th class="n col-captura">No entregado</th>
              <th class="n">Saldo</th>
              <th class="n col-captura">Saldo del servicio</th>
              <th class="n col-captura">Entradas del servicio</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in visibles" :key="r.insumoId">
              <td>
                <span class="flex items-center gap-2.5">
                  <span class="cat-mini" :style="estiloCategoria(r.categoria)"><Pictograma :categoria="r.categoria" :grosor="2" /></span>
                  <span class="font-semibold text-tinta">{{ r.nombre }}</span>
                </span>
              </td>
              <td class="n" :class="!r.saldoAnterior ? 'cero' : ''">{{ r.saldoAnterior ? miles(r.saldoAnterior) : '–' }}</td>
              <td class="n" :class="!r.entradas ? 'cero' : ''">{{ r.entradas ? miles(r.entradas) : '–' }}</td>
              <td class="n col-captura"><input :id="`r-${i}-e`" v-model="r.entregado" inputmode="numeric" :aria-label="`Entregado de ${r.nombre}`" class="celda" @keydown.enter="bajar($event, i, 'e')" /></td>
              <td class="n col-captura"><input :id="`r-${i}-n`" v-model="r.noEntregado" inputmode="numeric" :aria-label="`No entregado de ${r.nombre}`" class="celda" @keydown.enter="bajar($event, i, 'n')" /></td>
              <td class="n fuerte" :class="saldoSiguiente(r) < 0 ? 'text-[#C03535]' : ''">{{ miles(saldoSiguiente(r)) }}</td>
              <td class="n col-captura">
                <input :id="`r-${i}-s`" v-model="r.saldoReportado" inputmode="numeric" :aria-label="`Saldo del servicio de ${r.nombre}`" class="celda" :class="diferenciaSaldo(r) ? 'difiere' : ''" @keydown.enter="bajar($event, i, 's')" />
                <span v-if="diferenciaSaldo(r)" class="dif">{{ diferenciaSaldo(r) > 0 ? '+' : '' }}{{ miles(diferenciaSaldo(r)) }}</span>
              </td>
              <td class="n col-captura">
                <input :id="`r-${i}-x`" v-model="r.entradasReportadas" inputmode="numeric" :aria-label="`Entradas del servicio de ${r.nombre}`" class="celda" :class="diferenciaEntradas(r) ? 'difiere' : ''" @keydown.enter="bajar($event, i, 'x')" />
                <span v-if="diferenciaEntradas(r)" class="dif">{{ diferenciaEntradas(r) > 0 ? '+' : '' }}{{ miles(diferenciaEntradas(r)) }}</span>
              </td>
            </tr>
            <tr v-if="!visibles.length"><td colspan="8" class="b-vacio">Este servicio no ha recibido traslados. Elija «Todos» para capturar cualquier insumo.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="barra-guardar">
        <span v-if="conDiferencia" class="b-estado cuarentena">{{ conDiferencia }} sin cuadrar</span>
        <span v-else class="text-sm font-semibold text-apagado">{{ visibles.length }} insumos</span>
        <button type="submit" class="b-btn primario" :disabled="guardando"><Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Guardando…' : 'Guardar reporte' }}</button>
      </div>

      <div v-if="form.reporte && !form.reporte.revisado && conDiferencia" class="b-panel mt-4">
        <header class="b-panel-cabeza"><h3 class="b-panel-titulo">Aceptar las cifras del servicio</h3></header>
        <div class="b-panel-cuerpo flex flex-wrap gap-2">
          <input v-model="observacionRevision" minlength="5" maxlength="500" placeholder="Motivo" aria-label="Motivo" class="b-campo min-w-[16rem] flex-1" />
          <button type="button" class="b-btn secundario" :disabled="observacionRevision.trim().length < 5" @click="aceptarDiferencias">Aceptar diferencias</button>
        </div>
      </div>
    </form>

    <p v-if="!estado && !error" class="b-vacio">Cargando reportes…</p>
  </section>
</template>

<style scoped>
.avance { display: flex; align-items: center; gap: 24px; padding: 14px 20px; border: 2px solid #E2E8F0; border-radius: 14px; }
.barra { flex: 1; display: flex; gap: 3px; height: 14px; }
.barra span { border-radius: 4px; }
.barra .ok { background: #22A06B; }
.barra .rev { background: #E8930C; }
.barra .pen { background: #CBD5E1; }
.lugares { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; max-height: max(320px, calc(100vh - 500px)); overflow-y: auto; border-top: 2px solid #E2E8F0; }
@media (max-width: 900px) { .lugares { grid-template-columns: 1fr; } }
.lugar { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 4px; border-bottom: 1px solid #EEF2F6; }
.lugar small { display: block; font-size: 12px; font-weight: 600; color: #64748B; }
.marca { flex-shrink: 0; width: 4px; align-self: stretch; margin: 6px 0; border-radius: 2px; }
.marca.listo { background: #22A06B; }
.marca.diferencia { background: #E8930C; }
.marca.pendiente { background: #CBD5E1; }
.captura { max-height: max(380px, calc(100vh - 420px)); }
.captura th { white-space: normal; line-height: 1.25; vertical-align: bottom; }
.captura th.n { max-width: 96px; }
.col-captura { background: #FAFBFF; }
th.col-captura { background: #E8EEFA !important; color: #172A5A !important; }
.celda { width: 84px; height: 36px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 8px; background: #fff; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.celda:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.celda.difiere { border-color: #E8930C; background: #FFF7E6; }
.dif { display: block; font-size: 11px; font-weight: 700; color: #B7710A; }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 26px; height: 26px; border-radius: 7px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 16px; height: 16px; }
.barra-guardar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding: 12px 0; background: #fff; border-top: 2px solid #E2E8F0; }
/* --- Relieve (estilo duo) --- */
.avance { border-bottom-width: 4px; border-radius: 18px; }
.celda { border-radius: 10px; }
</style>
