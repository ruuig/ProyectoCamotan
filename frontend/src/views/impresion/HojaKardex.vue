<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import { registrarImpresion } from '../../dominio/impresionBodega';
import { leerAnotarReclamar, guardarAnotarReclamar, observacionKardex } from '../../dominio/bodega';

/**
 * Tarjeta de Control de Suministro (kardex) impresa sobre la tarjeta.
 *
 * Como el BRES: sin líneas ni títulos, solo los datos en su lugar. El frente
 * se midió con regla sobre la tarjeta (oficio horizontal, 21 renglones), en
 * milímetros desde la esquina superior izquierda. El reverso (27 renglones)
 * sigue con las medidas de la plantilla del centro
 * (documentacion/Plantillas/KARDEX1) al 95 %. Se puede empezar en el renglón
 * libre de una tarjeta ya usada.
 *
 * ?insumoId=... un producto; sin él, todos los que se movieron en ?periodo=.
 */
const route = useRoute();

const datos = ref(null);
const error = ref('');

// --- Medidas (todo en milímetros) ------------------------------------------------
/** Columnas a partir de sus bordes: { A: { left, width }, B: ... }. */
function columnas(bordes) {
  return Object.fromEntries(bordes.slice(0, -1).map((x, i) => [String.fromCharCode(65 + i), { left: x, width: bordes[i + 1] - x }]));
}
function filas(altos) {
  const res = {};
  let y = 0;
  for (const [n, alto] of Object.entries(altos)) {
    res[n] = { top: y, height: alto };
    y += alto;
  }
  return res;
}
// Reverso: anchos de columna de Excel (caracteres) y altos de fila (puntos).
const excelMm = (ancho) => (Math.round(ancho * 7 + 5) / 96) * 25.4;
const ptMm = (pt) => (pt * 25.4) / 72;
function bordesExcel(anchos) {
  const res = [0];
  for (const a of anchos) res.push(res[res.length - 1] + excelMm(a));
  return res;
}
const ALTO_FRENTE = (209.1 - 71.0) / 21;
const LADO = {
  frente: {
    margen: { left: 0, top: 0 },
    escala: 1,
    // Fecha, referencia, remitente, entrada (cant, precio, valor), vence, lote, salida, reajuste, saldo (cant, precio), observaciones
    col: columnas([11.6, 31.9, 52.1, 102.9, 121.5, 142.1, 161.5, 184.7, 204.9, 224.7, 243.7, 263.8, 283.8, 317.0]),
    fila: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [8 + i, { top: 71.0 + i * ALTO_FRENTE, height: ALTO_FRENTE }])),
    primera: 8,
    renglones: 21,
    campos: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'],
    obsHasta: 'M',
  },
  reverso: {
    margen: { left: 1.28 * 25.4, top: 0.75 * 25.4 },
    escala: 0.95,
    col: columnas(bordesExcel([4.86, 8.71, 11.43, 26.86, 10.71, 8.86, 10, 13.29, 11.43, 10.14, 9.29, 9.29, 9.29, 9.29, 9.29, 9.71])),
    fila: Object.fromEntries(Object.entries(filas({ 1: 27, ...Object.fromEntries(Array.from({ length: 27 }, (_, i) => [2 + i, 20.1])) }))
      .map(([n, f]) => [n, { top: ptMm(f.top), height: ptMm(f.height) }])),
    primera: 2,
    renglones: 27,
    campos: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'],
    obsHasta: 'P',
  },
};
// Encabezado del frente: texto sobre las líneas de producto, distrito y
// servicio, y dentro de las casillas de niveles mínimo y máximo.
const sobreLinea = (x1, x2, linea) => ({ left: `${x1}mm`, width: `${x2 - x1}mm`, top: `${linea - 6}mm`, height: `${5.6}mm` });
const ENC = {
  producto: sobreLinea(55, 235, 39.3),
  distrito: sobreLinea(52, 137, 51.4),
  servicio: sobreLinea(155, 235, 51.4),
  minimo: { left: '242.8mm', width: '17.9mm', top: '43mm', height: '8.4mm' },
  maximo: { left: '260.7mm', width: '17.6mm', top: '43mm', height: '8.4mm' },
};
const POR_TARJETA = LADO.frente.renglones + LADO.reverso.renglones;

