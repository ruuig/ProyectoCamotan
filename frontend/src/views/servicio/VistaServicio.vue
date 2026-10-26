<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { textoNumero } from '../../dominio/hojasRequisicion';
import { usarBorrador, erroresPorRenglon, renglonPedido } from '../../dominio/borrador';
import AvisoBorrador from '../../components/comunes/AvisoBorrador.vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import bodega from '../../services/bodega';
import { useAuthStore } from '../../stores/auth';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../../components/comunes/Icono.vue';
import EditorPedido from '../../components/bodega/EditorPedido.vue';
import { miles, estiloTono } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Encargado de un centro o puesto de salud.
 *
 * Solo hace lo suyo: pide a la bodega con la requisición ya llena (corrige
 * cantidades, quita o agrega renglones) y sube el informe del mes con lo que
 * entregó. La bodega autoriza y despacha; con el despacho queda registrada la
 * salida de la bodega y la entrada al centro, sin capturar nada dos veces.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ver = computed(() => route.query.ver ?? 'inicio');
const ir = (v) => router.push({ query: v === 'inicio' ? {} : { ver: v } });

const error = ref('');
const aviso = ref('');
const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;
const hoy = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (p) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
function periodoMenos(n) {
  const d = new Date(Date.now() - 6 * 3600000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

// --- Lo que pasa con mis requisiciones ---------------------------------------------
const sugerencia = ref(null);
const mias = ref([]);
const ubicacion = computed(() => sugerencia.value?.ubicacion ?? null);

async function cargarMias() {
  mias.value = (await bodega.requisiciones()).requisiciones;
}

// --- Requisición ya llena ------------------------------------------------------------
const lineas = ref([]);
const cabecera = reactive({ solicitante: auth.usuario?.nombre ?? '', jefe: '', observaciones: '' });
const enviando = ref(false);
const borrador = usarBorrador('requisicion-servicio', { lineas, cabecera }, { vacio: (d) => !d.lineas.length });
borrador.recuperar();
function empezarDeNuevo() { borrador.limpiar(); llenar(); }

// Columnas de cada renglón: lo que tiene el puesto y lo que entrega al mes.
const COLUMNAS = ['Tiene', 'Entrega / mes'];
const conDetalle = (r) => ({ ...r, datos: [miles(r.tiene), miles(r.demandaMensual)] });
function llenar() {
  lineas.value = (sugerencia.value?.renglones ?? [])
    .filter((r) => r.sugerido > 0)
    .map((r) => ({ ...conDetalle(r), cantidad: String(r.sugerido) }));
}
const catalogo = computed(() => (sugerencia.value?.catalogo ?? []).map((c) => ({ id: c.insumoId, nombreGenerico: c.nombre, codigoInterno: '' })));
/** Renglón nuevo para el editor: con lo que tiene y lo que entrega, si se sabe. */
function nuevoRenglon(i) {
  const base = sugerencia.value.renglones.find((r) => r.insumoId === i.id)
    ?? { ...sugerencia.value.catalogo.find((c) => c.insumoId === i.id), demandaMensual: 0, tiene: 0, sugerido: 0 };
  return { ...conDetalle(base), cantidad: '' };
}
const erroresRenglon = ref({});
const aEnviar = computed(() => lineas.value.filter((l) => entero(l.cantidad) > 0));

async function enviar() {
  erroresRenglon.value = {};
  error.value = '';
  enviando.value = true;
  try {
    const r = await bodega.crearRequisicion({
      ubicacionId: ubicacion.value.id,
      fechaSolicitud: hoy(),
      solicitante: cabecera.solicitante.trim(),
      jefe: cabecera.jefe.trim() || null,
      observaciones: cabecera.observaciones.trim() || null,
      renglones: aEnviar.value.map(renglonPedido),
    }, nuevaClaveIdempotencia());
    // Bodega la imprime en el formulario al despacharla, con lo autorizado:
    // el encargado puede pedir desde el celular sin impresora.
    aviso.value = `Requisición enviada: ${aEnviar.value.length} ${aEnviar.value.length === 1 ? 'producto' : 'productos'}.`;
    lineas.value = [];
    borrador.limpiar();
    await cargarMias();
    ir('inicio');
  } catch (fallo) {
    erroresRenglon.value = erroresPorRenglon(fallo, aEnviar.value);
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const ESTADO = {
  solicitada: { texto: 'Enviada: bodega la revisa', tono: 'accion' },
  autorizada: { texto: 'Autorizada: falta despacharla', tono: 'accion' },
  despachada: { texto: 'Despachada', tono: 'bien' },
  parcial: { texto: 'Despachada en parte', tono: 'atencion' },
  recibida: { texto: 'Despachada', tono: 'bien' },
  anulada: { texto: 'Anulada', tono: 'critico' },
};
const pendientes = computed(() => mias.value.filter((r) => ['solicitada', 'autorizada'].includes(r.estado)).length);
const cancelando = ref(null);
async function cancelar(r) {
  cancelando.value = r.id;
  try {
    await bodega.anularRequisicion(r.id, 'El encargado la canceló antes de que bodega la atendiera');
    await cargarMias();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cancelando.value = null;
  }
}
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

// --- Informe del mes -------------------------------------------------------------------
const PERIODOS = [periodoMenos(1), periodoMenos(0), periodoMenos(2)];
const periodo = ref(PERIODOS[0]);
const informe = ref(null);
const soloLosMios = ref(true);
const guardando = ref(false);
const vacio = (v) => v === null || v === undefined || v === '';

async function cargarInforme() {
  if (!ubicacion.value) return;
  informe.value = null;
  try {
    const f = await bodega.informe(ubicacion.value.id, periodo.value);
    for (const r of f.renglones) {
      r.entregado = r.capturado ? String(r.entregado) : '';
      r.noEntregado = r.capturado && r.noEntregado ? String(r.noEntregado) : '';
      r.saldoInformado = vacio(r.saldoInformado) ? '' : String(r.saldoInformado);
    }
    recuperarBorrador(f);
    informe.value = f;
  } catch (fallo) {
    error.value = fallo.message;
  }
}
watch([periodo, () => ubicacion.value?.id], () => { if (ver.value === 'informe') cargarInforme(); });

// El Excel de su territorio (todos sus lugares), como el que le daba la bodega.
const bajandoExcel = ref(false);
async function bajarExcel() {
  bajandoExcel.value = true;
  error.value = '';
  try {
    await bodega.bajarExcelConsumo(periodo.value);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    bajandoExcel.value = false;
  }
}
const subiendoExcel = ref(false);
async function subirExcel(evento) {
  const archivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!archivo) return;
  subiendoExcel.value = true;
  error.value = '';
  aviso.value = '';
  try {
    const r = await bodega.subirExcelConsumo(periodo.value, archivo);
    aviso.value = `Cargado: ${r.lugares.map((l) => `${l.nombre} (${l.renglones})`).join(', ')}`;
    await cargarInforme();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    subiendoExcel.value = false;
  }
}
watch(ver, (v) => {
  error.value = '';
  if (v === 'informe' && !informe.value) cargarInforme();
  if (v === 'pedido' && !lineas.value.length) llenar();
});

const buscarInsumo = ref('');
const visibles = computed(() => {
  const q = buscarInsumo.value.trim().toLowerCase();
  return (informe.value?.renglones ?? []).filter((r) => (!soloLosMios.value || r.maneja || entero(r.entregado) || q)
    && (!q || `${r.nombre} ${r.concentracion ?? ''}`.toLowerCase().includes(q)));
});
const lleno = (r) => r.entregado !== '' || r.noEntregado !== '' || r.saldoInformado !== '';
const llenos = computed(() => visibles.value.filter(lleno).length);
// En el celular se puede cerrar la página sin querer: lo escrito se guarda en
// el equipo hasta enviarlo.
const claveBorrador = computed(() => `camotan_informe_${ubicacion.value?.id}_${periodo.value}`);
function guardarBorrador() {
  if (!informe.value) return;
  const datos = Object.fromEntries(informe.value.renglones.filter(lleno)
    .map((r) => [r.insumoId, [r.entregado, r.noEntregado, r.saldoInformado]]));
  try { localStorage.setItem(claveBorrador.value, JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
}
function recuperarBorrador(f) {
  let datos = null;
  try { datos = JSON.parse(localStorage.getItem(claveBorrador.value)); } catch { /* nada guardado */ }
  if (!datos) return;
  for (const r of f.renglones) {
    const d = datos[r.insumoId];
    if (d) [r.entregado, r.noEntregado, r.saldoInformado] = d;
  }
}
watch(() => informe.value?.renglones, guardarBorrador, { deep: true });
const saldo = (r) => r.saldoAnterior + r.entradas - entero(r.entregado);
const difiere = (r) => !vacio(r.saldoInformado) && entero(r.saldoInformado) !== saldo(r);

async function guardarInforme() {
  error.value = '';
  guardando.value = true;
  try {
    const r = await bodega.guardarInforme(ubicacion.value.id, periodo.value, {
      renglones: informe.value.renglones
        .filter((x) => x.maneja || entero(x.entregado) || entero(x.noEntregado) || !vacio(x.saldoInformado))
        .map((x) => ({
          insumoId: x.insumoId,
          entregado: entero(x.entregado),
          noEntregado: entero(x.noEntregado),
          saldoInformado: vacio(x.saldoInformado) ? null : entero(x.saldoInformado),
        })),
    });
    aviso.value = r.diferencias
      ? `Informe de ${nombreMes(periodo.value)} enviado. ${r.diferencias} insumo(s) no cuadran: bodega los revisará con usted.`
      : `Informe de ${nombreMes(periodo.value)} enviado. Todo cuadra.`;
    try { localStorage.removeItem(claveBorrador.value); } catch { /* sin almacenamiento */ }
    await cargarInforme();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

/** Enter (o «siguiente» en el teclado del celular) pasa al producto siguiente. */
function bajar(e, i) {
  e.preventDefault();
  const sig = document.getElementById(`i-${i + 1}-e`);
  if (sig) {
    sig.focus();
    sig.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    e.target.blur();
  }
}

onMounted(async () => {
  try {
    const [s] = await Promise.all([bodega.sugerida(), cargarMias()]);
    sugerencia.value = s;
    if (ver.value === 'pedido' && !lineas.value.length) llenar();
    if (ver.value === 'informe') cargarInforme();
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <section class="servicio">
    <header class="cabeza">
      <div>
        <p class="b-antetitulo">Encargado de servicio</p>
        <h1 class="b-titulo">{{ ubicacion?.nombre ?? 'Mi centro' }}</h1>
      </div>
      <nav v-if="ver !== 'inicio'" class="b-acciones">
        <button type="button" class="b-btn secundario" @click="ir('inicio')"><Icono nombre="volver" :tamano="20" /> Inicio</button>
      </nav>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4" aria-live="polite">{{ aviso }}</p>

    <!-- ================= Inicio: las dos tareas en grande ================= -->
    <template v-if="ver === 'inicio'">
      <div class="tareas">
        <button type="button" class="tarea azul" @click="ir('pedido')">
          <span class="ic"><Icono nombre="trasladar" :tamano="46" /></span>
          <span class="txt"><b>Hacer requisición</b></span>
          <span v-if="pendientes" class="pend azul">{{ pendientes }} en bodega</span>
        </button>
        <button type="button" class="tarea marino" @click="ir('informe')">
          <span class="ic"><Icono nombre="hojaCalculo" :tamano="46" /></span>
          <span class="txt"><b>Informe del mes</b><small>{{ nombreMes(PERIODOS[0]) }}</small></span>
        </button>
      </div>

      <section class="b-panel mt-5">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Mis requisiciones</h2></header>
        <div class="b-panel-cuerpo">
          <ul v-if="mias.length" class="mias">
            <li v-for="r in mias.slice(0, 12)" :key="r.id" class="mia" :style="estiloTono(ESTADO[r.estado]?.tono ?? 'neutro')">
              <span class="min-w-0 flex-1">
                <b>{{ fecha(r.fechaSolicitud) }}<template v-if="r.numero"> · N.º {{ textoNumero(r) }}</template> · {{ r.renglones }} {{ r.renglones === 1 ? 'renglón' : 'renglones' }}</b>
                <small>{{ ESTADO[r.estado]?.texto ?? r.estado }}<template v-if="r.estado === 'anulada' && r.motivoAnulacion"> · {{ r.motivoAnulacion }}</template></small>
                <small v-if="['despachada', 'parcial', 'recibida'].includes(r.estado) && r.despachado < r.solicitado">Llegaron {{ miles(r.despachado) }} de {{ miles(r.solicitado) }}</small>
              </span>
              <button v-if="r.estado === 'solicitada'" type="button" class="b-btn chico secundario" :disabled="cancelando === r.id" @click="cancelar(r)">Cancelar</button>
              <RouterLink :to="`/imprimir/requisicion/${r.id}`" target="_blank" class="b-btn chico secundario"><Icono nombre="imprimir" :tamano="16" /> Imprimir</RouterLink>
            </li>
          </ul>
          <p v-else class="b-vacio">Sin requisiciones.</p>
        </div>
      </section>
    </template>

    <!-- ================= Requisición ya llena ================= -->
    <template v-else-if="ver === 'pedido'">
      <div class="rejilla mt-4">
        <AvisoBorrador v-if="borrador.recuperado.value && lineas.length" class="col-span-full" texto="Se recuperó la requisición que dejó a medias." @descartar="empezarDeNuevo" />
        <EditorPedido v-model="lineas" :errores="erroresRenglon" :catalogo="catalogo" :nuevo-renglon="nuevoRenglon" :columnas="COLUMNAS" />
        <aside class="tarjeta">
          <h2>Firmas</h2>
          <div><label for="sol" class="b-etiqueta">Solicita</label><input id="sol" v-model="cabecera.solicitante" class="b-campo" /></div>
          <div><label for="jefe" class="b-etiqueta">Visto bueno <span class="b-opcional">opcional</span></label><input id="jefe" v-model="cabecera.jefe" class="b-campo" placeholder="Coordinador o director" /></div>
          <div><label for="obs" class="b-etiqueta">Observaciones <span class="b-opcional">opcional</span></label><textarea id="obs" v-model="cabecera.observaciones" rows="2" class="b-campo" /></div>
          <button type="button" class="b-btn primario enviar" :disabled="enviando || !aEnviar.length || cabecera.solicitante.trim().length < 3 || !ubicacion" @click="enviar">
            <Icono nombre="trasladar" :tamano="22" /> {{ enviando ? 'Enviando…' : `Enviar a bodega (${aEnviar.length})` }}
          </button>
        </aside>
      </div>
    </template>

    <!-- ================= Informe del mes ================= -->
    <template v-else-if="ver === 'informe'">
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div class="b-segmentado" role="radiogroup" aria-label="Mes">
          <button v-for="p in PERIODOS" :key="p" type="button" role="radio" :aria-checked="periodo === p" :class="periodo === p ? 'on' : ''" @click="periodo = p">{{ nombreMes(p) }}</button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="b-btn secundario chico" :disabled="bajandoExcel" @click="bajarExcel"><Icono nombre="descargar" :tamano="16" /> {{ bajandoExcel ? 'Preparando…' : 'Bajar Excel' }}</button>
          <label class="b-btn secundario chico cursor-pointer" :class="{ 'opacity-60': subiendoExcel }">
            <Icono nombre="recibir" :tamano="16" /> {{ subiendoExcel ? 'Cargando…' : 'Subir Excel' }}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="sr-only" :disabled="subiendoExcel" @change="subirExcel" />
          </label>
          <label class="flex items-center gap-2 text-sm font-semibold"><input v-model="soloLosMios" type="checkbox" /> Solo lo que manejo</label>
        </div>
      </div>
      <p v-if="informe?.informe" class="mt-2 text-sm font-semibold text-apagado">
        Enviado el {{ new Date(informe.informe.capturadoEn).toLocaleDateString('es-GT') }}<template v-if="informe.informe.revisado"> · revisado por bodega</template>
      </p>

      <form v-if="informe" class="mt-3" @submit.prevent="guardarInforme">
        <label class="buscar-insumo">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscarInsumo" type="search" placeholder="Buscar producto" aria-label="Buscar producto" />
        </label>
        <p class="avance">{{ llenos }} de {{ visibles.length }} productos llenos</p>

        <ul class="productos">
          <li v-for="(r, i) in visibles" :key="r.insumoId" class="producto" :class="{ lleno: lleno(r) }">
            <b class="prod-nombre">{{ [r.nombre, r.concentracion].filter(Boolean).join(' ') }}</b>
            <p class="prod-datos">
              Tenía <b>{{ miles(r.saldoAnterior) }}</b> · Le llegó <b>{{ miles(r.entradas) }}</b> · Le queda
              <b :class="saldo(r) < 0 ? 'text-[#C03535]' : ''">{{ miles(saldo(r)) }}</b> {{ r.unidadEntrega }}
            </p>
            <div class="prod-campos">
              <label class="campo-grande">
                <span>Entregó en el mes</span>
                <input :id="`i-${i}-e`" v-model="r.entregado" type="text" inputmode="numeric" enterkeyhint="next" placeholder="0" @keydown.enter="bajar($event, i)" />
              </label>
              <label class="campo-chico">
                <span>Pidieron y no tenía</span>
                <input v-model="r.noEntregado" type="text" inputmode="numeric" placeholder="0" />
              </label>
              <label class="campo-chico">
                <span>Contó en el estante</span>
                <input v-model="r.saldoInformado" type="text" inputmode="numeric" :placeholder="String(Math.max(0, saldo(r)))" :class="{ difiere: difiere(r) }" />
              </label>
            </div>
            <p v-if="difiere(r)" class="prod-aviso">Contado {{ miles(entero(r.saldoInformado)) }} · según el sistema {{ miles(saldo(r)) }}</p>
          </li>
          <li v-if="!visibles.length" class="b-vacio">{{ buscarInsumo ? 'Ningún producto con ese nombre.' : 'Bodega aún no le ha despachado nada. Quite «Solo lo que manejo» para informar cualquier producto.' }}</li>
        </ul>

        <div class="barra-enviar">
          <button type="submit" class="b-btn primario" :disabled="guardando"><Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Enviando…' : `Enviar informe de ${nombreMes(periodo).split(' ')[0]}` }}</button>
        </div>
      </form>
      <p v-else-if="!error" class="b-vacio mt-4">Cargando el informe…</p>
    </template>
  </section>
</template>

<style scoped>
.cabeza { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; }
.tareas { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 22px; }
@media (max-width: 900px) { .tareas { grid-template-columns: 1fr; } }
.tarea {
  position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 16px; min-height: 240px; padding: 24px 26px; text-align: left;
  border: 2px solid #E2E8F0; border-bottom-width: 6px; border-radius: 24px; background: #fff; color: #14244A; transition: transform .08s, border-color .12s;
}
.tarea:hover { border-color: var(--c); }
.tarea:active { transform: translateY(3px); border-bottom-width: 3px; }
.tarea .ic { display: grid; place-items: center; width: 84px; height: 84px; border-radius: 24px; background: var(--c); color: #fff; box-shadow: inset 0 -5px 0 rgba(0, 0, 0, .22); }
.tarea .txt { display: grid; gap: 6px; }
.tarea b { font-size: 30px; font-weight: 900; line-height: 1.1; }
.tarea small { font-size: 17px; font-weight: 700; color: #64748B; }
.tarea.azul { --c: #2F83C4; } .tarea.marino { --c: #172A5A; }
.pend { position: absolute; top: 16px; right: 18px; padding: 4px 12px; border-radius: 10px; font-size: 14px; font-weight: 900; color: #fff; background: #2F83C4; }
.mias { display: grid; gap: 8px; }
.mia { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--t-fondo); color: var(--t-tinta); }
.mia b { display: block; font-size: 15px; font-weight: 900; color: #14244A; }
.mia small { display: block; font-size: 13px; font-weight: 700; }
.explica { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-radius: 18px; background: #EAF3FB; color: #174E80; font-size: 15px; font-weight: 600; }
.explica b { font-weight: 900; }
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
@media (max-width: 1050px) { .rejilla { grid-template-columns: 1fr; } }
.lista, .tarjeta { display: grid; gap: 12px; padding: 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.lista-cabeza { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lista h2, .tarjeta h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.lista h2 span { margin-left: 6px; padding: 1px 9px; border-radius: 9px; background: #172A5A; color: #fff; font-size: 14px; }
.lista ul { display: grid; gap: 8px; }
.linea { display: grid; grid-template-columns: minmax(0, 1fr) 130px 36px; align-items: center; gap: 12px; padding: 12px 14px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px; }
.nombre { display: block; font-size: 17px; font-weight: 900; color: #14244A; overflow-wrap: anywhere; }
.datos { margin-top: 2px; font-size: 14px; font-weight: 600; color: #475569; }
.datos b { font-weight: 900; color: #14244A; }
.cantidad { display: grid; gap: 2px; }
.cantidad label { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; color: #64748B; }
.cantidad input { height: 52px; font-size: 20px; font-weight: 900; text-align: right; }
.cantidad small { font-size: 12px; font-weight: 700; color: #64748B; text-align: right; }
.quitar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: #94A3B8; }
.quitar:hover { background: #FDECEC; color: #A83232; }
.agregar { display: grid; gap: 6px; padding-top: 6px; border-top: 2px dashed #E2E8F0; }
.enviar { width: 100%; height: 60px; font-size: 17px; border-radius: 16px; }
.nota { font-size: 13px; font-weight: 600; color: #64748B; }
.buscar-insumo { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 14px; border: 2px solid #CBD5E1; border-radius: 14px; background: #fff; color: #64748B; }
.buscar-insumo input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; font-size: 17px; color: #14244A; background: transparent; }
.avance { margin: 8px 2px 10px; font-size: 13px; font-weight: 700; color: #64748B; }
.productos { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.producto { display: grid; gap: 8px; padding: 14px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 18px; background: #fff; }
.producto.lleno { border-color: #9BD3B5; background: #F6FCF8; }
.prod-nombre { font-size: 17px; font-weight: 900; line-height: 1.25; color: #14244A; overflow-wrap: anywhere; }
.prod-datos { font-size: 14px; font-weight: 600; color: #475569; }
.prod-datos b { font-weight: 900; color: #14244A; }
.prod-campos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.prod-campos label { display: grid; gap: 4px; }
.prod-campos span { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; color: #64748B; }
.prod-campos input { width: 100%; border: 2px solid #CBD5E1; border-radius: 12px; background: #fff; text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; color: #14244A; }
.prod-campos input:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.prod-campos input.difiere { border-color: #E8930C; background: #FFF7E6; }
.campo-grande { grid-column: 1 / -1; }
.campo-grande input { height: 58px; font-size: 26px; }
.campo-chico input { height: 46px; font-size: 18px; }
.prod-aviso { font-size: 13px; font-weight: 700; color: #8A4B00; }
.barra-enviar { position: sticky; bottom: 0; margin-top: 12px; padding: 12px 0; background: linear-gradient(transparent, #fff 30%); }
.barra-enviar .b-btn { width: 100%; height: 58px; font-size: 18px; border-radius: 16px; }
/* Celular: una columna, botones y campos al ancho de la pantalla. */
@media (max-width: 640px) {
  .tarea { min-height: 140px; padding: 18px; }
  .tarea .ic { width: 62px; height: 62px; }
  .tarea b { font-size: 24px; }
  .productos { grid-template-columns: 1fr; }
  .linea { grid-template-columns: minmax(0, 1fr) 36px; }
  .linea .cantidad { grid-column: 1 / -1; }
  .mia { flex-wrap: wrap; }
  .mia > span { flex-basis: 100%; }
  .b-segmentado { overflow-x: auto; max-width: 100%; }
}
.captura { max-height: max(380px, calc(100vh - 380px)); }
.captura th { white-space: normal; line-height: 1.25; vertical-align: bottom; }
.cap { background: #FAFBFF; }
th.cap { background: #E8EEFA !important; color: #172A5A !important; }
.celda { width: 90px; height: 40px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 10px; background: #fff; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.celda:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.celda.difiere { border-color: #E8930C; background: #FFF7E6; }
.barra-guardar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding: 12px 0; background: #fff; border-top: 2px solid #E2E8F0; }
</style>
