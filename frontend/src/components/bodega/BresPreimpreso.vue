<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue';

/**
 * BRES sobre el formulario preimpreso del MSPAS.
 *
 * El centro no imprime el BRES en hoja blanca: lo imprime encima del
 * formulario que ya trae títulos, líneas y columnas. Por eso aquí no hay
 * tabla ni bordes, solo los valores, cada uno en la posición que tiene en el
 * Excel "BRES ... IMP" del centro (documentacion/Plantillas/BRES SEPTIEMBRE2026IMP.xlsx):
 *
 *   papel oficio (8.5 × 13 pulgadas) horizontal, escala 90 %,
 *   margen izquierdo 0.79", superior 0.51",
 *   20 insumos por hoja (filas 10 a 29), firmas en las filas 32 y 33.
 *
 * Cada impresora corre la hoja un poco distinto, así que se puede ajustar
 * en milímetros (desplazamiento), y el ajuste se recuerda en el equipo.
 */
const props = defineProps({
  hojas: { type: Array, required: true },
  encabezado: { type: Object, required: true },
  firmas: { type: Object, default: () => ({}) },
  desplazamiento: { type: Object, default: () => ({ x: 0, y: 0 }) },
});

const ESCALA = 0.9;
const MM_POR_PT = 25.4 / 72;
const MARGEN_IZQ = 0.7874 * 25.4;
const MARGEN_SUP = 0.5118 * 25.4;

// Anchos de columna en milímetros, ya a la escala de 90 %. Medidos sobre el
// PDF que exporta el propio Excel del centro: calcularlos desde el ancho en
// caracteres dejaba la columna A 4 mm corta y corría todos los números.
const ANCHOS = { A: 65.8, B: 15.9, C: 18.7, D: 18.7, E: 19.9, F: 18.9, G: 20.45, H: 19.75, I: 19.2, J: 20.8, K: 20.0, L: 18.5, M: 15.9, N: 17, O: 18 };
// Altos de fila del Excel, en puntos.
const ALTOS = [18.75, 15, 13.5, 15, 18, 24, 15, 15, 20.25, 19.5, 19.5, 19.5, 19.5, 19.5, 21, 19.5, 19.5, 20.1, 20.1,
  20.1, 20.1, 20.1, 20.1, 19.5, 19.5, 19.5, 19.5, 19.5, 19.5, 11.25, 12.75, 15.75, 21.6];

const COLS = Object.keys(ANCHOS);
const anchoMm = (letra) => ANCHOS[letra];
const xCol = (letra) => MARGEN_IZQ + COLS.slice(0, COLS.indexOf(letra)).reduce((s, l) => s + anchoMm(l), 0);
const altoFila = (n) => ALTOS[n - 1] * MM_POR_PT * ESCALA;
const yFila = (n) => MARGEN_SUP + ALTOS.slice(0, n - 1).reduce((s, h) => s + h * MM_POR_PT * ESCALA, 0);

/** Una celda (o rango combinado) del Excel como caja posicionada. */
function caja(desde, hasta, filaIni, filaFin = filaIni) {
  const x = xCol(desde) + props.desplazamiento.x;
  const ancho = xCol(hasta) + anchoMm(hasta) - xCol(desde);
  const y = yFila(filaIni) + props.desplazamiento.y;
  const alto = yFila(filaFin) + altoFila(filaFin) - yFila(filaIni);
  return { left: `${x}mm`, top: `${y}mm`, width: `${ancho}mm`, height: `${alto}mm` };
}

/** Formato contable del Excel: separador de miles, el cero como guion. */
function numero(v, entero = false) {
  if (v === null || v === undefined || v === '') return '';
  const n = entero ? Math.round(Number(v)) : Number(v);
  if (n === 0) return '-';
  const texto = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n < 0 ? `(${texto})` : texto;
}

// Columnas de datos B a M, en el orden del formulario.
const DATOS = [
  ['B', 'saldoInicial'], ['C', 'entradas'], ['D', 'entregado'], ['E', 'noEntregado'], ['F', 'demandaReal'],
  ['G', 'reajustes'], ['H', 'saldoFinal'], ['I', 'existenciaBodega'], ['J', 'pmdr'], ['K', 'med'],
  ['L', 'cantidadMaxima'], ['M', 'cantidadSolicitar'],
];

const paginas = computed(() => props.hojas);
const tamanoPx = (pt) => `${pt * ESCALA}pt`;

// El tamaño de página se fija mientras esta vista está abierta: oficio
// horizontal y sin márgenes (los márgenes ya están en las posiciones). Una
// página con nombre no la respetan todos los navegadores al imprimir.
let estiloPagina = null;
onMounted(() => {
  estiloPagina = document.createElement('style');
  estiloPagina.textContent = '@page { size: 13in 8.5in; margin: 0; }';
  document.head.appendChild(estiloPagina);
});
onBeforeUnmount(() => estiloPagina?.remove());
</script>

