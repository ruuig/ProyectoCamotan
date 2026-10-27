<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion } from '../../dominio/impresionBodega';
import { CARACTERES_POR_RENGLON, numerosDeHojas } from '../../dominio/hojasRequisicion';

/**
 * Requisición Despacho de Almacén (FOR-ASB-01) impresa sobre el formulario.
 *
 * Como el BRES: sin líneas ni títulos, solo los datos en su lugar. Las medidas
 * se tomaron con regla sobre el formulario impreso, en milímetros desde la
 * esquina superior izquierda de la hoja (21 cm de ancho). La descripción larga
 * se parte en las líneas siguientes; el número de orden, la unidad y la
 * cantidad van en la primera.
 */
const route = useRoute();

const r = ref(null);
const est = ref(null);
const error = ref('');

// --- Medidas del formulario (mm) -----------------------------------------------
// Bordes de las columnas: número de orden, descripción, unidad de medida y
// cantidades solicitada, autorizada y despachada.
const BORDES = [9.9, 26.4, 125.2, 143.9, 162.7, 183.0, 200.2];
const COLUMNA = { orden: 0, descripcion: 1, unidad: 2, solicitada: 3, autorizada: 4, despachada: 5 };
const PRIMERA = 72.7; // borde superior del primer renglón
const ALTO = 6.43; // alto de cada renglón
const RENGLONES = 25;
// El número impreso de cada hoja (0156, 0157…): no se imprime, ya viene en el papel.
const numerosHoja = computed(() => numerosDeHojas(r.value?.numero, hojas.value.length));
// Líneas del encabezado y del pie donde se escribe encima.
const LINEA = { direccion: 41.0, departamento: 49.1, unidad: 57.0, observaciones: 241.2, solicitante: 265.9 };
const FECHA = { arriba: 248.9, abajo: 254.3, dia: [41.8, 52.5], mes: [52.5, 63.4], anio: [63.4, 75.7] };

const caja = (x1, x2, y1, y2) => ({ left: `${x1}mm`, width: `${x2 - x1}mm`, top: `${y1}mm`, height: `${y2 - y1}mm` });
/** Texto sobre una línea del formulario: la caja termina en la línea. */
const sobreLinea = (x1, x2, linea) => caja(x1, x2, linea - 6, linea - 0.4);
const renglon = (n, col) => caja(BORDES[COLUMNA[col]], BORDES[COLUMNA[col] + 1], PRIMERA + (n - 1) * ALTO, PRIMERA + n * ALTO);

