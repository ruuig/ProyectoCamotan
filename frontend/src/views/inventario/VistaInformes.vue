<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import PasosCierre from '../../components/bodega/PasosCierre.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import { estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';
import { cierre } from '../../dominio/bodega';

/**
 * Consumo de puestos: el informe mensual de cada puesto y centro comunitario.
 * Las entradas vienen de los traslados de la bodega; se captura lo entregado,
 * lo no entregado y el saldo que manda el servicio. Enter baja de fila.
 *
 * Los lugares van agrupados por territorio. De cada territorio se baja su
 * Excel (el pedazo del balance de sus lugares) para mandárselo al encargado; el
 * Excel llenado se sube y queda cargado el informe de cada lugar.
 */
const estado = ref(null);
const elegido = ref(null);
const form = ref(null);
const alcance = ref('maneja');
const error = ref('');
const aviso = ref('');
const guardando = ref(false);
const observacionRevision = ref('');

const territorios = ref([]);
async function cargarEstado() {
  try {
    const [e, t] = await Promise.all([bodega.estadoInformes(cierre.periodo), bodega.territorios().catch(() => ({ territorios: [] }))]);
    estado.value = e;
    territorios.value = t.territorios;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

/* --- Excel de cada territorio --------------------------------------------------- */
const bajando = ref(null);
async function bajarExcel(t) {
  error.value = '';
  bajando.value = t.id;
  try {
    await bodega.bajarExcelConsumo(cierre.periodo, t);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    bajando.value = null;
  }
}
// El Excel se sube completo por territorio, con todos sus lugares.
const subiendo = ref(null);
const resultado = ref(null);
async function subir(evento, t) {
  const archivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!archivo) return;
  error.value = '';
  aviso.value = '';
  resultado.value = null;
  subiendo.value = t.id;
  try {
    resultado.value = await bodega.subirExcelConsumo(cierre.periodo, archivo, t.id);
    await cargarEstado();
  } catch (fallo) {
    error.value = `Territorio ${t.numero}: ${fallo.message}`;
  } finally {
    subiendo.value = null;
  }
}

async function abrir(s) {
  error.value = '';
  aviso.value = '';
  elegido.value = s;
  try {
    form.value = await bodega.informe(s.ubicacionId, cierre.periodo);
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
  diferencia: servicios.value.filter((s) => s.informado && s.diferencias && !s.revisado),
  pendiente: servicios.value.filter((s) => !s.informado),
  listo: servicios.value.filter((s) => s.informado && !(s.diferencias && !s.revisado)),
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
// Los lugares de cada territorio; los que no tienen, al final.
const porTerritorio = computed(() => {
  const grupos = territorios.value.map((t) => {
    const ids = new Set(t.ubicaciones.map((u) => u.id));
    const suyos = lugares.value.filter((s) => ids.has(s.ubicacionId));
    const listos = servicios.value.filter((s) => ids.has(s.ubicacionId) && s.informado).length;
    return { ...t, lugares: suyos, listos, total: ids.size };
  }).filter((t) => t.total > 0 && t.lugares.length);
  const conTerritorio = new Set(territorios.value.flatMap((t) => t.ubicaciones.map((u) => u.id)));
  const sueltos = lugares.value.filter((s) => !conTerritorio.has(s.ubicacionId));
  if (sueltos.length) grupos.push({ id: null, numero: null, encargado: 'Sin territorio', lugares: sueltos, listos: null, total: sueltos.length });
  return grupos;
});

const visibles = computed(() => (form.value?.renglones ?? []).filter((r) => alcance.value === 'todos' || r.maneja || r.entregado || r.noEntregado));

const vacio = (v) => v === null || v === undefined || v === '';
const numero = (v) => (vacio(v) ? 0 : Number(String(v).replace(/[^\d]/g, '')) || 0);
const saldoSiguiente = (r) => r.saldoAnterior + r.entradas - numero(r.entregado);
const diferenciaSaldo = (r) => (vacio(r.saldoInformado) ? null : numero(r.saldoInformado) - saldoSiguiente(r));
const diferenciaEntradas = (r) => (vacio(r.entradasInformadas) ? null : numero(r.entradasInformadas) - r.entradas);
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
    const r = await bodega.guardarInforme(elegido.value.ubicacionId, cierre.periodo, {
      renglones: form.value.renglones
        .filter((x) => x.maneja || numero(x.entregado) || numero(x.noEntregado) || !vacio(x.saldoInformado))
        .map((x) => ({
          insumoId: x.insumoId,
          entregado: numero(x.entregado),
          noEntregado: numero(x.noEntregado),
          saldoInformado: vacio(x.saldoInformado) ? null : numero(x.saldoInformado),
          entradasInformadas: vacio(x.entradasInformadas) ? null : numero(x.entradasInformadas),
        })),
    });
    aviso.value = r.diferencias ? `Informe guardado. ${r.diferencias} insumo(s) no cuadran.` : 'Informe guardado. Todo cuadra.';
    await Promise.all([cargarEstado(), abrir(elegido.value)]);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

async function aceptarDiferencias() {
  try {
    await bodega.revisarInforme(elegido.value.ubicacionId, cierre.periodo, observacionRevision.value);
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
    <PasosCierre />

    <!-- Lo que se cargó del Excel -->
    <section v-if="resultado" class="cargado mt-4" aria-live="polite">
      <header>
        <b>Cargado {{ resultado.lugares.length }} {{ resultado.lugares.length === 1 ? 'lugar' : 'lugares' }}</b>
        <button type="button" class="cerrar-cargado" aria-label="Cerrar" @click="resultado = null"><Icono nombre="cerrar" :tamano="16" :grosor="2.4" /></button>
      </header>
      <ul>
        <li v-for="l in resultado.lugares" :key="l.ubicacionId">
          <span class="min-w-0 flex-1">{{ l.nombre }}</span>
          <span>{{ l.renglones }} productos</span>
          <span v-if="l.diferencias" class="text-[#B7710A]">{{ l.diferencias }} sin cuadrar</span>
        </li>
      </ul>
      <p v-if="resultado.lugaresNoReconocidos.length" class="no-rec">Lugares no reconocidos: {{ resultado.lugaresNoReconocidos.join(', ') }}</p>
      <p v-if="resultado.noReconocidos.length" class="no-rec">Productos no reconocidos ({{ resultado.noReconocidos.length }}): {{ resultado.noReconocidos.slice(0, 8).join(', ') }}<template v-if="resultado.noReconocidos.length > 8">…</template></p>
    </section>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4" aria-live="polite">{{ aviso }}</p>

    <!-- Tablero de los servicios -->
    <template v-if="estado && !form">
      <div class="avance mt-4">
        <div class="flex items-baseline gap-2 whitespace-nowrap">
          <span class="text-[34px] font-bold leading-none tabular-nums text-tinta">{{ grupos.listo.length }}</span>
          <span class="text-xl font-bold text-apagado">/ {{ servicios.length }}</span>
          <span class="b-antetitulo ml-1">informes listos</span>
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

      <div class="territorios mt-3">
        <section v-for="t in porTerritorio" :key="t.id ?? 'sin'" class="territorio">
          <header class="territorio-cabeza">
            <span class="min-w-0 flex-1">
              <b><template v-if="t.numero">Territorio {{ t.numero }} · </template>{{ t.encargado }}</b>
              <small v-if="t.listos !== null">{{ t.listos }} de {{ t.total }}</small>
            </span>
            <button v-if="t.id" type="button" class="b-btn secundario chico" :disabled="bajando === t.id" @click="bajarExcel(t)">
              <Icono nombre="descargar" :tamano="16" /> {{ bajando === t.id ? 'Preparando…' : 'Bajar Excel' }}
            </button>
            <label v-if="t.id" class="b-btn primario chico subir" :class="{ ocupado: subiendo === t.id }">
              <Icono nombre="recibir" :tamano="16" /> {{ subiendo === t.id ? 'Cargando…' : 'Subir Excel' }}
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="sr-only" :disabled="Boolean(subiendo)" @change="subir($event, t)" />
            </label>
          </header>
          <ul class="lugares">
            <li v-for="s in t.lugares" :key="s.ubicacionId" class="lugar">
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold text-tinta">{{ s.nombre }}</span>
                <small v-if="s.estado === 'diferencia'" class="text-[#B7710A]">{{ s.diferencias }} {{ s.diferencias === 1 ? 'insumo' : 'insumos' }} sin cuadrar</small>
                <small v-else-if="s.estado === 'pendiente'">Sin informe</small>
                <small v-else>{{ new Date(s.capturadoEn).toLocaleDateString('es-GT') }} · {{ s.capturadoPor }}</small>
              </span>
              <button type="button" class="b-btn chico" :class="s.estado === 'listo' ? 'secundario' : 'primario'" @click="abrir(s)">{{ ACCION[s.estado] }}</button>
            </li>
          </ul>
        </section>
        <p v-if="!porTerritorio.length" class="b-vacio">Ninguno.</p>
      </div>
    </template>

    <!-- Captura de un servicio -->
    <form v-if="form" class="mt-4" @submit.prevent="guardar">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <button type="button" class="b-btn secundario chico" @click="cerrar"><Icono nombre="volver" :tamano="16" :grosor="2.2" /> Servicios</button>
          <div>
            <h2 class="text-[22px] font-semibold leading-tight text-tinta">{{ form.ubicacion.nombre }}</h2>
            <p class="text-sm font-semibold text-apagado">
              <template v-if="form.informe">Capturado por {{ form.informe.capturadoPor }} · {{ new Date(form.informe.capturadoEn).toLocaleDateString('es-GT') }}</template>
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
                <input :id="`r-${i}-s`" v-model="r.saldoInformado" inputmode="numeric" :aria-label="`Saldo del servicio de ${r.nombre}`" class="celda" :class="diferenciaSaldo(r) ? 'difiere' : ''" @keydown.enter="bajar($event, i, 's')" />
                <span v-if="diferenciaSaldo(r)" class="dif">{{ diferenciaSaldo(r) > 0 ? '+' : '' }}{{ miles(diferenciaSaldo(r)) }}</span>
              </td>
              <td class="n col-captura">
                <input :id="`r-${i}-x`" v-model="r.entradasInformadas" inputmode="numeric" :aria-label="`Entradas del servicio de ${r.nombre}`" class="celda" :class="diferenciaEntradas(r) ? 'difiere' : ''" @keydown.enter="bajar($event, i, 'x')" />
                <span v-if="diferenciaEntradas(r)" class="dif">{{ diferenciaEntradas(r) > 0 ? '+' : '' }}{{ miles(diferenciaEntradas(r)) }}</span>
              </td>
            </tr>
            <tr v-if="!visibles.length"><td colspan="8" class="b-vacio">Sin traslados este mes.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="barra-guardar">
        <span v-if="conDiferencia" class="b-estado cuarentena">{{ conDiferencia }} sin cuadrar</span>
        <span v-else class="text-sm font-semibold text-apagado">{{ visibles.length }} insumos</span>
        <button type="submit" class="b-btn primario" :disabled="guardando"><Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Guardando…' : 'Guardar informe' }}</button>
      </div>

      <div v-if="form.informe && !form.informe.revisado && conDiferencia" class="b-panel mt-4">
        <header class="b-panel-cabeza"><h3 class="b-panel-titulo">Aceptar las cifras del servicio</h3></header>
        <div class="b-panel-cuerpo flex flex-wrap gap-2">
          <input v-model="observacionRevision" minlength="5" maxlength="500" placeholder="Motivo" aria-label="Motivo" class="b-campo min-w-[16rem] flex-1" />
          <button type="button" class="b-btn secundario" :disabled="observacionRevision.trim().length < 5" @click="aceptarDiferencias">Aceptar diferencias</button>
        </div>
      </div>
    </form>

    <p v-if="!estado && !error" class="b-vacio">Cargando informes…</p>
  </section>
</template>

<style scoped>
.avance { display: flex; align-items: center; gap: 24px; padding: 14px 20px; border: 2px solid #E2E8F0; border-radius: 14px; }
.barra { flex: 1; display: flex; gap: 3px; height: 14px; }
.barra span { border-radius: 4px; }
.barra .ok { background: #22A06B; }
.barra .rev { background: #E8930C; }
.barra .pen { background: #CBD5E1; }
.territorios { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
@media (max-width: 1000px) { .territorios { grid-template-columns: 1fr; } }
.territorio { border: 2px solid #E5E9F0; border-radius: 16px; background: #fff; overflow: hidden; }
.territorio-cabeza { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #F1F5F9; }
.territorio-cabeza b { display: block; font-size: 15px; font-weight: 900; color: #14244A; }
.territorio-cabeza small { font-size: 12.5px; font-weight: 700; color: #64748B; }
.lugares { display: grid; padding: 0 12px; }
.lugares .lugar:last-child { border-bottom: 0; }
.subir { cursor: pointer; }
.subir.ocupado { opacity: .6; pointer-events: none; }
.cargado { padding: 12px 16px; border: 2px solid #9BD3B5; border-radius: 16px; background: #F6FCF8; }
.cargado header { display: flex; align-items: center; justify-content: space-between; }
.cargado header b { font-size: 15px; font-weight: 900; color: #145C3C; }
.cargado ul { display: grid; gap: 2px; margin-top: 6px; }
.cargado li { display: flex; gap: 12px; font-size: 14px; font-weight: 700; color: #1E293B; }
.cerrar-cargado { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; color: #64748B; }
.no-rec { margin-top: 6px; font-size: 13px; font-weight: 700; color: #8A4B00; }
.lugar { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 4px; border-bottom: 1px solid #EEF2F6; }
.lugar small { display: block; font-size: 12px; font-weight: 600; color: #64748B; }
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
