<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import servicio from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import EstanteCategoria from '../../components/bodega/diseno/EstanteCategoria.vue';
import { estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/**
 * Trazabilidad por lote: de dónde vino, cuánto entró y a dónde fue a parar
 * cada unidad (pacientes, servicios, consumo interno, bajas), y cuánto queda.
 * Es lo que se necesita contestar en minutos cuando llega una alerta.
 */
const route = useRoute();
const router = useRouter();

const texto = ref('');
const resultados = ref([]);
const buscando = ref(false);
const datos = ref(null);
const error = ref('');
const detalle = ref('servicios');

let espera = null;
watch(texto, (t) => {
  clearTimeout(espera);
  if (t.trim().length < 2) {
    resultados.value = [];
    return;
  }
  espera = setTimeout(async () => {
    buscando.value = true;
    try {
      resultados.value = (await bodega.buscarLotes(t.trim())).lotes;
    } catch (fallo) {
      error.value = fallo.message;
    } finally {
      buscando.value = false;
    }
  }, 250);
});

async function abrir(id) {
  error.value = '';
  try {
    datos.value = await servicio.trazabilidad(id);
    detalle.value = datos.value.servicios.length ? 'servicios' : datos.value.pacientes.length ? 'pacientes' : 'movimientos';
  } catch (fallo) {
    error.value = fallo.message;
    datos.value = null;
  }
}

function elegir(l) {
  texto.value = '';
  resultados.value = [];
  router.replace({ query: { lote: l.id } });
}

watch(() => route.query.lote, (id) => { if (id) { modo.value = 'lote'; abrir(id); } else datos.value = null; });
onMounted(() => {
  if (route.query.lote) abrir(route.query.lote);
  else if (route.query.paciente) { modo.value = 'paciente'; abrirPaciente(route.query.paciente); }
});

// --- Por paciente: qué lotes recibió una persona --------------------------------
const modo = ref(route.query.paciente ? 'paciente' : 'lote');
const textoPaciente = ref('');
const pacientes = ref([]);
const delPaciente = ref(null);
let esperaPaciente = null;
watch(textoPaciente, (t) => {
  clearTimeout(esperaPaciente);
  if (t.trim().length < 2) { pacientes.value = []; return; }
  esperaPaciente = setTimeout(async () => {
    try {
      pacientes.value = (await servicio.buscarPacientesConEntregas(t.trim())).pacientes;
    } catch (fallo) {
      error.value = fallo.message;
    }
  }, 250);
});
async function abrirPaciente(id) {
  error.value = '';
  textoPaciente.value = '';
  pacientes.value = [];
  try {
    delPaciente.value = await servicio.insumosDePaciente(id);
    router.replace({ query: { paciente: id } });
  } catch (fallo) {
    error.value = fallo.message;
  }
}
function verLote(loteId) {
  modo.value = 'lote';
  router.replace({ query: { lote: loteId } });
}
// Entregas del paciente agrupadas por consulta.
const porConsulta = computed(() => {
  const mapa = new Map();
  for (const e of delPaciente.value?.entregas ?? []) {
    const clave = e.atencionId ?? `m${e.movimientoId}`;
    const g = mapa.get(clave) ?? { fecha: e.consultaEn ?? e.fecha, medico: e.medico, diagnostico: e.diagnostico, cie: e.cie, entregas: [] };
    g.entregas.push(e);
    mapa.set(clave, g);
  }
  return [...mapa.values()];
});

const sinLote = computed(() => datos.value?.lote.numeroLote === 'SIN-LOTE');

/** Cuánto salió por cada camino, a partir de los movimientos del lote. */
const recorrido = computed(() => {
  if (!datos.value) return null;
  const suma = (tipo) => datos.value.movimientos.filter((m) => m.tipo === tipo).reduce((s, m) => s + Math.abs(m.cantidad), 0);
  const reajustes = datos.value.movimientos.filter((m) => m.tipo === 'reajuste').reduce((s, m) => s + m.cantidad, 0);
  const entro = suma('ingreso');
  const destinos = [
    { clave: 'pacientes', titulo: 'Pacientes', sub: 'Desde farmacia', cantidad: datos.value.cuenta?.aPacientes ?? suma('entrega'), cuenta: new Set(datos.value.pacientes.map((p) => p.pacienteId)).size, unidad: 'pacientes', icono: 'pacientes', tono: 'azul' },
    { clave: 'servicios', titulo: 'Servicios', sub: 'Traslados', cantidad: suma('traslado'), cuenta: new Set(datos.value.servicios.map((s) => s.ubicacionId)).size, unidad: 'servicios', icono: 'trasladar', tono: 'verde' },
    { clave: 'interno', titulo: 'Consumo interno', sub: 'En el centro', cantidad: suma('consumo_interno'), icono: 'dispensacion', tono: 'gris' },
    { clave: 'bajas', titulo: 'Bajas', sub: 'Vencido o dañado', cantidad: suma('baja'), icono: 'quitar', tono: 'rojo' },
  ].filter((d) => d.cantidad > 0);
  return {
    entro,
    destinos,
    reajustes,
    queda: datos.value.lote.cantidadActual,
    enBodega: datos.value.lote.enBodega ?? datos.value.lote.cantidadActual,
    enFarmacia: datos.value.lote.enFarmacia ?? 0,
  };
});

const pct = (n) => (recorrido.value?.entro ? Math.round((n / recorrido.value.entro) * 100) : 0);

/** Traslados agrupados por servicio. */
const porServicio = computed(() => {
  const mapa = new Map();
  for (const s of datos.value?.servicios ?? []) {
    const g = mapa.get(s.ubicacionId) ?? { ubicacion: s.ubicacion, cantidad: 0, traslados: [] };
    g.cantidad += s.cantidad;
    g.traslados.push(s);
    mapa.set(s.ubicacionId, g);
  }
  return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad);
});

