<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue';

/**
 * BRES sobre el formulario preimpreso del MSPAS.
 *
 * El centro no imprime el BRES en hoja blanca: lo imprime encima del
 * formulario que ya trae títulos, líneas y columnas. Por eso aquí no hay
 * tabla ni bordes, solo los valores. Las posiciones se midieron con regla
 * sobre el formulario, en milímetros desde la esquina superior izquierda de
 * la hoja (oficio horizontal): 20 insumos por hoja y las firmas al pie.
 *
 * Cada impresora corre la hoja un poco distinto, así que se puede ajustar
 * en milímetros (desplazamiento), y el ajuste se recuerda en el equipo.
 */
const props = defineProps({
  hojas: { type: Array, required: true },
  encabezado: { type: Object, required: true },
  firmas: { type: Object, default: () => ({}) },
  desplazamiento: { type: Object, default: () => ({ x: 0, y: 0 }) },
  cargoEncargado: { type: String, default: 'Encargado de Bodega' },
});

// El texto conserva el tamaño con que salía del Excel del centro (al 90 %).
const ESCALA_TEXTO = 0.9;

// Bordes de las columnas: suministro y las columnas A a L del formulario.
const BORDES = [22.7, 91.2, 110.0, 128.7, 148.0, 167.3, 187.8, 205.0, 225.6, 244.5, 263.4, 281.5, 301.9, 322.3];
const PRIMERA = 62.3; // borde superior del primer renglón
const ALTO = 5.915; // alto de cada renglón

/** Una caja en milímetros, corrida por el ajuste de la impresora. */
function caja(x1, x2, y1, y2) {
  return {
    left: `${x1 + props.desplazamiento.x}mm`,
    top: `${y1 + props.desplazamiento.y}mm`,
    width: `${x2 - x1}mm`,
    height: `${y2 - y1}mm`,
  };
}
/** Texto sobre una línea del formulario: la caja termina en la línea. */
const sobreLinea = (x1, x2, linea) => caja(x1, x2, linea - 5, linea - 0.4);
const celda = (col, i) => caja(BORDES[col], BORDES[col + 1], PRIMERA + i * ALTO, PRIMERA + (i + 1) * ALTO);

// Encabezado y pie, con las mismas medidas.
const ENC = {
  municipio: sobreLinea(75, 120, 29.6),
  servicio: sobreLinea(75, 120, 34.2),
  fecha: sobreLinea(75, 120, 39.1),
  informan: sobreLinea(178, 215, 29.8),
  debenInformar: sobreLinea(178, 215, 34.7),
  minimo: caja(227.6, 244.1, 34.7, 40.0),
  maximo: caja(244.1, 262.7, 34.7, 40.0),
  mes: caja(281.0, 301.9, 34.7, 40.0),
  anio: caja(301.9, 322.1, 34.7, 40.0),
  elaborado: sobreLinea(121, 196, 192.7),
  cargoElaborado: sobreLinea(226, 264, 192.7),
  vistoBueno: sobreLinea(121, 196, 199.7),
  cargoVistoBueno: sobreLinea(226, 264, 199.7),
};

/** Formato contable del Excel: separador de miles, el cero como guion. */
function numero(v, entero = false) {
  if (v === null || v === undefined || v === '') return '';
  const n = entero ? Math.round(Number(v)) : Number(v);
  if (n === 0) return '-';
  const texto = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n < 0 ? `(${texto})` : texto;
}

// Columnas de datos A a L del formulario, en orden.
const DATOS = [
  'saldoInicial', 'entradas', 'entregado', 'noEntregado', 'demandaReal', 'reajustes',
  'saldoFinal', 'existenciaBodega', 'pmdr', 'med', 'cantidadMaxima', 'cantidadSolicitar',
];

const paginas = computed(() => props.hojas);
const tamanoPx = (pt) => `${pt * ESCALA_TEXTO}pt`;

/*
 * El nombre del insumo, tan grande como quepa en su casilla (68.5 x 5.9 mm):
 * hasta 9 pt en una línea; si es largo, baja a 7.5 pt y usa dos líneas (dos
 * líneas de 7.5 pt con interlineado 1.1 miden 5.8 mm). Un carácter de Arial
 * mide en promedio 0.55 de la letra.
 */
const ANCHO_NOMBRE = BORDES[1] - BORDES[0] - 2; // mm, sin el relleno
function tamanoNombre(nombre) {
  const largo = Math.max(1, String(nombre ?? '').length);
  const enUnaLinea = ANCHO_NOMBRE / (largo * 0.55 * 0.3528);
  return `${Math.min(9, Math.max(7.5, enUnaLinea)).toFixed(1)}pt`;
}

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
      <span class="celda negrita izquierda abajo" :style="[ENC.municipio, { fontSize: tamanoPx(9) }]">{{ encabezado.municipio }}</span>
      <span class="celda negrita centro abajo" :style="[ENC.informan, { fontSize: tamanoPx(9) }]">{{ encabezado.serviciosInformaron }}</span>
      <span class="celda negrita izquierda abajo" :style="[ENC.servicio, { fontSize: tamanoPx(9) }]">{{ encabezado.servicio }}</span>
      <span class="celda negrita centro abajo" :style="[ENC.debenInformar, { fontSize: tamanoPx(9) }]">{{ encabezado.serviciosTotal }}</span>
      <span class="celda negrita centro medio" :style="[ENC.minimo, { fontSize: tamanoPx(10) }]">{{ encabezado.minimo }}</span>
      <span class="celda negrita centro medio" :style="[ENC.maximo, { fontSize: tamanoPx(10) }]">{{ encabezado.maximo }}</span>
      <span class="celda negrita centro medio" :style="[ENC.mes, { fontSize: tamanoPx(10) }]">{{ encabezado.mes }}</span>
      <span class="celda negrita centro medio" :style="[ENC.anio, { fontSize: tamanoPx(10) }]">{{ encabezado.anio }}</span>
      <span class="celda negrita izquierda abajo" :style="[ENC.fecha, { fontSize: tamanoPx(9) }]">{{ encabezado.fecha }}</span>

      <!-- Renglones -->
      <template v-for="(r, i) in hoja" :key="r.insumoId">
        <span class="celda izquierda medio nombre" :style="[celda(0, i), { fontSize: tamanoNombre(r.nombreFormulario) }]">{{ r.vacio ? '' : r.nombreFormulario }}</span>
        <template v-if="!r.vacio">
          <span
            v-for="(clave, c) in DATOS"
            :key="clave"
            class="celda medio derecha contable"
            :style="[celda(c + 1, i), { fontSize: tamanoPx(10) }]"
          >
            {{ numero(r[clave], clave === 'med' || clave === 'pmdr') }}
          </span>
        </template>
      </template>

      <!-- Firmas -->
      <span class="celda abajo firma" :style="[ENC.elaborado, { fontSize: tamanoPx(11) }]">{{ firmas.encargadoBodega }}</span>
      <span class="celda centro abajo desborda" :style="[ENC.cargoElaborado, { fontSize: tamanoPx(10) }]">{{ cargoEncargado }}</span>
      <span class="celda abajo firma" :style="[ENC.vistoBueno, { fontSize: tamanoPx(11) }]">{{ firmas.coordinadorMunicipal }}</span>
      <span class="celda centro abajo desborda" :style="[ENC.cargoVistoBueno, { fontSize: tamanoPx(10) }]">Coordinador Municipal</span>
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
