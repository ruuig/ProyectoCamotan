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
// Tres preguntas: ¿qué tengo? (estante), ¿qué entró y salió? (hoy), ¿cuadra? (contar).
const pestana = ref('existencias');
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
watch(pestana, (p) => (p === 'existencias' ? cargarExistencias() : cargarDia()));

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

// El estante se filtra por lo que hay que atender: sin lote, vencido, por vencer.
const filtroEstante = ref('todo');
const esSinLote = (l) => l.numeroLote === 'SIN-LOTE';
const esVencido = (l) => l.semaforo === 'vencido';
const porVencer = (l) => l.semaforo === 'rojo';
const conteoEstante = computed(() => {
  const con = (f) => existencias.value.filter((x) => x.lotes.some(f)).length;
  return { sinLote: con(esSinLote), vencidos: con(esVencido), porVencer: con(porVencer) };
});
const filasExistencia = computed(() => existencias.value
  .filter((x) => x.enFarmacia > 0 || buscar.value)
  .filter((x) => filtroEstante.value === 'todo'
    || (filtroEstante.value === 'sin_lote' && x.lotes.some(esSinLote))
    || (filtroEstante.value === 'vencidos' && x.lotes.some(esVencido))
    || (filtroEstante.value === 'por_vencer' && x.lotes.some(porVencer)))
  .filter((x) => !buscar.value || sinTildes(x.nombre).includes(sinTildes(buscar.value))));

