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
import VentanaConfirmar from '../../components/comunes/VentanaConfirmar.vue';
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
// Para quién se pide: su lugar (null), otro lugar de su territorio o todo el
// territorio junto (bodega le entrega a él y él reparte).
const para = ref(null);
const territorio = ref(null);
const sugerenciaPara = ref(null);
const sugPedido = computed(() => (para.value && sugerenciaPara.value?.ubicacion?.id === para.value ? sugerenciaPara.value : sugerencia.value));
const opcionesPara = computed(() => {
  const t = territorio.value;
  if (!t) return [];
  return [
    ...(t.destinoId ? [{ id: t.destinoId, nombre: 'Todo el territorio' }] : []),
    ...t.ubicaciones,
  ];
});
const borrador = usarBorrador('requisicion-servicio', { lineas, cabecera, para }, { vacio: (d) => !d.lineas.length });
borrador.recuperar();
function empezarDeNuevo() { borrador.limpiar(); llenar(); }
async function elegirPara(id) {
  error.value = '';
  try {
    const propio = id === sugerencia.value?.ubicacion?.id;
    sugerenciaPara.value = propio ? null : await bodega.sugerida(id);
    para.value = propio ? null : id;
    llenar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

// Columnas de cada renglón: lo que tiene el puesto y lo que entrega al mes.
const COLUMNAS = ['Tiene', 'Entrega / mes'];
const conDetalle = (r) => ({ ...r, datos: [miles(r.tiene), miles(r.demandaMensual)] });
function llenar() {
  lineas.value = (sugPedido.value?.renglones ?? [])
    .filter((r) => r.sugerido > 0)
    .map((r) => ({ ...conDetalle(r), cantidad: String(r.sugerido) }));
}
const catalogo = computed(() => (sugPedido.value?.catalogo ?? []).map((c) => ({ id: c.insumoId, nombreGenerico: c.nombre, codigoInterno: '' })));
/** Renglón nuevo para el editor: con lo que tiene y lo que entrega, si se sabe. */
function nuevoRenglon(i) {
  const base = sugPedido.value.renglones.find((r) => r.insumoId === i.id)
    ?? { ...sugPedido.value.catalogo.find((c) => c.insumoId === i.id), demandaMensual: 0, tiene: 0, sugerido: 0 };
  return { ...conDetalle(base), cantidad: '' };
}
const erroresRenglon = ref({});
const aEnviar = computed(() => lineas.value.filter((l) => entero(l.cantidad) > 0));
// Antes de mandar, el resumen: un clic de más no envía nada.
const confirmando = ref(null);
const resumenPedido = computed(() => aEnviar.value.map((l) => ({ nombre: l.nombre, cantidad: entero(l.cantidad), unidad: l.unidad })));

async function enviar() {
  confirmando.value = null;
  erroresRenglon.value = {};
  error.value = '';
  enviando.value = true;
  try {
    const r = await bodega.crearRequisicion({
      ubicacionId: sugPedido.value.ubicacion.id,
      fechaSolicitud: hoy(),
      solicitante: cabecera.solicitante.trim(),
      jefe: cabecera.jefe.trim() || null,
      observaciones: cabecera.observaciones.trim() || null,
      renglones: aEnviar.value.map(renglonPedido),
    }, nuevaClaveIdempotencia());
    // Bodega la imprime en el formulario al despacharla. El encargado se lleva
    // una copia en hoja normal para pasarla a mano al formulario.
    aviso.value = `Requisición enviada: ${aEnviar.value.length} ${aEnviar.value.length === 1 ? 'producto' : 'productos'}.`;
    window.open(`/imprimir/pedido/${r.requisicion.id}`, '_blank');
    lineas.value = [];
    para.value = null;
    sugerenciaPara.value = null;
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

// --- Informe del mes de cada lugar -------------------------------------------------------
// Las mismas columnas del Excel del balance: el encargado solo llena lo
// entregado a usuarios y lo no entregado; lo demás ya viene.
// En orden, del más viejo al actual; se abre en el mes en curso.
const PERIODOS = [periodoMenos(2), periodoMenos(1), periodoMenos(0)];
const periodo = ref(PERIODOS[2]);
const informe = ref(null);
const soloLosMios = ref(true);
const guardando = ref(false);
// De qué lugar se informa: cada lugar de su territorio tiene su informe.
const lugarInforme = ref(null);
const lugaresInforme = computed(() => (territorio.value?.ubicaciones?.length ? territorio.value.ubicaciones : ubicacion.value ? [ubicacion.value] : []));
const lugarActual = computed(() => lugaresInforme.value.find((l) => l.id === lugarInforme.value) ?? ubicacion.value);

async function cargarInforme() {
  const id = lugarActual.value?.id;
  if (!id) return;
  informe.value = null;
  try {
    const f = await bodega.informe(id, periodo.value);
    for (const r of f.renglones) {
      r.entradas = r.entradas ? String(r.entradas) : '';
      r.entregado = r.capturado ? String(r.entregado) : '';
      r.noEntregado = r.capturado && r.noEntregado ? String(r.noEntregado) : '';
    }
    // Ya enviado no se cambia: se ve como quedó.
    if (!f.informe?.enviadoEn) recuperarBorrador(f);
    informe.value = f;
  } catch (fallo) {
    error.value = fallo.message;
  }
}
watch([periodo, () => lugarActual.value?.id], () => { if (ver.value === 'informe') cargarInforme(); });

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
    const sinRepartir = r.sinRepartir?.length ? ` Sin repartir de lo entregado al territorio: ${r.sinRepartir.map((x) => `${x.nombre} (${x.entregado - x.repartido})`).join(', ')}.` : '';
    const yaEnviados = r.yaEnviados?.length ? ` Ya enviados, no se cambiaron: ${r.yaEnviados.join(', ')}.` : '';
    aviso.value = `Cargado: ${r.lugares.map((l) => `${l.nombre} (${l.renglones})`).join(', ')}.${sinRepartir}${yaEnviados}`;
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
const lleno = (r) => r.entregado !== '' || r.noEntregado !== '';
// Fila con título de sección encima, como en el Excel del balance.
const conTitulo = (i) => i === 0 || visibles.value[i - 1].seccion !== visibles.value[i].seccion;
const llenos = computed(() => visibles.value.filter(lleno).length);
// En el celular se puede cerrar la página sin querer: lo escrito se guarda en
// el equipo hasta enviarlo.
const claveBorrador = computed(() => `camotan_informe_${lugarActual.value?.id}_${periodo.value}`);
function guardarBorrador() {
  if (!informe.value) return;
  const datos = Object.fromEntries(informe.value.renglones.filter(lleno)
    .map((r) => [r.insumoId, [r.entregado, r.noEntregado, r.entradas]]));
  try { localStorage.setItem(claveBorrador.value, JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
}
function recuperarBorrador(f) {
  let datos = null;
  try { datos = JSON.parse(localStorage.getItem(claveBorrador.value)); } catch { /* nada guardado */ }
  if (!datos) return;
  for (const r of f.renglones) {
    const d = datos[r.insumoId];
    if (d) [r.entregado, r.noEntregado, r.entradas = r.entradas] = d;
  }
}
watch(() => informe.value?.renglones, guardarBorrador, { deep: true });
const saldo = (r) => r.saldoAnterior + entero(r.entradas) - entero(r.entregado);
// Como el BRES: este mes y los dos anteriores (entregado + no entregado).
const promedio = (r) => Math.round(((r.demandaAnterior ?? 0) + entero(r.entregado) + entero(r.noEntregado)) / ((r.mesesAnteriores ?? 0) + 1));
// No se envía con saldos negativos: entregó más de lo que tenía.
const negativos = computed(() => (informe.value?.renglones ?? []).filter((r) => saldo(r) < 0));
function pedirEnvio() {
  if (enviado.value) return;
  if (negativos.value.length) {
    error.value = `Queda en negativo (entregó más de lo que tenía): ${negativos.value.map((r) => r.nombre).join(', ')}. Revise las entradas o lo entregado.`;
    document.querySelector('.tabla-informe td.negativo')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  error.value = '';
  confirmando.value = 'informe';
}

// Enviado una vez, el encargado ya no lo cambia: lo corrige bodega (responde por el BRES).
const enviado = computed(() => Boolean(informe.value?.informe?.enviadoEn));
const resumenInforme = computed(() => (informe.value?.renglones ?? [])
  .filter((x) => entero(x.entregado) || entero(x.noEntregado))
  .map((x) => ({ nombre: [x.nombre, x.concentracion].filter(Boolean).join(' '), cantidad: entero(x.entregado), unidad: x.unidadEntrega })));
/** enviar false: se guarda a medias (por ejemplo, las entradas al recibir) y se completa a fin de mes. */
async function guardarInforme(enviar = true) {
  confirmando.value = null;
  error.value = '';
  aviso.value = '';
  guardando.value = true;
  try {
    await bodega.guardarInforme(lugarActual.value.id, periodo.value, {
      enviar,
      renglones: informe.value.renglones
        .filter((x) => x.maneja || entero(x.entradas) || entero(x.entregado) || entero(x.noEntregado))
        .map((x) => ({ insumoId: x.insumoId, entradas: entero(x.entradas), entregado: entero(x.entregado), noEntregado: entero(x.noEntregado) })),
    });
    aviso.value = enviar
      ? `Informe enviado: ${lugarActual.value.nombre}, ${nombreMes(periodo.value)}.`
      : `Guardado sin enviar: ${lugarActual.value.nombre}, ${nombreMes(periodo.value)}.`;
    try { localStorage.removeItem(claveBorrador.value); } catch { /* sin almacenamiento */ }
    await cargarInforme();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    const [s, t] = await Promise.all([bodega.sugerida(), bodega.territorios().catch(() => ({ territorios: [] })), cargarMias()]);
    sugerencia.value = s;
    territorio.value = t.territorios[0] ?? null;
    // Lo que se dejó a medias para otro lugar sigue con ese lugar.
    if (para.value) sugerenciaPara.value = await bodega.sugerida(para.value);
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
          <span class="txt"><b>Informe del mes</b><small>{{ nombreMes(PERIODOS[2]) }}</small></span>
        </button>
      </div>

      <section class="b-panel mt-5">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Mis requisiciones</h2></header>
        <div class="b-panel-cuerpo">
          <ul v-if="mias.length" class="mias">
            <li v-for="r in mias.slice(0, 12)" :key="r.id" class="mia" :style="estiloTono(ESTADO[r.estado]?.tono ?? 'neutro')">
              <span class="min-w-0 flex-1">
                <b><template v-if="r.unidadSeccion !== ubicacion?.nombre">{{ r.unidadSeccion }} · </template>{{ fecha(r.fechaSolicitud) }}<template v-if="r.numero"> · N.º {{ textoNumero(r) }}</template> · {{ r.renglones }} {{ r.renglones === 1 ? 'renglón' : 'renglones' }}</b>
                <small>{{ ESTADO[r.estado]?.texto ?? r.estado }}<template v-if="r.estado === 'anulada' && r.motivoAnulacion"> · {{ r.motivoAnulacion }}</template></small>
                <small v-if="['despachada', 'parcial', 'recibida'].includes(r.estado) && r.despachado < r.solicitado">Llegaron {{ miles(r.despachado) }} de {{ miles(r.solicitado) }}</small>
              </span>
              <button v-if="r.estado === 'solicitada'" type="button" class="b-btn chico secundario" :disabled="cancelando === r.id" @click="cancelar(r)">Cancelar</button>
              <RouterLink :to="`/imprimir/pedido/${r.id}`" target="_blank" class="b-btn chico secundario"><Icono nombre="imprimir" :tamano="16" /> Imprimir</RouterLink>
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
        <div v-if="opcionesPara.length > 1" class="col-span-full flex flex-wrap items-center gap-3">
          <span class="b-etiqueta m-0">Pedir para</span>
          <div class="b-segmentado flex-wrap" role="radiogroup" aria-label="Pedir para">
            <button
              v-for="o in opcionesPara" :key="o.id" type="button" role="radio"
              :aria-checked="sugPedido?.ubicacion?.id === o.id" :class="sugPedido?.ubicacion?.id === o.id ? 'on' : ''"
              @click="elegirPara(o.id)"
            >{{ o.nombre }}</button>
          </div>
        </div>
        <EditorPedido v-model="lineas" :errores="erroresRenglon" :catalogo="catalogo" :nuevo-renglon="nuevoRenglon" :columnas="COLUMNAS" />
        <aside class="tarjeta">
          <h2>Firmas</h2>
          <div><label for="sol" class="b-etiqueta">Solicita</label><input id="sol" v-model="cabecera.solicitante" class="b-campo" /></div>
          <div><label for="jefe" class="b-etiqueta">Visto bueno <span class="b-opcional">opcional</span></label><input id="jefe" v-model="cabecera.jefe" class="b-campo" placeholder="Coordinador o director" /></div>
          <div><label for="obs" class="b-etiqueta">Observaciones <span class="b-opcional">opcional</span></label><textarea id="obs" v-model="cabecera.observaciones" rows="2" class="b-campo" /></div>
          <button type="button" class="b-btn primario enviar" :disabled="enviando || !aEnviar.length || cabecera.solicitante.trim().length < 3 || !ubicacion" @click="confirmando = 'pedido'">
            <Icono nombre="trasladar" :tamano="22" /> {{ enviando ? 'Enviando…' : `Enviar a bodega (${aEnviar.length})` }}
          </button>
        </aside>
      </div>
    </template>

    <!-- ================= Informe del mes ================= -->
    <template v-else-if="ver === 'informe'">
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3">
        <span class="b-etiqueta m-0 w-12">Mes</span>
        <div class="b-segmentado" role="radiogroup" aria-label="Mes">
          <button v-for="p in PERIODOS" :key="p" type="button" role="radio" :aria-checked="periodo === p" :class="periodo === p ? 'on' : ''" @click="periodo = p">{{ nombreMes(p) }}</button>
        </div>
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
      <!-- De qué lugar es el informe -->
      <div v-if="lugaresInforme.length > 1" class="mt-4 flex flex-wrap items-center gap-3">
        <span class="b-etiqueta m-0 w-12">Lugar</span>
        <div class="b-segmentado flex-wrap" role="radiogroup" aria-label="Lugar del informe">
          <button
            v-for="l in lugaresInforme" :key="l.id" type="button" role="radio"
            :aria-checked="lugarActual?.id === l.id" :class="lugarActual?.id === l.id ? 'on' : ''"
            @click="lugarInforme = l.id"
          >{{ l.nombre }}</button>
        </div>
      </div>
      <h2 class="titulo-informe">{{ lugarActual?.nombre }} · {{ nombreMes(periodo) }}</h2>

      <p v-if="informe?.informe && !enviado" class="b-aviso atencion mt-2 text-[15px]">
        <Icono nombre="guardar" :tamano="20" />
        <span>Guardado el {{ new Date(informe.informe.capturadoEn).toLocaleDateString('es-GT') }}, sin enviar. Puede seguir llenándolo.</span>
      </p>
      <p v-if="enviado" class="b-aviso ok mt-2 text-[15px]">
        <Icono nombre="correcto" :tamano="20" />
        <span>Enviado el {{ new Date(informe.informe.capturadoEn).toLocaleDateString('es-GT') }}<template v-if="informe.informe.revisado"> · revisado por bodega</template>. Para corregir algo, avise a bodega.</span>
      </p>

      <form v-if="informe" class="mt-3" @submit.prevent="pedirEnvio">
        <label class="buscar-insumo">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscarInsumo" type="search" placeholder="Buscar producto" aria-label="Buscar producto" />
        </label>
        <p class="avance">{{ llenos }} de {{ visibles.length }} productos llenos</p>

        <div class="marco-informe">
          <table class="tabla-informe">
            <thead>
              <tr>
                <th class="prod">Producto</th>
                <th>Saldo anterior</th>
                <th class="llena">Entradas</th>
                <th class="llena">Entregado a usuarios</th>
                <th class="llena">No entregado</th>
                <th>Saldo siguiente</th>
                <th>Promedio</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(r, i) in visibles" :key="r.insumoId">
              <tr v-if="conTitulo(i)" class="seccion"><td colspan="7">{{ r.seccion }}</td></tr>
              <tr :class="{ lleno: lleno(r), 'fila-negativa': saldo(r) < 0 }">
                <td class="prod">{{ [r.nombre, r.concentracion].filter(Boolean).join(' ') }} <small>{{ r.unidadEntrega }}</small></td>
                <td class="n">{{ miles(r.saldoAnterior) }}</td>
                <td class="celda"><input v-model="r.entradas" :readonly="enviado" type="text" inputmode="numeric" placeholder="0" :aria-label="`Entradas de ${r.nombre}`" /></td>
                <td class="celda"><input :id="`i-${i}-e`" v-model="r.entregado" :readonly="enviado" type="text" inputmode="numeric" enterkeyhint="next" placeholder="0" :aria-label="`Entregado a usuarios de ${r.nombre}`" @keydown.enter="bajar($event, i)" /></td>
                <td class="celda"><input v-model="r.noEntregado" :readonly="enviado" type="text" inputmode="numeric" placeholder="0" :aria-label="`No entregado de ${r.nombre}`" /></td>
                <td class="n saldo" :class="{ negativo: saldo(r) < 0 }">{{ miles(saldo(r)) }}</td>
                <td class="n">{{ miles(promedio(r)) }}</td>
              </tr>
              </template>
              <tr v-if="!visibles.length"><td colspan="7" class="b-vacio">{{ buscarInsumo ? 'Ningún producto con ese nombre.' : 'Este lugar no ha manejado productos. Quite «Solo lo que manejo» para informar cualquiera.' }}</td></tr>
            </tbody>
          </table>
        </div>

        <p v-if="!enviado && negativos.length" class="b-aviso error mt-3">{{ negativos.length }} {{ negativos.length === 1 ? 'producto queda' : 'productos quedan' }} en negativo: revise las entradas o lo entregado (en rojo).</p>
        <div v-if="!enviado" class="barra-enviar">
          <button type="button" class="b-btn secundario guardar" :disabled="guardando" @click="guardarInforme(false)"><Icono nombre="guardar" :tamano="20" /> Guardar sin enviar</button>
          <button type="submit" class="b-btn primario" :disabled="guardando"><Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Enviando…' : `Enviar informe de ${lugarActual?.nombre}` }}</button>
        </div>
      </form>
      <p v-else-if="!error" class="b-vacio mt-4">Cargando el informe…</p>
    </template>

    <VentanaConfirmar
      v-if="confirmando === 'informe'"
      :titulo="`Informe de ${lugarActual?.nombre}`"
      :detalle="`${nombreMes(periodo)} · entregado a usuarios en ${resumenInforme.length} productos. Ya enviado no se puede cambiar.`"
      :filas="resumenInforme"
      confirmar="Enviar informe"
      icono="guardar"
      :ocupado="guardando"
      @cerrar="confirmando = null"
      @confirmar="guardarInforme(true)"
    />
    <VentanaConfirmar
      v-if="confirmando === 'pedido'"
      titulo="Requisición a bodega"
      :detalle="`Para ${sugPedido?.ubicacion?.nombre === ubicacion?.nombre ? ubicacion?.nombre : sugPedido?.ubicacion?.tipo === 'territorio' ? 'todo el territorio' : sugPedido?.ubicacion?.nombre} · ${resumenPedido.length} productos · solicita ${cabecera.solicitante}`"
      :filas="resumenPedido"
      confirmar="Enviar e imprimir"
      icono="trasladar"
      :ocupado="enviando"
      @cerrar="confirmando = null"
      @confirmar="enviar"
    />
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
.titulo-informe { margin-top: 14px; font-size: 22px; font-weight: 900; color: #14244A; }
.marco-informe { overflow-x: auto; border: 2px solid #E2E8F0; border-radius: 16px; background: #fff; }
.tabla-informe { width: 100%; min-width: 860px; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.tabla-informe th { position: sticky; top: 0; z-index: 1; padding: 10px 8px; background: #F1F5F9; font-size: 12.5px; font-weight: 900; text-transform: uppercase; letter-spacing: .03em; color: #475569; text-align: right; }
.tabla-informe th.prod, .tabla-informe td.prod { text-align: left; }
.tabla-informe th.llena { color: #14244A; background: #E3ECF8; }
.tabla-informe td { padding: 6px 8px; border-top: 1px solid #EEF2F6; font-size: 15px; font-weight: 700; color: #1E293B; }
.tabla-informe td.prod { min-width: 240px; font-weight: 800; color: #14244A; }
.tabla-informe td.prod small { margin-left: 4px; font-size: 12px; font-weight: 700; color: #64748B; }
.tabla-informe td.n { text-align: right; white-space: nowrap; }
.tabla-informe td.saldo { color: #14244A; background: #F5F9FE; }
.tabla-informe td.negativo { color: #C03535; font-weight: 900; }
.tabla-informe tr.fila-negativa td { background: #FDF0F0; }
.tabla-informe tr.fila-negativa td.prod { box-shadow: inset 4px 0 0 #C03535; }
.tabla-informe tr.lleno td.prod { box-shadow: inset 4px 0 0 #2E9E6A; }
.tabla-informe tr.seccion td { padding: 8px 10px; background: #EEE9F4; font-size: 13px; font-weight: 900; letter-spacing: .04em; color: #3B2A5A; }
.tabla-informe td.celda { width: 130px; background: #FAFCFF; }
.tabla-informe td.celda input { width: 100%; height: 42px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 10px; background: #fff; text-align: right; font-size: 17px; font-weight: 800; color: #14244A; }
.tabla-informe td.celda input:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.tabla-informe td.celda input[readonly] { border-color: #E2E8F0; background: #F8FAFC; color: #475569; }
.barra-enviar { position: sticky; bottom: 0; margin-top: 12px; padding: 12px 0; background: linear-gradient(transparent, #fff 30%); }
.barra-enviar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 10px; }
.barra-enviar .b-btn { width: 100%; height: 58px; font-size: 18px; border-radius: 16px; }
@media (max-width: 640px) { .barra-enviar { grid-template-columns: 1fr; } }
/* Celular: una columna, botones y campos al ancho de la pantalla. */
@media (max-width: 640px) {
  .tarea { min-height: 140px; padding: 18px; }
  .tarea .ic { width: 62px; height: 62px; }
  .tarea b { font-size: 24px; }
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