// --- Preferencias de este equipo -------------------------------------------------
const CLAVE_AJUSTE = 'camotan_requisicion_ajuste';
const CLAVE_CANTIDADES = 'camotan_requisicion_cantidades';
function leer(clave, defecto) {
  try { return JSON.parse(localStorage.getItem(clave)) ?? defecto; } catch { return defecto; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
}
const ajuste = ref(leer(CLAVE_AJUSTE, { x: 0, y: 0 }));
const conCantidades = ref(leer(CLAVE_CANTIDADES, false));
const guias = ref(true);
function mover(eje, mm) { ajuste.value = { ...ajuste.value, [eje]: ajuste.value[eje] + mm }; guardar(CLAVE_AJUSTE, ajuste.value); }
function cambiarCantidades() { guardar(CLAVE_CANTIDADES, conCantidades.value); }
const imprimir = () => window.print();

// --- Partir la descripción --------------------------------------------------------
// La misma regla que usa el servidor para saber cuántas hojas ocupa y qué número
// le toca a cada una (dominio/hojasRequisicion.js).
function partir(texto) {
  const lineas = [];
  let actual = '';
  for (const palabra of String(texto ?? '').split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (prueba.length <= CARACTERES_POR_RENGLON || !actual) actual = prueba;
    else { lineas.push(actual); actual = palabra; }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}

/** Hojas de 25 líneas; un artículo no se parte entre dos hojas. */
const hojas = computed(() => {
  const salida = [[]];
  for (const g of r.value?.renglones ?? []) {
    const lineas = partir(g.descripcion).map((texto, i) => ({
      texto,
      orden: i === 0 ? g.orden : null,
      unidad: i === 0 ? g.unidadMedida : '',
      solicitada: i === 0 ? g.cantidadSolicitada : null,
      autorizada: i === 0 ? g.cantidadAutorizada : null,
      despachada: i === 0 ? g.cantidadDespachada : null,
    }));
    if (salida[salida.length - 1].length + lineas.length > RENGLONES && salida[salida.length - 1].length) salida.push([]);
    salida[salida.length - 1].push(...lineas);
  }
  return salida;
});

const fecha = computed(() => {
  if (!r.value?.fechaSolicitud) return { d: '', m: '', a: '' };
  const [a, m, d] = r.value.fechaSolicitud.slice(0, 10).split('-');
  return { d, m, a };
});
const unidad = computed(() => r.value?.unidadSeccion ?? '');

/**
 * Lo que llegó a bodega con su documento, en el mismo formulario: la bodega es
 * la unidad que recibe, lo solicitado y autorizado es lo que dice el
 * documento, y lo despachado es lo que de verdad llegó.
 */
function desdeRecepcion(x) {
  return {
    id: x.id,
    numero: x.numeroDocumento ?? x.acta ?? null,
    unidadSeccion: 'Bodega',
    fechaSolicitud: x.fecha,
    solicitante: x.registradaPor,
    observaciones: x.observaciones ?? '',
    renglones: x.renglones.map((g, i) => ({
      orden: i + 1,
      descripcion: `${g.insumo} · Lote ${g.numeroLote}`,
      unidadMedida: g.unidad,
      cantidadSolicitada: g.cantidadDocumento,
      cantidadAutorizada: g.cantidadDocumento,
      cantidadDespachada: g.cantidadDocumento - (g.porReponer ?? 0),
    })),
  };
}

onMounted(async () => {
  try {
    est.value = await cargarEstablecimiento();
    r.value = route.name === 'imprimir-requisicion-recepcion'
      ? desdeRecepcion((await bodega.recepcion(route.params.id)).recepcion)
      : (await bodega.requisicion(route.params.id)).requisicion;
    registrarImpresion('requisicion', r.value.numero ?? `id ${r.value.id}`);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <p v-if="error" role="alert" class="no-imprimir p-6 text-red-700">{{ error }}</p>

  <div v-if="r" class="no-imprimir mx-auto flex max-w-[8.5in] flex-wrap items-center gap-2 p-4 text-sm">
    <span class="font-bold">Requisición {{ numerosHoja.length > 1 ? `${numerosHoja[0]} a ${numerosHoja[numerosHoja.length - 1]}` : r.numero ?? '(sin número)' }} · {{ hojas.length }} {{ hojas.length === 1 ? 'hoja' : 'hojas' }}</span>
    <span class="ml-3">Ajuste:</span>
    <button type="button" class="rounded border px-2 py-1" @click="mover('x', -1)">← 1 mm</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('x', 1)">1 mm →</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('y', -1)">↑ 1 mm</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('y', 1)">1 mm ↓</button>
    <span class="tabular-nums">({{ ajuste.x }}, {{ ajuste.y }}) mm</span>
    <label class="ml-3 flex items-center gap-1"><input v-model="conCantidades" type="checkbox" @change="cambiarCantidades" /> Imprimir autorizada y despachada</label>
    <label class="flex items-center gap-1"><input v-model="guias" type="checkbox" /> Ver casillas</label>
    <button type="button" class="ml-auto rounded bg-black px-3 py-1.5 font-bold text-white" @click="imprimir">Imprimir</button>
  </div>

  <!-- hoja-propia: lo único que sale en el papel (style-impresion.css oculta lo demás). -->
  <div class="hoja-propia">
    <template v-for="(lineas, h) in (r ? hojas : [])" :key="h">
    <p v-if="hojas.length > 1" class="no-imprimir mx-auto max-w-[8.5in] px-1 pb-1 text-sm font-bold text-slate-700">
      Hoja {{ h + 1 }} de {{ hojas.length }}<template v-if="numerosHoja[h]"> · use el formulario N.º {{ numerosHoja[h] }}</template>
    </p>
    <div class="pagina" :class="guias ? 'con-guias' : ''">
      <div class="forma" :style="{ transform: `translate(${ajuste.x}mm, ${ajuste.y}mm)` }">
        <div class="celda negrita t10" :style="sobreLinea(33, 93, LINEA.direccion)">{{ est?.municipio }}</div>
        <div class="celda negrita t10" :style="sobreLinea(33, 93, LINEA.departamento)">{{ est?.departamento }}</div>
        <div class="celda negrita t10" :style="sobreLinea(33, 93, LINEA.unidad)">{{ unidad }}</div>

        <template v-for="n in RENGLONES" :key="n">
          <div class="celda centro medio" :style="renglon(n, 'orden')">{{ lineas[n - 1]?.orden ?? '' }}</div>
          <div class="celda medio" :style="renglon(n, 'descripcion')">{{ lineas[n - 1]?.texto ?? '' }}</div>
          <div class="celda centro medio" :style="renglon(n, 'unidad')">{{ lineas[n - 1]?.unidad ?? '' }}</div>
          <div class="celda centro medio t10" :style="renglon(n, 'solicitada')">{{ lineas[n - 1]?.solicitada ?? '' }}</div>
          <template v-if="conCantidades">
            <div class="celda centro medio t10" :style="renglon(n, 'autorizada')">{{ lineas[n - 1]?.autorizada ?? '' }}</div>
            <div class="celda centro medio t10" :style="renglon(n, 'despachada')">{{ lineas[n - 1]?.despachada ?? '' }}</div>
          </template>
        </template>

        <div class="celda negrita" :style="sobreLinea(34, 200, LINEA.observaciones)">{{ h === 0 ? (r.observaciones ?? '') : '' }}</div>
        <div class="celda centro medio negrita t10" :style="caja(...FECHA.dia, FECHA.arriba, FECHA.abajo)">{{ fecha.d }}</div>
        <div class="celda centro medio negrita t10" :style="caja(...FECHA.mes, FECHA.arriba, FECHA.abajo)">{{ fecha.m }}</div>
        <div class="celda centro medio negrita t10" :style="caja(...FECHA.anio, FECHA.arriba, FECHA.abajo)">{{ fecha.a }}</div>
        <div class="celda centro negrita" :style="sobreLinea(20, 86, LINEA.solicitante)">{{ r.solicitante }}</div>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.pagina { position: relative; width: 8.5in; height: 13in; margin: 0 auto 16px; background: #fff; color: #000; overflow: hidden; box-shadow: 0 1px 6px rgba(0, 0, 0, .15); }
.forma { position: absolute; inset: 0; font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt; }
.celda { position: absolute; display: flex; align-items: flex-end; padding: 0 2px 1px; white-space: pre; overflow: visible; line-height: 1.15; }
.centro { justify-content: center; }
.medio { align-items: center; }
.negrita { font-weight: 700; }
.t10 { font-size: 10pt; }
.con-guias .celda { outline: 1px dashed #CBD5E1; outline-offset: -1px; }
@media print {
  @page { size: 8.5in 13in; margin: 0; }
  .pagina { margin: 0; box-shadow: none; page-break-after: always; }
  .pagina:last-child { page-break-after: auto; }
  .con-guias .celda { outline: none; }
}
</style>
