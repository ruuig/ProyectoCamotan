<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import farmacia from '../../services/farmacia';
import Icono from '../../components/comunes/Icono.vue';
import SelectorMes from '../../components/bodega/SelectorMes.vue';
import { miles, decimal } from '../../components/bodega/diseno/PiezasBodega';
import { nombrePeriodo, periodoPrevio, periodoActual } from '../../dominio/bodega';

/**
 * BRES de la farmacia (post-consulta) en pantalla, antes de imprimirlo.
 *
 * Los meses de antes del sistema se escriben aquí desde el BRES de papel, solo
 * con lo necesario: entradas, entregado, no entregado y reajustes (y el saldo
 * anterior en el primer mes). Lo demás lo calcula el sistema, y esos meses dan
 * el promedio de los que siguen. Al pie, qué va en cada columna.
 */
const route = useRoute();
const periodo = ref(route.query.periodo ?? periodoPrevio(periodoActual()));
const datos = ref(null);
const error = ref('');
const aviso = ref('');
const cargando = ref(true);
const buscar = ref('');
const soloPedir = ref(false);
const verGuia = ref(false);

async function cargar() {
  cargando.value = true;
  error.value = '';
  escribiendo.value = false;
  try {
    datos.value = await farmacia.bres(periodo.value);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
    nextTick(medir);
  }
}
watch(periodo, () => { aviso.value = ''; cargar(); });
onMounted(cargar);

const FUENTE = {
  excel: { texto: 'Del Excel de la bodega', tono: 'azul' },
  farmacia: { texto: 'Escrito por farmacia', tono: 'verde' },
  sistema: { texto: 'Del sistema', tono: 'azul' },
  vacio: { texto: 'Sin datos de este mes', tono: 'gris' },
};
const puedeEscribir = computed(() => ['vacio', 'farmacia'].includes(datos.value?.fuente) && periodo.value < periodoActual());

const meses = computed(() => datos.value?.configuracion?.nivelMaximoMeses ?? 2);
const promedioDe = computed(() => (datos.value?.historia?.meses ?? []).map((m) => nombrePeriodo(m).split(' ')[0]).join(', '));
// Las columnas del formulario: nombre corto y de dónde sale cada una.
const GUIA = computed(() => [
  { letra: 'B', clave: 'saldoInicial', corto: 'Saldo anterior', sale: 'Lo que quedó en el estante al cerrar el mes anterior (su columna H).' },
  { letra: 'C', clave: 'entradas', corto: 'Entradas', sale: 'Lo que llegó de bodega en el mes, por requisición.' },
  { letra: 'D', clave: 'entregado', corto: 'Entregado', sale: 'Lo entregado a pacientes con receta.' },
  { letra: 'E', clave: 'noEntregado', corto: 'No entregado', sale: 'Lo recetado que no había en el estante.' },
  { letra: 'F', clave: 'demandaReal', corto: 'Demanda', sale: 'D + E.' },
  { letra: 'G', clave: 'reajustes', corto: 'Reajustes', sale: 'Diferencias del conteo y devoluciones a bodega (+ o −).' },
  { letra: 'H', clave: 'saldoFinal', corto: 'Saldo', sale: 'B + C − D + G: lo que queda en el estante.' },
  { letra: 'I', clave: 'existenciaBodega', corto: 'Existencia', sale: 'Lo contado en el estante; en farmacia es igual a H.' },
  { letra: 'J', clave: 'pmdr', corto: 'Promedio', sale: `Demanda (F) de ${promedioDe.value || 'los meses anteriores'}, entre ${datos.value?.historia?.meses?.length || 3}.` },
  { letra: 'K', clave: 'med', corto: 'Meses', sale: 'H ÷ J: para cuántos meses alcanza.' },
  { letra: 'L', clave: 'cantidadMaxima', corto: 'Máximo', sale: `J × ${meses.value} meses.` },
  { letra: 'M', clave: 'cantidadSolicitar', corto: 'Pedir', sale: 'L − I: lo que falta para el máximo.' },
]);