const fechaHora = (v) => new Date(v).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex flex-wrap items-center gap-4">
        <h1 class="b-titulo">Trazabilidad</h1>
        <div class="b-segmentado" role="radiogroup" aria-label="Buscar por">
          <button type="button" role="radio" :aria-checked="modo === 'lote'" :class="{ on: modo === 'lote' }" @click="modo = 'lote'">Por lote</button>
          <button type="button" role="radio" :aria-checked="modo === 'paciente'" :class="{ on: modo === 'paciente' }" @click="modo = 'paciente'">Por paciente</button>
        </div>
      </div>
      <div v-if="modo === 'paciente'" class="relative w-full sm:w-[420px]">
        <label class="b-buscar block">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="textoPaciente" type="search" class="b-campo" placeholder="Nombre, expediente o CUI" aria-label="Buscar paciente" autocomplete="off" />
        </label>
        <ul v-if="pacientes.length" class="resultados" role="listbox">
          <li v-for="p in pacientes" :key="p.id">
            <button type="button" class="resultado" @click="abrirPaciente(p.id)">
              <span class="cat-mini paciente-mini"><Icono nombre="pacientes" :tamano="16" /></span>
              <span class="min-w-0 flex-1">
                <span class="block font-semibold text-tinta">{{ p.nombreCompleto }}</span>
                <span class="block truncate text-[13px] text-apagado">Exp. {{ p.expedientePapel || p.expediente }}<template v-if="p.comunidad"> · {{ p.comunidad }}</template></span>
              </span>
            </button>
          </li>
        </ul>
        <p v-else-if="textoPaciente.trim().length >= 2" class="resultados vacia">Nadie con ese nombre ha recibido medicamentos.</p>
      </div>
      <div v-else class="relative w-full sm:w-[420px]">
        <label class="b-buscar block">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="texto" type="search" class="b-campo" placeholder="Número de lote o insumo" aria-label="Buscar lote" autocomplete="off" />
        </label>
        <ul v-if="resultados.length" class="resultados" role="listbox">
          <li v-for="l in resultados" :key="l.id">
            <button type="button" class="resultado" :style="estiloCategoria(l.insumo.categoria)" @click="elegir(l)">
              <span class="cat-mini"><Pictograma :categoria="l.insumo.categoria" :grosor="2" /></span>
              <span class="min-w-0 flex-1">
                <span class="block font-mono font-semibold text-tinta">{{ l.numeroLote === 'SIN-LOTE' ? 'Sin lote' : l.numeroLote }}</span>
                <span class="block truncate text-[13px] text-apagado">{{ l.insumo.nombreGenerico }}</span>
              </span>
              <span class="text-right text-[13px] font-semibold tabular-nums text-apagado">
                <span class="block">{{ miles(l.cantidadActual) }} de {{ miles(l.cantidadInicial) }}</span>
                <span v-if="l.fechaVence && l.numeroLote !== 'SIN-LOTE'" class="block text-[12px]">vence {{ fecha(l.fechaVence) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p v-else-if="texto.trim().length >= 2 && !buscando" class="resultados vacia">Ningún lote coincide.</p>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <!-- ===== Por paciente ===== -->
    <template v-if="modo === 'paciente'">
      <div v-if="!delPaciente" class="b-panel inicio mt-5">
        <Icono nombre="pacientes" :tamano="48" :grosor="1.4" class="text-[#94A3B8]" />
        <p class="text-lg font-bold text-tinta">Busque a la persona para ver qué lotes recibió</p>
      </div>
      <template v-else>
        <div class="ficha-paciente mt-5">
          <span class="ic-paciente"><Icono nombre="pacientes" :tamano="26" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-[22px] font-black leading-tight text-tinta">{{ delPaciente.paciente.nombreCompleto }}</p>
            <p class="text-sm font-semibold text-apagado">Exp. {{ delPaciente.paciente.expediente }}<template v-if="delPaciente.paciente.comunidad"> · {{ delPaciente.paciente.comunidad }}</template></p>
          </div>
          <div class="cifra-paciente"><b>{{ delPaciente.entregas.length }}</b><span>entregas</span></div>
          <div class="cifra-paciente"><b>{{ new Set(delPaciente.entregas.map((e) => e.lote.id)).size }}</b><span>lotes</span></div>
          <div v-if="delPaciente.conRetiroActivo" class="cifra-paciente rojo"><b>{{ delPaciente.conRetiroActivo }}</b><span>en retiro</span></div>
        </div>

        <p v-if="!delPaciente.entregas.length" class="b-vacio">No ha recibido medicamentos.</p>
        <section v-for="(g, i) in porConsulta" :key="i" class="b-panel consulta-traza mt-3">
          <header class="b-panel-cabeza">
            <div>
              <h2 class="b-panel-titulo">{{ fecha(g.fecha) }}<template v-if="g.diagnostico"> · {{ g.diagnostico }}</template></h2>
              <p class="text-sm text-apagado"><template v-if="g.cie">{{ g.cie }} · </template>{{ g.medico ?? 'Sin médico' }}</p>
            </div>
          </header>
          <ul>
            <li v-for="e in g.entregas" :key="e.movimientoId" class="entrega-traza" :class="{ anulada: e.anulada }">
              <div class="min-w-0 flex-1">
                <b class="block text-tinta">{{ e.insumo.nombreGenerico }}</b>
                <small class="block text-apagado">{{ fechaHora(e.fecha) }} · entregó {{ e.entregadoPor }}<template v-if="e.indicaciones"> · {{ e.indicaciones }}</template></small>
                <small v-if="e.retiro" class="block font-bold text-[#A52A2A]">Lote bajo retiro sanitario · {{ e.retiro.referencia }}</small>
              </div>
              <span class="cant-traza">{{ miles(e.cantidad) }}</span>
              <button type="button" class="lote-traza" :class="e.lote.semaforo" @click="verLote(e.lote.id)">
                <span class="font-mono font-bold">{{ e.lote.numeroLote }}</span>
                <small>vence {{ fecha(e.lote.fechaVence) }}</small>
              </button>
            </li>
          </ul>
        </section>
      </template>
    </template>

    <template v-else>
    <div v-if="!datos" class="b-panel inicio mt-5">
      <Icono nombre="trazabilidad" :tamano="48" :grosor="1.4" class="text-[#94A3B8]" />
      <p class="text-lg font-bold text-tinta">Busque un lote por su número o por el nombre del insumo</p>
    </div>

    <template v-else>
      <div v-if="datos.retiroActivo" class="b-aviso error mt-4 items-center justify-between">
        <span>Bajo retiro sanitario · {{ datos.retiroActivo.referencia }}</span>
        <RouterLink :to="`/inventario/retiros/${datos.retiroActivo.id}`" class="b-btn peligro chico">Ver retiro</RouterLink>
      </div>

      <!-- El lote -->
      <div class="lote mt-5" :style="estiloCategoria(datos.insumo.categoria)">
        <div class="talon">
          <span class="b-antetitulo">Lote</span>
          <span class="numero">{{ sinLote ? 'Sin lote' : datos.lote.numeroLote }}</span>
          <SelloVence :fecha="datos.lote.fechaVence" :semaforo="sinLote ? 'sin_fecha' : datos.lote.semaforo" />
        </div>
        <div class="min-w-0 flex-1 p-5">
          <EstanteCategoria :categoria="datos.insumo.categoria" />
          <h2 class="mt-2 text-[22px] font-semibold leading-tight text-tinta">{{ datos.insumo.nombreGenerico }}</h2>
          <p class="mt-1 text-sm font-semibold text-apagado">
            {{ datos.lote.origenEtiqueta }}<template v-if="datos.lote.fabricante"> · {{ datos.lote.fabricante }}</template>
            · recibido {{ new Date(datos.lote.recibidoEn).toLocaleDateString('es-GT') }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="b-estado" :class="datos.lote.estado">{{ datos.lote.estadoEtiqueta }}</span>
            <span class="cuadre" :class="datos.cuadra ? 'ok' : 'mal'">
              <Icono :nombre="datos.cuadra ? 'correcto' : 'alerta'" :tamano="16" />
              {{ datos.cuadra ? 'Cada unidad está explicada' : `Los movimientos suman ${miles(datos.saldoCalculado)}` }}
            </span>
          </div>
        </div>
        <RouterLink :to="`/inventario/lotes/${datos.lote.id}`" class="b-btn secundario chico m-5 self-start">Ficha del lote</RouterLink>
      </div>

      <!-- Recorrido -->
      <div class="recorrido mt-5">
        <div class="nodo origen">
          <span class="b-subtitulo">Entró</span>
          <b>{{ miles(recorrido.entro) }}</b>
          <small>{{ datos.lote.origenEtiqueta }}</small>
          <small v-if="datos.lote.recepcion.diferencia" class="text-[#B7710A]">{{ datos.lote.recepcion.diferencia > 0 ? '+' : '' }}{{ miles(datos.lote.recepcion.diferencia) }} contra el documento</small>
        </div>

        <div class="flecha" aria-hidden="true"><span /></div>

        <div class="destinos">
          <button
            v-for="d in recorrido.destinos"
            :key="d.clave"
            type="button"
            class="destino"
            :class="[d.tono, detalle === d.clave ? 'on' : '']"
            @click="detalle = d.clave === 'interno' || d.clave === 'bajas' ? 'movimientos' : d.clave"
          >
            <span class="ic"><Icono :nombre="d.icono" :tamano="20" :grosor="2" /></span>
            <span class="min-w-0 flex-1 text-left">
              <b class="block text-tinta">{{ d.titulo }}</b>
              <small>{{ d.cuenta ? `${d.cuenta} ${d.unidad}` : d.sub }}</small>
            </span>
            <span class="text-right">
              <b class="block tabular-nums text-tinta">{{ miles(d.cantidad) }}</b>
              <small>{{ pct(d.cantidad) }} %</small>
            </span>
            <span class="barra"><span :style="{ width: `${pct(d.cantidad)}%` }" /></span>
          </button>
          <div v-if="recorrido.reajustes" class="destino gris">
            <span class="ic"><Icono nombre="lapiz" :tamano="20" :grosor="2" /></span>
            <span class="min-w-0 flex-1 text-left"><b class="block text-tinta">Reajustes</b><small>Correcciones de saldo</small></span>
            <b class="tabular-nums text-tinta">{{ recorrido.reajustes > 0 ? '+' : '' }}{{ miles(recorrido.reajustes) }}</b>
          </div>
          <div class="destino queda">
            <span class="ic"><Icono nombre="inventario" :tamano="20" :grosor="2" /></span>
            <span class="min-w-0 flex-1 text-left"><b class="block text-tinta">Queda en bodega</b><small>{{ datos.lote.estadoEtiqueta }}</small></span>
            <span class="text-right">
              <b class="block tabular-nums text-tinta">{{ miles(recorrido.enBodega) }}</b>
              <small>{{ pct(recorrido.enBodega) }} %</small>
            </span>
            <span class="barra"><span :style="{ width: `${pct(recorrido.enBodega)}%` }" /></span>
          </div>
          <button v-if="recorrido.enFarmacia || datos.pasosFarmacia?.length" type="button" class="destino queda" :class="detalle === 'farmacia' ? 'on' : ''" @click="detalle = 'farmacia'">
            <span class="ic"><Icono nombre="dispensacion" :tamano="20" :grosor="2" /></span>
            <span class="min-w-0 flex-1 text-left"><b class="block text-tinta">Queda en farmacia</b><small>{{ datos.pasosFarmacia.length }} {{ datos.pasosFarmacia.length === 1 ? 'entrega de bodega' : 'entregas de bodega' }}</small></span>
            <span class="text-right">
              <b class="block tabular-nums text-tinta">{{ miles(recorrido.enFarmacia) }}</b>
              <small>{{ pct(recorrido.enFarmacia) }} %</small>
            </span>
            <span class="barra"><span :style="{ width: `${pct(recorrido.enFarmacia)}%` }" /></span>
          </button>
        </div>
      </div>

      <!-- Detalle -->
      <section class="b-panel mt-5">
        <header class="b-panel-cabeza">
          <div class="b-segmentado" role="radiogroup" aria-label="Detalle">
            <button v-for="p in [['farmacia', `Bodega → farmacia (${datos.pasosFarmacia?.length ?? 0})`], ['servicios', `Servicios (${porServicio.length})`], ['pacientes', `Pacientes (${datos.pacientes.length})`], ['movimientos', `Movimientos (${datos.movimientos.length})`]]" :key="p[0]" type="button" role="radio" :aria-checked="detalle === p[0]" :class="detalle === p[0] ? 'on' : ''" @click="detalle = p[0]">{{ p[1] }}</button>
          </div>
        </header>

        <ul v-if="detalle === 'farmacia'" class="lista">
          <li v-for="(p, i) in datos.pasosFarmacia" :key="i" class="fila">
            <span class="min-w-0 flex-1">
              <b class="block text-tinta">{{ p.sentido === 'a_farmacia' ? 'De bodega a farmacia' : 'Devuelto de farmacia a bodega' }}</b>
              <small>
                {{ fechaHora(p.fecha) }} · {{ p.usuario }}
                <template v-if="p.numero"> · documento <span class="font-mono">{{ p.numero }}</span></template>
                <template v-if="p.recibidoPor"> · recibió {{ p.recibidoPor }}</template>
                <template v-if="p.motivo && !p.numero"> · {{ p.motivo }}</template>
              </small>
            </span>
            <b class="tabular-nums text-tinta">{{ p.sentido === 'a_farmacia' ? '' : '−' }}{{ miles(p.cantidad) }}</b>
          </li>
          <li v-if="!datos.pasosFarmacia?.length" class="b-vacio">Este lote no ha pasado a la farmacia.</li>
        </ul>

        <ul v-else-if="detalle === 'servicios'" class="lista">
          <li v-for="g in porServicio" :key="g.ubicacion" class="fila">
            <span class="min-w-0 flex-1">
              <b class="block text-tinta">{{ g.ubicacion }}</b>
              <small>
                <template v-for="(t, i) in g.traslados" :key="t.trasladoId">{{ i ? ' · ' : '' }}<RouterLink :to="`/imprimir/traslado/${t.trasladoId}`" target="_blank" class="font-mono hover:underline">{{ t.numero }}</RouterLink> {{ fecha(t.fecha) }}</template>
                · recibió {{ g.traslados[0].recibidoPor }}
              </small>
            </span>
            <b class="tabular-nums text-tinta">{{ miles(g.cantidad) }}</b>
          </li>
          <li v-if="!porServicio.length" class="b-vacio">Este lote no se ha trasladado a ningún servicio.</li>
        </ul>

        <ul v-else-if="detalle === 'pacientes'" class="lista">
          <li v-for="p in datos.pacientes" :key="`${p.pacienteId}-${p.entregadoEn}`" class="fila">
            <span class="min-w-0 flex-1">
              <RouterLink :to="`/pacientes/${p.pacienteId}`" class="block font-bold text-tinta hover:underline">{{ p.nombreCompleto }}</RouterLink>
              <small>Exp. {{ p.expediente }} · {{ p.comunidad }} · entregado {{ fechaHora(p.entregadoEn) }}<template v-if="p.entregadoPor"> por {{ p.entregadoPor }}</template></small>
              <small v-if="p.medico || p.diagnostico">Recetó {{ p.medico ?? '—' }}<template v-if="p.diagnostico"> · {{ p.diagnostico }}</template><template v-if="p.indicaciones"> · {{ p.indicaciones }}</template></small>
              <small v-if="p.anulada" class="text-[#B7710A]">Entrega anulada: volvió al lote</small>
            </span>
            <b class="tabular-nums text-tinta">{{ miles(p.cantidad) }}</b>
          </li>
          <li v-if="!datos.pacientes.length" class="b-vacio">Este lote no se ha entregado a pacientes.</li>
        </ul>

        <ol v-else class="lista">
          <li v-for="m in datos.movimientos" :key="m.id" class="fila">
            <span class="punto" :class="m.cantidad > 0 ? 'entra' : 'sale'" />
            <span class="min-w-0 flex-1">
              <b class="block text-tinta">{{ m.etiqueta }}</b>
              <small>{{ m.ubicacionEtiqueta }} · {{ fechaHora(m.fecha) }} · {{ m.usuario }}<template v-if="m.motivo"> · {{ m.motivo }}</template></small>
            </span>
            <span class="text-right">
              <b class="block tabular-nums" :class="m.cantidad > 0 ? 'text-[#1E8E5E]' : 'text-tinta'">{{ m.cantidad > 0 ? '+' : '' }}{{ miles(m.cantidad) }}</b>
              <small>quedan {{ miles(m.saldoResultante) }}</small>
            </span>
          </li>
        </ol>
      </section>
    </template>
    </template>
  </section>
</template>

<style scoped>
.paciente-mini { background: #172A5A; }
.ficha-paciente { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 16px 20px; background: #fff; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 18px; }
.ic-paciente { display: grid; place-items: center; flex-shrink: 0; width: 54px; height: 54px; border-radius: 16px; background: #172A5A; color: #fff; box-shadow: inset 0 -4px 0 #0B163A; }
.cifra-paciente { display: grid; justify-items: center; min-width: 86px; padding: 6px 12px; border-radius: 14px; background: #EAF3FB; color: #1F5F99; }
.cifra-paciente b { font-size: 24px; font-weight: 900; line-height: 1.1; color: #172A5A; }
.cifra-paciente span { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
.cifra-paciente.rojo { background: #FDECEC; color: #A52A2A; }
.cifra-paciente.rojo b { color: #A52A2A; }
.entrega-traza { display: flex; align-items: center; gap: 14px; padding: 10px 18px; border-top: 1px solid #EEF2F6; }
.entrega-traza:first-child { border-top: none; }
.entrega-traza.anulada { opacity: .5; text-decoration: line-through; }
.cant-traza { font-size: 20px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.lote-traza { display: grid; justify-items: start; flex-shrink: 0; min-width: 130px; padding: 6px 12px; border: 2px solid #CBD5E1; border-bottom-width: 4px; border-left: 5px solid #1E8E5E; border-radius: 12px; background: #fff; text-align: left; color: #14244A; }
.lote-traza:hover { border-color: #172A5A; border-left-color: inherit; }
.lote-traza:active { transform: translateY(2px); border-bottom-width: 2px; }
.lote-traza small { font-size: 12px; color: #64748B; }
.lote-traza.amarillo { border-left-color: #D9A400; }
.lote-traza.rojo { border-left-color: #E8930C; }
.lote-traza.vencido { border-left-color: #C03535; }
.resultados { position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px); max-height: 380px; overflow-y: auto; padding: 4px; background: #fff; border: 2px solid #172A5A; border-radius: 12px; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, .35); }
.resultados.vacia { padding: 14px; text-align: center; font-weight: 600; color: #64748B; }
.resultado { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 4px 10px; border-radius: 8px; text-align: left; }
.resultado:hover { background: #EEF2FF; }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 28px; border-radius: 7px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 17px; height: 17px; }
.inicio { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 16px; text-align: center; }

.lote { display: flex; flex-wrap: wrap; border: 2px solid #CBD5E1; border-radius: 16px; overflow: hidden; background: #fff; }
.talon { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 200px; padding: 18px 20px; background: var(--cat-fondo); border-right: 2px dashed #CBD5E1; }
.talon .numero { font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 600; color: #14244A; word-break: break-all; }
.cuadre { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.cuadre.ok { color: #1E8E5E; }
.cuadre.mal { color: #C03535; }

.recorrido { display: grid; grid-template-columns: 220px 60px minmax(0, 1fr); align-items: center; }
@media (max-width: 900px) { .recorrido { grid-template-columns: 1fr; gap: 12px; } .flecha { display: none; } }
.nodo.origen { display: flex; flex-direction: column; gap: 2px; padding: 18px 20px; border: 2px solid #172A5A; border-radius: 14px; background: #F1F5FA; }
.nodo b { font-size: 32px; font-weight: 700; line-height: 1.1; color: #14244A; font-variant-numeric: tabular-nums; }
.nodo small, .destino small { display: block; font-size: 12px; font-weight: 600; color: #64748B; }
.flecha { position: relative; height: 2px; background: #94A3B8; }
.flecha span { position: absolute; right: -2px; top: -6px; border: 7px solid transparent; border-left: 10px solid #94A3B8; border-right: none; }
.destinos { display: flex; flex-direction: column; gap: 8px; padding-left: 16px; border-left: 2px solid #CBD5E1; }
.destino { position: relative; display: flex; align-items: center; gap: 12px; padding: 10px 14px 14px; border: 2px solid #E2E8F0; border-radius: 12px; background: #fff; overflow: hidden; }
button.destino:hover { border-color: #94A3B8; }
.destino.on { border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.destino::before { content: ''; position: absolute; left: -18px; top: 50%; width: 16px; height: 2px; background: #CBD5E1; }
.destino .ic { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px; color: #fff; }
.destino.azul .ic { background: #3D7BE0; }
.destino.verde .ic { background: #22A06B; }
.destino.gris .ic { background: #64748B; }
.destino.rojo .ic { background: #C8456A; }
.destino.queda { background: #F8FAFC; }
.destino.queda .ic { background: #172A5A; }
.barra { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: #EEF2F6; }
.barra span { display: block; height: 100%; }
.azul .barra span { background: #3D7BE0; }
.verde .barra span { background: #22A06B; }
.gris .barra span { background: #64748B; }
.rojo .barra span { background: #C8456A; }
.queda .barra span { background: #172A5A; }

.lista { max-height: max(320px, calc(100vh - 560px)); overflow-y: auto; }
.fila { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-top: 1px solid #EEF2F6; }
.fila:first-child { border-top: none; }
.fila small { display: block; font-size: 12px; font-weight: 600; color: #64748B; }
.punto { flex-shrink: 0; width: 12px; height: 12px; border-radius: 50%; }
.punto.entra { background: #22A06B; }
.punto.sale { background: #fff; border: 2.5px solid #64748B; }
/* --- Relieve (estilo duo) --- */
.resultados { border-bottom-width: 4px; border-radius: 16px; }
.lote { border-bottom-width: 5px; border-radius: 20px; }
.nodo.origen { border-bottom-width: 5px; border-bottom-color: #0B163A; border-radius: 18px; }
.destino { border-bottom-width: 4px; border-radius: 16px; }
button.destino:active { transform: translateY(2px); border-bottom-width: 2px; }
</style>