// Poner el lote real a lo que entró sin lote: así se puede entregar y rastrear.
const poniendo = ref(null);
const nuevoLote = reactive({ numeroLote: '', fechaVence: '', cantidad: '' });
function abrirPonerLote(insumo, lote) {
  poniendo.value = { insumo, lote };
  Object.assign(nuevoLote, { numeroLote: '', fechaVence: '', cantidad: String(lote.cantidad) });
}
async function guardarLote() {
  error.value = '';
  enviando.value = true;
  try {
    const r = await farmacia.ponerLote({
      loteId: poniendo.value.lote.loteId,
      numeroLote: nuevoLote.numeroLote.trim(),
      fechaVence: nuevoLote.fechaVence,
      cantidad: entero(nuevoLote.cantidad),
    }, nuevaClaveIdempotencia());
    aviso.value = `${r.insumo}: ${miles(r.cantidad)} quedaron en el lote ${r.numeroLote}. Ya se pueden entregar.`;
    poniendo.value = null;
    await cargarExistencias();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

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

onMounted(() => { cargarDia(); cargarExistencias(); });

// Hoy: lo que entró de bodega, lo que salió a pacientes y lo devuelto.
const recibidos = computed(() => (dia.value?.movimientosBodega ?? []).filter((m) => m.tipo === 'recibido'));
const devueltos = computed(() => (dia.value?.movimientosBodega ?? []).filter((m) => m.tipo !== 'recibido'));
const suma = (lista) => lista.reduce((t, m) => t + m.renglones.reduce((u, x) => u + x.cantidad, 0), 0);
</script>

<template>
  <section>
    <RouterLink to="/dispensacion" class="b-volver no-imprimir"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Dispensación</RouterLink>
    <header class="b-cabecera">
      <div>
        <p class="b-antetitulo">Farmacia</p>
        <h1 class="b-titulo">Control de farmacia</h1>
      </div>
      <button type="button" class="b-btn secundario no-imprimir" @click="imprimir"><Icono nombre="imprimir" :tamano="20" /> Imprimir</button>
    </header>

    <nav class="pestanas-grandes mt-5 no-imprimir" aria-label="Control de farmacia">
      <button type="button" :class="{ on: pestana === 'existencias' }" @click="pestana = 'existencias'">
        <Icono nombre="inventario" :tamano="24" />
        <span><b>Estante</b><small>¿Qué tengo?</small></span>
      </button>
      <button type="button" :class="{ on: pestana === 'hoy' }" @click="pestana = 'hoy'">
        <Icono nombre="trasladar" :tamano="24" />
        <span><b>Hoy</b><small>¿Qué entró y qué salió?</small></span>
      </button>
      <button type="button" :class="{ on: pestana === 'contar' }" @click="pestana = 'contar'">
        <Icono nombre="correcto" :tamano="24" />
        <span><b>Contar</b><small>¿Cuadra lo que hay?</small></span>
      </button>
    </nav>

    <p v-if="aviso" class="b-aviso ok mt-4 no-imprimir" aria-live="polite">{{ aviso }}</p>
    <p v-if="error" role="alert" class="b-aviso error mt-4 no-imprimir">{{ error }}</p>

    <div class="mt-5 flex flex-wrap items-end gap-3 no-imprimir">
      <div v-if="pestana === 'hoy'">
        <label for="fecha-dia" class="b-etiqueta">Día</label>
        <input id="fecha-dia" v-model="fecha" type="date" :max="hoy" class="b-campo" />
      </div>
      <div v-if="pestana !== 'hoy'" class="min-w-[16rem] flex-1">
        <label for="buscar-med" class="b-etiqueta">Buscar medicamento</label>
        <input id="buscar-med" v-model="buscar" type="search" autocomplete="off" class="b-campo" />
      </div>
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
      <div class="flujo mt-5">
        <div class="flujo-cifra entra"><Icono nombre="recibir" :tamano="26" /><b>{{ miles(suma(recibidos)) }}</b><span>Entró de bodega</span></div>
        <div class="flujo-cifra sale"><Icono nombre="dispensacion" :tamano="26" /><b>{{ miles(dia.totales.entregado) }}</b><span>Salió a {{ dia.totales.pacientes }} pacientes</span></div>
        <div class="flujo-cifra vuelve"><Icono nombre="trasladar" :tamano="26" /><b>{{ miles(suma(devueltos)) }}</b><span>Devuelto a bodega</span></div>
        <div v-if="dia.totales.noEntregado" class="flujo-cifra falta"><Icono nombre="alerta" :tamano="26" /><b>{{ miles(dia.totales.noEntregado) }}</b><span>No había</span></div>
      </div>

      <section class="mt-5">
        <h2 class="grupo"><Icono nombre="recibir" :tamano="16" /> Entró de bodega</h2>
        <p v-if="!recibidos.length" class="vacio-linea">Hoy no llegó nada de bodega. Las entradas las registra bodega al entregar la requisición a "Post-consulta".</p>
        <ul v-else class="movs">
          <li v-for="(m, i) in recibidos" :key="i" class="mov entra">
            <div class="mov-cabeza"><b>{{ m.numero ?? 'Entrega de bodega' }}</b><span>{{ hora(m.hora) }} · {{ m.usuario }}</span></div>
            <div class="mov-lotes"><span v-for="(x, k) in m.renglones" :key="k" class="lote-linea">{{ x.medicamento }} <b>× {{ miles(x.cantidad) }}</b> <code>{{ x.numeroLote }}</code></span></div>
          </li>
        </ul>
      </section>

      <section class="mt-5">
        <h2 class="grupo"><Icono nombre="dispensacion" :tamano="16" /> Salió a pacientes <span>{{ dia.entregas.length }}</span></h2>
        <p v-if="!dia.entregas.length" class="vacio-linea">Hoy no se entregó nada.</p>
        <ul v-else class="movs">
          <li v-for="e in dia.entregas" :key="e.atencionId" class="mov sale">
            <div class="mov-cabeza"><b>{{ e.paciente.nombreCompleto }}</b><span>{{ hora(e.hora) }} · entregó {{ e.entregadoPor }}</span></div>
            <div class="mov-lotes"><span v-for="(x, i) in e.renglones" :key="i" class="lote-linea">{{ x.medicamento }} <b>× {{ x.cantidad }}</b> <code>{{ x.numeroLote }}</code></span></div>
          </li>
        </ul>
      </section>

      <section v-if="devueltos.length" class="mt-5">
        <h2 class="grupo"><Icono nombre="trasladar" :tamano="16" /> Devuelto a bodega</h2>
        <ul class="movs">
          <li v-for="(m, i) in devueltos" :key="i" class="mov vuelve">
            <div class="mov-cabeza"><b>Devolución</b><span>{{ hora(m.hora) }} · {{ m.usuario }}</span></div>
            <div class="mov-lotes"><span v-for="(x, k) in m.renglones" :key="k" class="lote-linea">{{ x.medicamento }} <b>× {{ miles(x.cantidad) }}</b> <code>{{ x.numeroLote }}</code></span></div>
          </li>
        </ul>
      </section>
      </template>
    </template>

    <!-- ===== Existencias ===== -->
    <template v-if="pestana === 'existencias'">
      <div class="filtros-estante mt-5" role="radiogroup" aria-label="Qué ver del estante">
        <button type="button" :class="{ on: filtroEstante === 'todo' }" @click="filtroEstante = 'todo'"><Icono nombre="inventario" :tamano="20" /> Todo</button>
        <button type="button" class="ambar" :class="{ on: filtroEstante === 'sin_lote' }" @click="filtroEstante = 'sin_lote'"><Icono nombre="lapiz" :tamano="20" /> Sin lote <b>{{ conteoEstante.sinLote }}</b></button>
        <button type="button" class="rojo" :class="{ on: filtroEstante === 'vencidos' }" @click="filtroEstante = 'vencidos'"><Icono nombre="vencimiento" :tamano="20" /> Vencidos <b>{{ conteoEstante.vencidos }}</b></button>
        <button type="button" class="naranja" :class="{ on: filtroEstante === 'por_vencer' }" @click="filtroEstante = 'por_vencer'"><Icono nombre="reloj" :tamano="20" /> Por vencer <b>{{ conteoEstante.porVencer }}</b></button>
      </div>

      <ul class="estante mt-4">
        <li v-for="x in filasExistencia" :key="x.insumoId" class="caja-med">
          <div class="caja-cabeza">
            <p class="caja-nombre">{{ x.nombre }}</p>
            <div class="caja-cifras">
              <span><b>{{ miles(x.entregable) }}</b> para entregar</span>
              <span v-if="x.enFarmacia > x.entregable" class="bloqueado"><b>{{ miles(x.enFarmacia - x.entregable) }}</b> detenidos</span>
              <span class="gris">bodega {{ miles(x.enBodega) }}</span>
            </div>
          </div>
          <div class="caja-lotes">
            <div v-for="l in x.lotes" :key="l.loteId" class="boleto" :class="esSinLote(l) ? 'sin-lote' : l.semaforo">
              <span class="boleto-lote">{{ esSinLote(l) ? 'Sin lote' : l.numeroLote }}</span>
              <span class="boleto-dato">{{ esSinLote(l) ? 'no se puede entregar' : esVencido(l) ? `venció ${fechaCorta(l.fechaVence)}` : `vence ${fechaCorta(l.fechaVence)}` }}</span>
              <span class="boleto-cant">{{ miles(l.cantidad) }}</span>
              <button v-if="esSinLote(l)" type="button" class="b-btn exito chico no-imprimir" @click="abrirPonerLote(x, l)"><Icono nombre="lapiz" :tamano="16" /> Poner lote</button>
              <button v-else type="button" class="b-btn chico no-imprimir" :class="esVencido(l) ? 'peligro' : 'secundario'" @click="abrirDevolucion(x, l)"><Icono nombre="trasladar" :tamano="16" /> Devolver</button>
            </div>
            <span v-if="!x.lotes.length" class="text-apagado">Sin existencia en farmacia</span>
          </div>
        </li>
        <li v-if="!filasExistencia.length" class="b-vacio">Nada que mostrar aquí.</li>
      </ul>
    </template>

    <!-- Poner lote -->
    <div v-if="poniendo" class="fondo no-imprimir" role="dialog" aria-modal="true" aria-labelledby="titulo-lote" @click.self="poniendo = null">
      <form class="b-panel ventana" @submit.prevent="guardarLote">
        <header class="b-panel-cabeza"><h2 id="titulo-lote" class="b-panel-titulo">Poner lote</h2></header>
        <div class="b-panel-cuerpo space-y-3">
          <p class="poner-med"><b>{{ poniendo.insumo.nombre }}</b><span>{{ miles(poniendo.lote.cantidad) }} sin lote en farmacia</span></p>
          <div>
            <label for="pl-lote" class="b-etiqueta">Número de lote (como dice la caja)</label>
            <input id="pl-lote" v-model="nuevoLote.numeroLote" required minlength="2" autocomplete="off" class="b-campo grande-campo font-mono uppercase" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="pl-vence" class="b-etiqueta">Vence</label>
              <input id="pl-vence" v-model="nuevoLote.fechaVence" type="date" required class="b-campo grande-campo" />
            </div>
            <div>
              <label for="pl-cant" class="b-etiqueta">Cantidad de ese lote</label>
              <input id="pl-cant" v-model="nuevoLote.cantidad" inputmode="numeric" required class="b-campo grande-campo num" />
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="b-btn secundario" @click="poniendo = null">Cancelar</button>
            <button type="submit" class="b-btn exito" :disabled="enviando || !nuevoLote.numeroLote.trim() || !nuevoLote.fechaVence || !entero(nuevoLote.cantidad) || entero(nuevoLote.cantidad) > poniendo.lote.cantidad">
              <Icono nombre="correcto" :tamano="20" /> Guardar lote
            </button>
          </div>
        </div>
      </form>
    </div>

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
.pestanas-grandes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.pestanas-grandes button { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border: 2px solid #E2E8F0; border-bottom-width: 5px; border-radius: 18px; background: #fff; text-align: left; color: #475569; transition: transform .06s; }
.pestanas-grandes button:active { transform: translateY(2px); border-bottom-width: 3px; }
.pestanas-grandes button svg { flex-shrink: 0; color: #2F83C4; }
.pestanas-grandes b { display: block; font-size: 18px; font-weight: 900; color: #14244A; }
.pestanas-grandes small { display: block; font-size: 13px; font-weight: 700; color: #64748B; }
.pestanas-grandes button.on { background: #EAF3FB; border-color: #4A9BD6; border-bottom-color: #2F83C4; }
@media (max-width: 700px) { .pestanas-grandes { grid-template-columns: 1fr; } }
.b-btn.grande { height: 56px; padding: 0 26px; border-radius: 16px; font-size: 17px; }
.debe { font-size: 17px; font-weight: 900; color: #14244A; }
.dif { display: inline-block; min-width: 64px; padding: 3px 10px; border-radius: 9px; font-weight: 900; text-align: center; }
.dif.ok { background: #E2F5EA; color: #145C3C; }
.dif.menos { background: #FDECEC; color: #A52A2A; }
.dif.mas { background: #FFF4D6; color: #8A5A06; }
.flujo { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.flujo-cifra { display: grid; justify-items: start; gap: 2px; padding: 14px 18px; border: 2px solid #E2E8F0; border-bottom-width: 5px; border-radius: 18px; background: #fff; }
.flujo-cifra b { font-size: 32px; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
.flujo-cifra span { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #64748B; }
.flujo-cifra.entra { border-color: #B5E2CB; border-bottom-color: #47B47D; } .flujo-cifra.entra svg, .flujo-cifra.entra b { color: #1A8F57; }
.flujo-cifra.sale { border-color: #B8DAF1; border-bottom-color: #2F83C4; } .flujo-cifra.sale svg, .flujo-cifra.sale b { color: #1F5F99; }
.flujo-cifra.vuelve svg, .flujo-cifra.vuelve b { color: #475569; }
.flujo-cifra.falta { border-color: #F5D58A; border-bottom-color: #E8930C; } .flujo-cifra.falta svg, .flujo-cifra.falta b { color: #8A5A06; }
.grupo { display: flex; align-items: center; gap: 6px; }
.vacio-linea { padding: 14px 16px; border: 2px dashed #CBD5E1; border-radius: 14px; font-weight: 600; color: #64748B; }
.movs { display: grid; gap: 8px; }
.mov { padding: 12px 16px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-left: 6px solid #94A3B8; border-radius: 14px; background: #fff; }
.mov.entra { border-left-color: #1A8F57; } .mov.sale { border-left-color: #2F83C4; }
.mov-cabeza { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
.mov-cabeza b { color: #14244A; }
.mov-cabeza span { font-size: 13px; font-weight: 600; color: #64748B; }
.mov-lotes { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; font-size: 14px; color: #334155; }
.lote-linea code { padding: 1px 7px; border-radius: 7px; background: #F1F5F9; font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 700; color: #14244A; }
.contador-pestana { margin-left: 4px; min-width: 22px; padding: 0 7px; border-radius: 8px; background: #172A5A; color: #fff; font-size: 12px; }
.filtros-estante { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 900px) { .filtros-estante { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.filtros-estante button { display: flex; align-items: center; justify-content: center; gap: 8px; height: 54px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 16px; background: #fff; font-weight: 800; font-size: 15px; color: #334155; transition: transform .06s; }
.filtros-estante button:active { transform: translateY(2px); border-bottom-width: 2px; }
.filtros-estante button b { min-width: 28px; padding: 1px 8px; border-radius: 9px; background: #F1F5F9; font-size: 14px; }
.filtros-estante button.on { background: #EAF3FB; border-color: #4A9BD6; border-bottom-color: #2F83C4; color: #172A5A; }
.filtros-estante button.ambar b { background: #FFF4D6; color: #8A5A06; }
.filtros-estante button.rojo b { background: #FDECEC; color: #A52A2A; }
.filtros-estante button.naranja b { background: #FFEDD5; color: #9A3412; }
.estante { display: grid; gap: 10px; }
.caja-med { padding: 14px 16px; background: #fff; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 18px; }
.caja-cabeza { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 16px; }
.caja-nombre { font-size: 16px; font-weight: 800; color: #14244A; }
.caja-cifras { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; font-weight: 700; color: #145C3C; }
.caja-cifras span { padding: 2px 10px; border-radius: 9px; background: #EAF7F0; }
.caja-cifras b { font-size: 15px; font-weight: 900; }
.caja-cifras .bloqueado { background: #FFF4D6; color: #8A5A06; }
.caja-cifras .gris { background: #F1F5F9; color: #475569; }
.caja-lotes { display: grid; gap: 6px; margin-top: 10px; }
.boleto { display: grid; grid-template-columns: 140px minmax(0, 1fr) 90px auto; align-items: center; gap: 10px; padding: 6px 8px 6px 14px; border: 2px solid #E2E8F0; border-left-width: 6px; border-left-color: #1E8E5E; border-radius: 12px; }
@media (max-width: 700px) { .boleto { grid-template-columns: 1fr auto; } }
.boleto.amarillo { border-left-color: #D9A400; }
.boleto.rojo { border-left-color: #E8930C; }
.boleto.vencido { border-left-color: #C03535; background: #FFF7F7; }
.boleto.sin-lote { border-left-color: #94A3B8; border-style: dashed; border-left-style: solid; background: #F8FAFC; }
.boleto-lote { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-weight: 700; color: #14244A; }
.sin-lote .boleto-lote { font-family: inherit; color: #8A5A06; }
.boleto-dato { font-size: 13px; font-weight: 600; color: #64748B; }
.vencido .boleto-dato { color: #A52A2A; font-weight: 800; }
.boleto-cant { text-align: right; font-weight: 900; font-size: 16px; color: #14244A; font-variant-numeric: tabular-nums; }
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