const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const coincide = (nombre) => !buscar.value.trim() || sinTildes(nombre).includes(sinTildes(buscar.value.trim()));
const renglones = computed(() => (datos.value?.renglones ?? [])
  .filter((r) => coincide(r.nombre))
  .filter((r) => !soloPedir.value || r.cantidadSolicitar > 0));
const porPedir = computed(() => (datos.value?.renglones ?? []).filter((r) => r.cantidadSolicitar > 0).length);

function celda(r, c) {
  const v = r[c.clave];
  if (c.letra === 'K') return v === null || v === undefined ? '—' : decimal(v);
  if (c.letra === 'J' || c.letra === 'L') return v ? decimal(v) : '–';
  if (c.letra === 'M') return v > 0 ? miles(Math.ceil(v)) : '–';
  return v ? miles(v) : '–';
}

/* La tabla avisa con una sombra cuando hay más columnas a la derecha. */
const marco = ref(null);
const hayMas = ref(false);
function medir() {
  const m = marco.value;
  hayMas.value = Boolean(m && m.scrollWidth - m.clientWidth - m.scrollLeft > 4);
}
onMounted(() => window.addEventListener('resize', medir));
onBeforeUnmount(() => window.removeEventListener('resize', medir));

/* --- Escribir un mes de antes del sistema ------------------------------------ */
const escribiendo = ref(false);
const guardando = ref(false);
const hoja = ref(null);
const valores = reactive({});
const CAMPOS = ['saldoAnterior', 'entradas', 'entregado', 'noEntregado', 'reajustes'];
const numero = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return 0;
  const n = Number(t.replace(/[^0-9-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
async function escribir() {
  error.value = '';
  try {
    hoja.value = await farmacia.historial(periodo.value);
    for (const k of Object.keys(valores)) delete valores[k];
    for (const r of hoja.value.renglones) {
      valores[r.insumoId] = Object.fromEntries(CAMPOS.map((c) => [c, r[c] ? String(r[c]) : '']));
    }
    escribiendo.value = true;
  } catch (fallo) {
    error.value = fallo.message;
  }
}
const deHoja = computed(() => (hoja.value?.renglones ?? []).filter((r) => coincide(r.nombre)));
const saldo = (r) => {
  const v = valores[r.insumoId];
  const B = hoja.value.saldoDelMesAnterior ? r.saldoAnterior : numero(v.saldoAnterior);
  return B + numero(v.entradas) - numero(v.entregado) + numero(v.reajustes);
};
async function guardar() {
  guardando.value = true;
  error.value = '';
  try {
    await farmacia.guardarHistorial(periodo.value, {
      renglones: hoja.value.renglones.map((r) => ({
        insumoId: r.insumoId,
        ...Object.fromEntries(CAMPOS.map((c) => [c, numero(valores[r.insumoId][c])])),
      })),
    });
    aviso.value = `Guardado: ${nombrePeriodo(periodo.value)}.`;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div>
        <p class="b-antetitulo">Farmacia · BRES</p>
        <h1 class="b-titulo">Balance</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <SelectorMes v-model="periodo" />
        <RouterLink v-if="!escribiendo" :to="`/imprimir/bres/${periodo}?ubicacion=farmacia`" target="_blank" class="b-btn primario"><Icono nombre="imprimir" :tamano="20" /> Imprimir</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4">{{ aviso }}</p>

    <p v-if="cargando" class="b-vacio">Calculando el BRES de {{ nombrePeriodo(periodo) }}…</p>

    <!-- ====== Escribir el mes desde el BRES de papel ====== -->
    <template v-else-if="escribiendo && hoja">
      <div class="barra mt-4">
        <label class="buscar">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" autocomplete="off" placeholder="Buscar medicamento" aria-label="Buscar medicamento" />
        </label>
        <button type="button" class="b-btn secundario" @click="escribiendo = false">Cancelar</button>
        <button type="button" class="b-btn primario" :disabled="guardando" @click="guardar"><Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Guardando…' : 'Guardar el mes' }}</button>
      </div>
      <div class="b-tabla-marco alta mt-3">
        <table class="b-tabla escribir">
          <thead>
            <tr>
              <th class="fija">Medicamento</th>
              <th class="n"><span class="letra">B</span>Saldo anterior</th>
              <th class="n"><span class="letra">C</span>Entradas</th>
              <th class="n"><span class="letra">D</span>Entregado</th>
              <th class="n"><span class="letra">E</span>No entregado</th>
              <th class="n"><span class="letra">G</span>Reajustes</th>
              <th class="n"><span class="letra">H</span>Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in deHoja" :key="r.insumoId">
              <td class="fija"><span class="nombre">{{ r.nombre }}</span></td>
              <td class="n">
                <span v-if="hoja.saldoDelMesAnterior" class="fijo">{{ miles(r.saldoAnterior) }}</span>
                <input v-else v-model="valores[r.insumoId].saldoAnterior" inputmode="numeric" class="celda" placeholder="0" :aria-label="`Saldo anterior de ${r.nombre}`" />
              </td>
              <td v-for="c in ['entradas', 'entregado', 'noEntregado', 'reajustes']" :key="c" class="n">
                <input v-model="valores[r.insumoId][c]" :inputmode="c === 'reajustes' ? 'text' : 'numeric'" class="celda" placeholder="0" :aria-label="`${c} de ${r.nombre}`" />
              </td>
              <td class="n fuerte" :class="{ negativo: saldo(r) < 0 }">{{ miles(saldo(r)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ====== El BRES ====== -->
    <template v-else-if="datos">
      <div class="barra mt-4">
        <span class="fuente" :class="FUENTE[datos.fuente]?.tono">{{ FUENTE[datos.fuente]?.texto }}</span>
        <label class="buscar">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" autocomplete="off" placeholder="Buscar medicamento" aria-label="Buscar medicamento" />
        </label>
        <button type="button" class="filtro" :class="{ on: soloPedir }" :aria-pressed="soloPedir" @click="soloPedir = !soloPedir">
          Solo lo que hay que pedir <b>{{ porPedir }}</b>
        </button>
        <button v-if="puedeEscribir" type="button" data-accion class="b-btn primario" @click="escribir">
          <Icono nombre="lapiz" :tamano="18" /> {{ datos.fuente === 'farmacia' ? 'Corregir este mes' : 'Escribir este mes' }}
        </button>
      </div>

      <div class="envoltura mt-3" :class="{ 'hay-mas': hayMas }">
        <div ref="marco" class="b-tabla-marco alta" @scroll="medir">
          <table class="b-tabla">
            <thead>
              <tr>
                <th class="fija">Medicamento</th>
                <th v-for="g in GUIA" :key="g.letra" class="n" :class="{ 'col-pedir': g.letra === 'M' }"><span class="letra">{{ g.letra }}</span>{{ g.corto }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in renglones" :key="r.insumoId">
                <td class="fija"><span class="nombre">{{ r.nombre }}</span></td>
                <td v-for="g in GUIA" :key="g.letra" class="n" :class="{ cero: !r[g.clave], fuerte: g.letra === 'H', 'col-pedir': g.letra === 'M' }">{{ celda(r, g) }}</td>
              </tr>
              <tr v-if="!renglones.length"><td :colspan="GUIA.length + 1" class="b-vacio">{{ datos.fuente === 'vacio' ? 'Este mes no tiene datos. Puede escribirlo desde el BRES de papel.' : 'Ningún medicamento coincide.' }}</td></tr>
            </tbody>
          </table>
        </div>
        <span v-if="hayMas" class="mas" aria-hidden="true"><Icono nombre="irA" :tamano="18" :grosor="2.6" /></span>
      </div>
    </template>

    <!-- Qué va en cada columna: al final y cerrado -->
    <section v-if="!cargando" class="guia mt-4">
      <button type="button" class="guia-cabeza" :aria-expanded="verGuia" @click="verGuia = !verGuia">
        <span><Icono nombre="informacion" :tamano="18" :grosor="2.2" /> Qué va en cada columna</span>
        <Icono :nombre="verGuia ? 'cerrar' : 'irA'" :tamano="16" :grosor="2.4" />
      </button>
      <dl v-if="verGuia" class="guia-lista">
        <div v-for="g in GUIA" :key="g.letra">
          <dt><span class="letra">{{ g.letra }}</span>{{ g.corto }}</dt>
          <dd>{{ g.sale }}</dd>
        </div>
      </dl>
    </section>
  </section>
</template>

<style scoped>
.barra { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.buscar { display: flex; flex: 1; min-width: 12rem; align-items: center; gap: 8px; height: 46px; padding: 0 14px; border: 2px solid #E5E9F0; border-radius: 14px; background: #fff; color: #64748B; }
.buscar:focus-within { border-color: #4A9BD6; }
.buscar input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: 16px; font-weight: 700; color: #14244A; }
.filtro { display: inline-flex; align-items: center; gap: 8px; height: 46px; padding: 0 14px; border: 2px solid #F3C677; border-bottom-width: 4px; border-radius: 14px; background: #FFF8EB; font-size: 14.5px; font-weight: 800; color: #8A4B00; }
.filtro b { min-width: 24px; padding: 0 7px; border-radius: 9px; background: #E8930C; color: #fff; text-align: center; }
.filtro.on { background: #E8930C; border-color: #B4610A; color: #fff; }
.filtro.on b { background: #fff; color: #B4610A; }
.fuente { padding: 6px 12px; border-radius: 10px; font-size: 14px; font-weight: 800; }
.fuente.azul { background: #EAF3FB; color: #174E80; }
.fuente.verde { background: #E2F5EA; color: #145C3C; }
.fuente.gris { background: #F1F5F9; color: #475569; }

/* La tabla: columnas angostas, nombres cortos sin partir palabras. */
.envoltura { position: relative; }
.alta { max-height: max(320px, calc(100vh - 280px)); }
.b-tabla th { vertical-align: bottom; }
.alta :deep(th), .alta :deep(td) { padding-left: 7px; padding-right: 7px; }
.alta :deep(th.n) { min-width: 64px; font-size: 11.5px; line-height: 1.2; letter-spacing: 0; text-transform: none; white-space: normal; overflow-wrap: normal; word-break: keep-all; hyphens: none; }
.b-tabla th .letra { display: grid; width: 22px; height: 22px; margin: 0 0 4px auto; font-size: 12px; }
.fija { position: sticky; left: 0; z-index: 2; background: #fff; min-width: 200px; max-width: 240px; border-right: 2px solid #E2E8F0; }
th.fija { z-index: 3; background: #F1F5F9; }
.nombre { font-weight: 700; color: #14244A; white-space: normal; overflow-wrap: anywhere; }
.col-pedir { background: #FFFAF3; font-weight: 900; color: #7C2D12; }
th.col-pedir { background: #FDEFE0 !important; color: #9A3412 !important; }
.hay-mas::after { content: ''; position: absolute; top: 0; right: 0; bottom: 0; width: 48px; border-radius: 0 16px 16px 0; background: linear-gradient(to right, transparent, rgba(15, 23, 42, .14)); pointer-events: none; }
.mas { position: absolute; top: 50%; right: 8px; z-index: 4; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: #172A5A; color: #fff; transform: translateY(-50%); pointer-events: none; box-shadow: 0 4px 10px rgba(15, 23, 42, .3); }

/* Escribir el mes */
.escribir .celda { width: 92px; height: 38px; padding: 0 8px; border: 2px solid #CBD5E1; border-radius: 10px; text-align: right; font-size: 15px; font-weight: 800; color: #14244A; }
.escribir .celda:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.escribir .fijo { font-weight: 800; color: #475569; }
.negativo { color: #A52A2A !important; }

/* Qué va en cada columna */
.guia { border: 2px solid #E2E8F0; border-radius: 16px; background: #fff; }
.guia-cabeza { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; font-size: 14.5px; font-weight: 800; color: #334155; }
.guia-cabeza span { display: inline-flex; align-items: center; gap: 8px; }
.guia-lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 16px; padding: 0 14px 14px; }
.guia-lista dt { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 900; color: #14244A; }
.guia-lista dd { margin: 2px 0 0 32px; font-size: 13px; font-weight: 600; color: #475569; line-height: 1.35; }
.letra { display: inline-grid; place-items: center; min-width: 24px; height: 24px; border-radius: 7px; background: #172A5A; color: #fff; font-size: 13px; font-weight: 900; }
</style>
