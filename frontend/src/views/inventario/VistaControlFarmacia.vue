<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import farmacia from '../../services/farmacia';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../../components/comunes/Icono.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';

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
const pestana = ref('dia');
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
const devolviendo = ref(null);
const devolucion = reactive({ cantidad: '', motivo: '' });

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
watch(pestana, (p) => (p === 'dia' ? cargarDia() : cargarExistencias()));

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

// --- Existencias y devolución a bodega --------------------------------------------

const filasExistencia = computed(() => existencias.value
  .filter((x) => x.enFarmacia > 0 || buscar.value)
  .filter((x) => !buscar.value || sinTildes(x.nombre).includes(sinTildes(buscar.value))));

function abrirDevolucion(insumo, lote) {
  devolviendo.value = { insumo, lote };
  devolucion.cantidad = String(lote.cantidad);
  devolucion.motivo = lote.semaforo === 'rojo' || lote.semaforo === 'vencido' ? 'Próximo a vencer' : '';
}

async function devolver() {
  error.value = '';
  enviando.value = true;
  try {
    await farmacia.devolver({
      renglones: [{ loteId: devolviendo.value.lote.loteId, cantidad: entero(devolucion.cantidad) }],
      motivo: devolucion.motivo.trim(),
    }, nuevaClaveIdempotencia());
    aviso.value = `Se devolvieron ${devolucion.cantidad} de ${devolviendo.value.insumo.nombre} (lote ${devolviendo.value.lote.numeroLote}) a bodega.`;
    devolviendo.value = null;
    await cargarExistencias();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const SEMAFORO = { vencido: 'Vencido', rojo: 'Menos de 12 meses', amarillo: '12 a 18 meses', verde: 'Más de 18 meses', sin_fecha: 'Sin fecha' };
const fechaCorta = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const hora = (v) => (v ? new Date(v).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) : '');
const imprimir = () => window.print();

onMounted(cargarDia);
</script>

<template>
  <section>
    <RouterLink to="/dispensacion" class="b-volver no-imprimir"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Dispensación</RouterLink>
    <header class="b-cabecera">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">Control de farmacia</h1>
        <span v-if="pestana === 'dia'" class="b-antetitulo">{{ fechaCorta(`${fecha}T12:00:00`) }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2 no-imprimir">
        <div class="b-segmentado" role="radiogroup" aria-label="Vista">
          <button type="button" role="radio" :aria-checked="pestana === 'dia'" :class="pestana === 'dia' ? 'on' : ''" @click="pestana = 'dia'">El día</button>
          <button type="button" role="radio" :aria-checked="pestana === 'existencias'" :class="pestana === 'existencias' ? 'on' : ''" @click="pestana = 'existencias'">Existencias</button>
        </div>
        <button type="button" class="b-btn secundario" @click="imprimir"><Icono nombre="imprimir" :tamano="20" /> Imprimir</button>
      </div>
    </header>

    <p v-if="aviso" class="b-aviso ok mt-4 no-imprimir" aria-live="polite">{{ aviso }}</p>
    <p v-if="error" role="alert" class="b-aviso error mt-4 no-imprimir">{{ error }}</p>

    <div class="mt-5 flex flex-wrap items-end gap-3 no-imprimir">
      <div v-if="pestana === 'dia'">
        <label for="fecha-dia" class="b-etiqueta">Día</label>
        <input id="fecha-dia" v-model="fecha" type="date" :max="hoy" class="b-campo" />
      </div>
      <div class="min-w-[16rem] flex-1">
        <label for="buscar-med" class="b-etiqueta">Buscar medicamento</label>
        <input id="buscar-med" v-model="buscar" type="search" autocomplete="off" class="b-campo" />
      </div>
    </div>

    <!-- ===== El día ===== -->
    <template v-if="pestana === 'dia' && dia">
      <div class="tarjetas mt-5">
        <div class="b-panel tarjeta"><span>Pacientes atendidos</span><b>{{ miles(dia.totales.pacientes) }}</b></div>
        <div class="b-panel tarjeta"><span>Unidades entregadas</span><b>{{ miles(dia.totales.entregado) }}</b></div>
        <div class="b-panel tarjeta"><span>Recibido de bodega</span><b>{{ miles(dia.totales.recibido) }}</b></div>
        <div class="b-panel tarjeta" :class="dia.totales.noEntregado ? 'alerta' : ''"><span>No entregado por falta</span><b>{{ miles(dia.totales.noEntregado) }}</b></div>
      </div>

      <div v-if="dia.cierre" class="b-aviso ok mt-4">
        <Icono nombre="correcto" :tamano="20" />
        <span>Día cerrado por {{ dia.cierre.cerradoPor }} a las {{ hora(dia.cierre.cerradoEn) }}.
          {{ dia.cierre.conteos.filter((c) => c.diferencia).length ? `${dia.cierre.conteos.filter((c) => c.diferencia).length} medicamento(s) con diferencia.` : 'Lo contado coincidió con el sistema.' }}</span>
      </div>
      <div v-else-if="dia.esHoy && !contando" class="mt-4 flex justify-end no-imprimir">
        <button type="button" class="b-btn primario" @click="empezarConteo"><Icono nombre="correcto" :tamano="20" /> Contar y cerrar el día</button>
      </div>
      <p v-if="contando" class="b-aviso atencion mt-4 no-imprimir">
        Cuente lo que hay en el estante y escríbalo. Deje en blanco lo que no contó. Si no coincide, explique por qué.
      </p>

      <div class="b-tabla-marco mt-4">
        <table class="b-tabla">
          <thead>
            <tr>
              <th>Medicamento</th>
              <th class="text-right">Abrió con</th>
              <th class="text-right">De bodega</th>
              <th class="text-right">Devuelto</th>
              <th class="text-right">Entregado</th>
              <th class="text-right">No entregado</th>
              <th class="text-right">Ajuste</th>
              <th class="text-right">Cierra con</th>
              <th v-if="contando" class="text-right">Contado</th>
              <th v-if="contando">Por qué no coincide</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in filasDia" :key="f.insumoId">
              <td>{{ f.nombre }}</td>
              <td class="text-right">{{ miles(f.saldoInicial) }}</td>
              <td class="text-right">{{ f.recibido ? miles(f.recibido) : '–' }}</td>
              <td class="text-right">{{ f.devuelto ? miles(f.devuelto) : '–' }}</td>
              <td class="text-right">{{ f.entregado ? miles(f.entregado) : '–' }}</td>
              <td class="text-right" :class="f.noEntregado ? 'text-advertencia font-bold' : ''">{{ f.noEntregado ? miles(f.noEntregado) : '–' }}</td>
              <td class="text-right">{{ f.ajuste ? `${f.ajuste > 0 ? '+' : ''}${miles(f.ajuste)}` : '–' }}</td>
              <td class="text-right font-bold">{{ miles(f.saldoFinal) }}</td>
              <td v-if="contando" class="text-right">
                <input v-model="conteo[f.insumoId]" inputmode="numeric" :aria-label="`Contado de ${f.nombre}`" class="b-campo num contado" />
                <small v-if="diferencia(f)" class="block" :class="diferencia(f) < 0 ? 'text-advertencia' : 'text-mejora'">{{ diferencia(f) > 0 ? '+' : '' }}{{ diferencia(f) }}</small>
              </td>
              <td v-if="contando">
                <input v-if="diferencia(f)" v-model="motivos[f.insumoId]" :aria-label="`Motivo de la diferencia de ${f.nombre}`" placeholder="Ej.: frasco quebrado" class="b-campo" />
              </td>
            </tr>
            <tr v-if="!filasDia.length"><td :colspan="contando ? 10 : 8" class="b-vacio">Sin movimiento ni existencia.</td></tr>
          </tbody>
        </table>
      </div>

      <div v-if="contando" class="b-panel mt-4 p-4 no-imprimir">
        <label for="obs-cierre" class="b-etiqueta">Observación del día <span class="b-opcional">opcional</span></label>
        <input id="obs-cierre" v-model="observacion" class="b-campo" />
        <div class="mt-3 flex justify-end gap-2">
          <button type="button" class="b-btn secundario" @click="contando = false">Cancelar</button>
          <button type="button" class="b-btn primario" :disabled="enviando || !contados.length || faltaMotivo" @click="cerrarDia">
            {{ enviando ? 'Cerrando…' : `Cerrar el día (${contados.length} contados)` }}
          </button>
        </div>
      </div>

      <section v-if="dia.entregas.length" class="mt-6">
        <h2 class="grupo">Entregas del día <span>{{ dia.entregas.length }}</span></h2>
        <div class="b-tabla-marco">
          <table class="b-tabla">
            <thead><tr><th>Hora</th><th>Paciente</th><th>Médico</th><th>Medicamentos y lotes</th><th>Entregó</th></tr></thead>
            <tbody>
              <tr v-for="e in dia.entregas" :key="e.atencionId">
                <td>{{ hora(e.hora) }}</td>
                <td><b>{{ e.paciente.nombreCompleto }}</b><small class="block text-apagado">Exp. {{ e.paciente.expediente }}</small></td>
                <td>{{ e.medico ?? '—' }}</td>
                <td><span v-for="(x, i) in e.renglones" :key="i" class="block">{{ x.medicamento }} × {{ x.cantidad }} · lote {{ x.numeroLote }}</span></td>
                <td>{{ e.entregadoPor }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="dia.movimientosBodega.length" class="mt-6">
        <h2 class="grupo">Con la bodega</h2>
        <ul class="b-panel bodega">
          <li v-for="(m, i) in dia.movimientosBodega" :key="i">
            <b>{{ m.tipo === 'recibido' ? 'Recibido de bodega' : 'Devuelto a bodega' }}</b>
            <template v-if="m.numero"> · {{ m.numero }}</template> · {{ hora(m.hora) }} · {{ m.usuario }}
            <small class="block text-apagado">{{ m.renglones.map((x) => `${x.medicamento} lote ${x.numeroLote} × ${x.cantidad}`).join(' · ') }}</small>
          </li>
        </ul>
      </section>
    </template>

    <!-- ===== Existencias ===== -->
    <template v-if="pestana === 'existencias'">
      <div class="b-tabla-marco mt-5">
        <table class="b-tabla">
          <thead>
            <tr><th>Medicamento</th><th class="text-right">En farmacia</th><th class="text-right">En bodega</th><th>Lotes en farmacia</th></tr>
          </thead>
          <tbody>
            <tr v-for="x in filasExistencia" :key="x.insumoId">
              <td>
                <b>{{ x.nombre }}</b>
                <small v-if="x.entregable < x.enFarmacia" class="block text-advertencia">{{ x.enFarmacia - x.entregable }} no se pueden entregar (vencido o en cuarentena)</small>
              </td>
              <td class="text-right font-bold">{{ miles(x.enFarmacia) }}</td>
              <td class="text-right">{{ miles(x.enBodega) }}</td>
              <td>
                <div v-for="l in x.lotes" :key="l.loteId" class="lote">
                  <span class="punto" :class="l.semaforo" :title="SEMAFORO[l.semaforo]" />
                  <span class="tabular-nums">{{ l.numeroLote }} · vence {{ fechaCorta(l.fechaVence) }} · {{ miles(l.cantidad) }}</span>
                  <button type="button" class="enlace text-sm no-imprimir" @click="abrirDevolucion(x, l)">Devolver a bodega</button>
                </div>
                <span v-if="!x.lotes.length" class="text-apagado">—</span>
              </td>
            </tr>
            <tr v-if="!filasExistencia.length"><td colspan="4" class="b-vacio">Sin existencia en farmacia.</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Devolver a bodega -->
    <div v-if="devolviendo" class="fondo no-imprimir" role="dialog" aria-modal="true" aria-labelledby="titulo-devolver" @click.self="devolviendo = null">
      <form class="b-panel ventana" @submit.prevent="devolver">
        <header class="b-panel-cabeza"><h2 id="titulo-devolver" class="b-panel-titulo">Devolver a bodega</h2></header>
        <div class="b-panel-cuerpo space-y-3">
          <p><b>{{ devolviendo.insumo.nombre }}</b> · lote {{ devolviendo.lote.numeroLote }} · en farmacia {{ devolviendo.lote.cantidad }}</p>
          <div>
            <label for="dev-cantidad" class="b-etiqueta">Cantidad</label>
            <input id="dev-cantidad" v-model="devolucion.cantidad" inputmode="numeric" required class="b-campo num" />
          </div>
          <div>
            <label for="dev-motivo" class="b-etiqueta">Motivo</label>
            <input id="dev-motivo" v-model="devolucion.motivo" required minlength="3" class="b-campo" />
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="b-btn secundario" @click="devolviendo = null">Cancelar</button>
            <button type="submit" class="b-btn primario" :disabled="enviando || !entero(devolucion.cantidad) || entero(devolucion.cantidad) > devolviendo.lote.cantidad">Devolver</button>
          </div>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
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
.grupo { margin-bottom: 8px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
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
}
</style>
