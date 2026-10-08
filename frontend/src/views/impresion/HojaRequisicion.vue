<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion } from '../../dominio/impresionBodega';

/**
 * Requisición Despacho de Almacén (FOR-ASE-01) impresa sobre el formulario.
 *
 * Como el BRES: sin líneas ni títulos, solo los datos en su lugar. Las medidas
 * son las de la plantilla del centro (documentacion/Plantillas/REQUIOPSCERF):
 * papel oficio, margen izquierdo 0.16", superior 0.87", columnas A a F y la
 * altura de cada fila. La descripción larga se parte en las líneas siguientes;
 * el número de orden, la unidad y la cantidad van en la primera.
 */
const route = useRoute();

const r = ref(null);
const est = ref(null);
const error = ref('');

// --- Medidas de la plantilla -----------------------------------------------------
// Ancho de columna de Excel (caracteres) a pulgadas: (ancho * 7 + 5) px a 96 ppp.
const pulgadas = (ancho) => Math.round(ancho * 7 + 5) / 96;
const COL = { A: pulgadas(14), B: pulgadas(46.1), C: pulgadas(14.7), D: pulgadas(11), E: pulgadas(10.7), F: pulgadas(8.43) };
const IZQ = { A: 0 };
IZQ.B = IZQ.A + COL.A;
IZQ.C = IZQ.B + COL.B;
IZQ.D = IZQ.C + COL.C;
IZQ.E = IZQ.D + COL.D;
IZQ.F = IZQ.E + COL.E;
// Altura de cada fila en puntos (filas 1 a 36).
const ALTO = [14.25, 15.95, 21.75, 22.5, 22.5, 23.1, 27.75, 18.75,
  18.95, 18.95, 18.95, 18.95, 18.95, 18.95, 18.95, 18.95, 18.95, 18.95, 21, 18.95, 18.95, 18.95, 18.95, 18.95,
  20.1, 18.95, 21, 18.95, 18.95, 18.95, 18.95, 18.95, 26.85, 32.45, 32.25, 51.75];
const ARRIBA = ALTO.reduce((acc, h, i) => { acc.push((acc[i - 1] ?? 0) + (ALTO[i - 1] ?? 0)); return acc; }, []);
const fila = (n) => ({ top: `${ARRIBA[n - 1]}pt`, height: `${ALTO[n - 1]}pt` });
const col = (letra, hasta = letra) => ({ left: `${IZQ[letra]}in`, width: `${IZQ[hasta] + COL[hasta] - IZQ[letra]}in` });
const PRIMERA = 8;
const RENGLONES = 25;

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