// --- Preferencias de este equipo -------------------------------------------------
const CLAVE_AJUSTE = 'camotan_kardex_ajuste';
function leer(clave, defecto) {
  try { return JSON.parse(localStorage.getItem(clave)) ?? defecto; } catch { return defecto; }
}
const ajuste = ref(leer(CLAVE_AJUSTE, { x: 0, y: 0 }));
function mover(eje, mm) {
  ajuste.value = { ...ajuste.value, [eje]: ajuste.value[eje] + mm };
  try { localStorage.setItem(CLAVE_AJUSTE, JSON.stringify(ajuste.value)); } catch { /* sin almacenamiento */ }
}
const inicio = ref(1);
const lados = ref('ambos');
const guias = ref(true);
// La misma preferencia que en la pantalla del kardex.
const anotarReclamar = ref(leerAnotarReclamar());
watch(anotarReclamar, guardarAnotarReclamar);
const imprimir = () => window.print();

// --- Formatos ----------------------------------------------------------------------
const fechaCorta = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Guatemala' }) : '');
const venceCorta = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '');
const numero = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('es-GT', { maximumFractionDigits: 2 }));
const conSigno = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${numero(v)}`);

/** Los valores de cada renglón, en el orden de las columnas de la tarjeta. */
function valores(f) {
  return [
    fechaCorta(f.fecha), f.referencia ?? '', f.remitenteDestinatario ?? '',
    numero(f.entrada), numero(f.precioUnitario), numero(f.valorEntrada),
    venceCorta(f.fechaVence), f.numeroLote ?? '',
    numero(f.salida), conSigno(f.reajuste), numero(f.saldo),
    f.saldo && f.valorSaldo != null ? numero(f.valorSaldo / f.saldo) : '',
    observacionKardex(f, anotarReclamar.value),
  ];
}
const ALINEAR = ['izq chica', 'centro', 'izq', 'centro', 'centro', 'der', 'centro', 'centro', 'centro', 'centro', 'centro', 'centro', 'izq'];

/** Cada producto en tarjetas: frente y reverso, empezando en el renglón libre. */
const paginas = computed(() => {
  const salida = [];
  const enc = datos.value?.encabezado ?? {};
  for (const t of datos.value?.tarjetas ?? []) {
    const renglones = [];
    if ((route.query.periodo || route.query.desde) && t.saldoAnterior) {
      renglones.push({ id: 'ant', remitenteDestinatario: 'Saldo anterior', saldo: t.saldoAnterior, valorSaldo: t.valorAnterior });
    }
    renglones.push(...t.filas);
    const vacios = Math.max(0, Math.min(POR_TARJETA, Number(inicio.value) || 1) - 1);
    const lista = [...Array(vacios).fill(null), ...renglones];
    for (let desde = 0, tarjeta = 1; desde < lista.length; desde += POR_TARJETA, tarjeta += 1) {
      const parte = lista.slice(desde, desde + POR_TARJETA);
      const frente = parte.slice(0, LADO.frente.renglones);
      const reverso = parte.slice(LADO.frente.renglones);
      if (lados.value !== 'reverso' && frente.some(Boolean)) salida.push({ lado: 'frente', t, enc, renglones: frente, tarjeta, conEncabezado: desde === 0 ? vacios === 0 : true });
      if (lados.value !== 'frente' && reverso.some(Boolean)) salida.push({ lado: 'reverso', t, enc, renglones: reverso, tarjeta });
    }
  }
  return salida;
});

const posicion = (lado, letra, fila, hasta = letra) => {
  const L = LADO[lado];
  return {
    left: `${L.col[letra].left}mm`,
    width: `${L.col[hasta].left + L.col[hasta].width - L.col[letra].left}mm`,
    top: `${L.fila[fila].top}mm`,
    height: `${L.fila[fila].height}mm`,
  };
};
const producto = (i) => [i.nombreGenerico, i.concentracion, i.presentacion].filter(Boolean).join(', ');

onMounted(async () => {
  try {
    const q = {};
    if (route.query.periodo) q.periodo = route.query.periodo;
    if (route.query.desde) q.desde = route.query.desde;
    if (route.query.insumoId) q.insumoId = route.query.insumoId;
    if (route.query.ubicacion) q.ubicacion = route.query.ubicacion;
    datos.value = await bodega.kardex(q);
    registrarImpresion('kardex', `${route.query.periodo ?? 'historia'}${route.query.insumoId ? ` insumo ${route.query.insumoId}` : ''}`);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <p v-if="error" role="alert" class="no-imprimir p-6 text-red-700">{{ error }}</p>

  <div v-if="datos" class="no-imprimir mx-auto flex max-w-[13in] flex-wrap items-center gap-2 p-4 text-sm">
    <span class="font-bold">{{ datos.tarjetas.length }} producto(s) · {{ paginas.length }} cara(s)</span>
    <label class="ml-3 flex items-center gap-1">Empezar en el renglón
      <input v-model.number="inicio" type="number" min="1" :max="POR_TARJETA" class="w-16 rounded border px-2 py-1" />
      <span class="text-xs text-slate-500">(1–21 frente, 22–48 reverso)</span>
    </label>
    <select v-model="lados" class="rounded border px-2 py-1" aria-label="Caras">
      <option value="ambos">Frente y reverso</option>
      <option value="frente">Solo frente</option>
      <option value="reverso">Solo reverso</option>
    </select>
    <span class="ml-3">Ajuste:</span>
    <button type="button" class="rounded border px-2 py-1" @click="mover('x', -1)">← 1 mm</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('x', 1)">1 mm →</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('y', -1)">↑ 1 mm</button>
    <button type="button" class="rounded border px-2 py-1" @click="mover('y', 1)">1 mm ↓</button>
    <span class="tabular-nums">({{ ajuste.x }}, {{ ajuste.y }}) mm</span>
    <label class="flex items-center gap-1"><input v-model="guias" type="checkbox" /> Ver casillas</label>
    <label class="flex items-center gap-1"><input v-model="anotarReclamar" type="checkbox" /> Anotar faltantes por reclamar</label>
    <button type="button" class="ml-auto rounded bg-black px-3 py-1.5 font-bold text-white" @click="imprimir">Imprimir</button>
    <p class="w-full text-xs text-slate-600">
      Tarjeta en papel oficio horizontal. Las casillas punteadas solo se ven aquí. Para el reverso, voltee la tarjeta y elija "Solo reverso".
    </p>
  </div>
  <p v-if="datos && !paginas.length" class="no-imprimir p-6 text-center">No hay movimientos para imprimir.</p>

  <!-- hoja-propia: lo único que sale en el papel (style-impresion.css oculta lo demás). -->
  <div class="hoja-propia">
    <div v-for="(p, i) in paginas" :key="i" class="pagina" :class="guias ? 'con-guias' : ''">
      <div
        class="forma"
        :style="{ left: `${LADO[p.lado].margen.left}mm`, top: `${LADO[p.lado].margen.top}mm`, transform: `translate(${ajuste.x}mm, ${ajuste.y}mm) scale(${LADO[p.lado].escala})` }"
      >
        <template v-if="p.lado === 'frente' && p.conEncabezado">
          <div class="celda centro abajo" :style="ENC.producto">{{ producto(p.t.insumo) }}</div>
          <div class="celda centro abajo" :style="ENC.distrito">{{ p.enc.distrito }}</div>
          <div class="celda centro abajo arial" :style="ENC.servicio">{{ p.enc.servicio }}</div>
          <div class="celda centro arial" :style="ENC.minimo">{{ numero(p.enc.nivelMinimo) }}</div>
          <div class="celda centro arial" :style="ENC.maximo">{{ numero(p.enc.nivelMaximo) }}</div>
        </template>
        <template v-for="(f, n) in p.renglones" :key="n">
          <template v-if="f">
            <div
              v-for="(v, c) in valores(f)"
              :key="c"
              class="celda"
              :class="ALINEAR[c]"
              :style="posicion(p.lado, LADO[p.lado].campos[c], LADO[p.lado].primera + n, c === 12 ? LADO[p.lado].obsHasta : LADO[p.lado].campos[c])"
            >{{ v }}</div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pagina { position: relative; width: 13in; height: 8.5in; margin: 0 auto 16px; background: #fff; color: #000; overflow: hidden; box-shadow: 0 1px 6px rgba(0, 0, 0, .15); }
.forma { position: absolute; transform-origin: 0 0; font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt; width: 13in; height: 8.5in; }
.celda { position: absolute; display: flex; align-items: center; padding: 0 2px; white-space: nowrap; overflow: hidden; line-height: 1.1; }
.centro { justify-content: center; }
.der { justify-content: flex-end; }
.izq { justify-content: flex-start; }
.abajo { align-items: flex-end; padding-bottom: 0.5mm; }
.chica { font-size: 8pt; }
.arial { font-family: Arial, sans-serif; font-size: 10pt; }
.con-guias .celda { outline: 1px dashed #CBD5E1; outline-offset: -1px; }
@media print {
  @page { size: 13in 8.5in; margin: 0; }
  .pagina { margin: 0; box-shadow: none; page-break-after: always; }
  .pagina:last-child { page-break-after: auto; }
  .con-guias .celda { outline: none; }
}
</style>