<template>
  <div class="bres-preimpreso">
    <div v-for="(hoja, h) in paginas" :key="h" class="hoja-oficio">
      <!-- Encabezado -->
      <span class="celda negrita izquierda abajo" :style="[caja('B', 'D', 3), { fontSize: tamanoPx(9) }]">{{ encabezado.municipio }}</span>
      <span class="celda negrita centro abajo" :style="[caja('G', 'G', 3), { fontSize: tamanoPx(9) }]">{{ encabezado.serviciosTotal }}</span>
      <span class="celda negrita izquierda abajo" :style="[caja('B', 'D', 4), { fontSize: tamanoPx(9) }]">{{ encabezado.servicio }}</span>
      <span class="celda negrita centro abajo" :style="[caja('G', 'G', 4), { fontSize: tamanoPx(9) }]">{{ encabezado.serviciosInformaron }}</span>
      <span class="celda negrita derecha medio" :style="[caja('I', 'I', 4, 6), { fontSize: tamanoPx(10) }]">{{ encabezado.minimo }}</span>
      <span class="celda negrita derecha medio" :style="[caja('J', 'J', 4, 6), { fontSize: tamanoPx(10) }]">{{ encabezado.maximo }}</span>
      <span class="celda negrita derecha medio" :style="[caja('L', 'L', 4, 6), { fontSize: tamanoPx(10) }]">{{ encabezado.mes }}</span>
      <span class="celda negrita derecha medio" :style="[caja('M', 'M', 4, 6), { fontSize: tamanoPx(10) }]">{{ encabezado.anio }}</span>
      <span class="celda negrita izquierda abajo" :style="[caja('B', 'C', 5), { fontSize: tamanoPx(9) }]">{{ encabezado.fecha }}</span>

      <!-- Renglones: filas 10 a 29 -->
      <template v-for="(r, i) in hoja" :key="r.insumoId">
        <span class="celda izquierda medio nombre" :style="[caja('A', 'A', 10 + i), { fontSize: tamanoPx(7) }]">{{ r.vacio ? '' : r.nombreFormulario }}</span>
        <template v-if="!r.vacio">
          <span
            v-for="[col, clave] in DATOS"
            :key="col"
            class="celda abajo derecha contable"
            :style="[caja(col, col, 10 + i), { fontSize: tamanoPx(10) }]"
          >
            {{ numero(r[clave], clave === 'med' || clave === 'pmdr') }}
          </span>
        </template>
      </template>

      <!-- Firmas -->
      <span class="celda arriba firma" :style="[caja('D', 'H', 32), { fontSize: tamanoPx(11) }]">{{ firmas.encargadoBodega }}</span>
      <span class="celda centro arriba desborda" :style="[caja('I', 'I', 32), { fontSize: tamanoPx(10) }]">Encargado de Bodega</span>
      <span class="celda medio firma" :style="[caja('D', 'H', 33), { fontSize: tamanoPx(11) }]">{{ firmas.coordinadorMunicipal }}</span>
      <span class="celda centro medio desborda" :style="[caja('I', 'I', 33), { fontSize: tamanoPx(10) }]">Coordinador Municipal</span>
    </div>
  </div>
</template>

<style>
.bres-preimpreso .hoja-oficio {
  position: relative;
  width: 13in;
  height: 8.5in;
  background: #fff;
  color: #000;
  font-family: Arial, Helvetica, sans-serif;
  break-after: page;
  overflow: hidden;
}
.bres-preimpreso .hoja-oficio:last-child { break-after: auto; }
@media screen {
  .bres-preimpreso .hoja-oficio { margin: 0 auto 1rem; box-shadow: 0 0 0 1px #c5ccd8; }
}
.bres-preimpreso .celda {
  position: absolute;
  display: flex;
  overflow: hidden;
  white-space: nowrap;
  line-height: 1.1;
  padding: 0 1mm;
  box-sizing: border-box;
}
.bres-preimpreso .nombre { white-space: normal; }
/* Como en Excel: un texto centrado más ancho que su celda se extiende a los lados. */
.bres-preimpreso .desborda { overflow: visible; }
.bres-preimpreso .contable { padding-right: 2mm; }
.bres-preimpreso .firma { font-family: Calibri, Arial, sans-serif; }
.bres-preimpreso .negrita { font-weight: 700; }
.bres-preimpreso .izquierda { justify-content: flex-start; }
.bres-preimpreso .centro { justify-content: center; }
.bres-preimpreso .derecha { justify-content: flex-end; }
.bres-preimpreso .abajo { align-items: flex-end; }
.bres-preimpreso .medio { align-items: center; }
.bres-preimpreso .arriba { align-items: flex-start; }
</style>