// --- Partir la descripción como en la plantilla ----------------------------------
let lienzo;
function anchoTexto(texto) {
  lienzo ??= document.createElement('canvas').getContext('2d');
  lienzo.font = '11pt Calibri, Carlito, Arial, sans-serif';
  return lienzo.measureText(texto).width / 96; // px a pulgadas
}
const ANCHO_B = COL.B - 0.06;
function partir(texto) {
  const lineas = [];
  let actual = '';
  for (const palabra of String(texto ?? '').split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (anchoTexto(prueba) <= ANCHO_B || !actual) actual = prueba;
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

const fechaTexto = computed(() => {
  if (!r.value?.fechaSolicitud) return '';
  const [a, m, d] = r.value.fechaSolicitud.slice(0, 10).split('-');
  // Como en la plantilla: día, mes y año separados con espacios.
  return `                         ${d}      ${m}          ${a}`;
});
const sangria = (texto) => (texto ? `        ${texto}` : '');
const nombre = (texto) => (texto ? `                    ${texto}` : '');
const unidad = computed(() => r.value?.unidadSeccion ?? '');

onMounted(async () => {
  try {
    est.value = await cargarEstablecimiento();
    r.value = (await bodega.requisicion(route.params.id)).requisicion;
    registrarImpresion('requisicion', r.value.numero ?? `id ${r.value.id}`);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <p v-if="error" role="alert" class="no-imprimir p-6 text-red-700">{{ error }}</p>

  <div v-if="r" class="no-imprimir mx-auto flex max-w-[8.5in] flex-wrap items-center gap-2 p-4 text-sm">
    <span class="font-bold">Requisición {{ r.numero ?? '(sin número)' }} · {{ hojas.length }} {{ hojas.length === 1 ? 'formulario' : 'formularios' }}</span>
    <span class="ml-3">Ajuste:</span>
    <button type="button" class="rounded border px-2 py-1" @click="mover('x', -1)">← 1 mm</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('x', 1)">1 mm →</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('y', -1)">↑ 1 mm</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('y', 1)">1 mm ↓</button>
    <span class="tabular-nums">({{ ajuste.x }}, {{ ajuste.y }}) mm</span>
    <label class="ml-3 flex items-center gap-1"><input v-model="conCantidades" type="checkbox" @change="cambiarCantidades" /> Imprimir autorizada y despachada</label>
    <label class="flex items-center gap-1"><input v-model="guias" type="checkbox" /> Ver casillas</label>
    <button type="button" class="ml-auto rounded bg-black px-3 py-1.5 font-bold text-white" @click="imprimir">Imprimir</button>
    <p class="w-full text-xs text-slate-600">
      Ponga el formulario FOR-ASE-01 en la bandeja (papel oficio). Las casillas punteadas solo se ven aquí, no salen impresas.
      La primera vez pruebe en una hoja normal contra la luz y ajuste; el ajuste queda guardado en este equipo.
    </p>
  </div>

  <div v-for="(lineas, h) in (r ? hojas : [])" :key="h" class="pagina" :class="guias ? 'con-guias' : ''">
    <div class="forma" :style="{ transform: `translate(${ajuste.x}mm, ${ajuste.y}mm)` }">
      <div class="celda negrita t10" :style="{ ...fila(3), ...col('B', 'D') }">{{ sangria(est?.municipio) }}</div>
      <div class="celda negrita t10" :style="{ ...fila(4), ...col('B', 'D') }">{{ sangria(est?.departamento) }}</div>
      <div class="celda negrita t10" :style="{ ...fila(5), ...col('B', 'D') }">{{ sangria(unidad) }}</div>

      <template v-for="n in RENGLONES" :key="n">
        <div class="celda derecha" :style="{ ...fila(PRIMERA + n - 1), ...col('A') }">{{ lineas[n - 1]?.orden ?? '' }}</div>
        <div class="celda" :style="{ ...fila(PRIMERA + n - 1), ...col('B') }">{{ lineas[n - 1]?.texto ?? '' }}</div>
        <div class="celda centro" :style="{ ...fila(PRIMERA + n - 1), ...col('C') }">{{ lineas[n - 1]?.unidad ?? '' }}</div>
        <div class="celda centro t10" :style="{ ...fila(PRIMERA + n - 1), ...col('D') }">{{ lineas[n - 1]?.solicitada ?? '' }}</div>
        <template v-if="conCantidades">
          <div class="celda centro t10" :style="{ ...fila(PRIMERA + n - 1), ...col('E') }">{{ lineas[n - 1]?.autorizada ?? '' }}</div>
          <div class="celda centro t10" :style="{ ...fila(PRIMERA + n - 1), ...col('F') }">{{ lineas[n - 1]?.despachada ?? '' }}</div>
        </template>
      </template>

      <div class="celda negrita" :style="{ ...fila(33), ...col('B', 'D') }">{{ h === 0 ? (r.observaciones ?? '') : '' }}</div>
      <div class="celda negrita t10" :style="{ ...fila(34), ...col('B', 'D') }">{{ fechaTexto }}</div>
      <div class="celda negrita" :style="{ ...fila(35), ...col('A', 'C') }">{{ nombre(r.solicitante) }}</div>
    </div>
  </div>
</template>

<style scoped>
.pagina { position: relative; width: 8.5in; height: 13in; margin: 0 auto 16px; background: #fff; color: #000; overflow: hidden; box-shadow: 0 1px 6px rgba(0, 0, 0, .15); }
.forma { position: absolute; left: 0.16in; top: 0.87in; right: 0; bottom: 0; font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt; }
.celda { position: absolute; display: flex; align-items: flex-end; padding: 0 2px 1px; white-space: pre; overflow: visible; line-height: 1.15; }
.centro { justify-content: center; }
.derecha { justify-content: flex-end; }
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
