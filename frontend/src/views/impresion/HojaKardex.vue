<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import { registrarImpresion } from '../../dominio/impresionBodega';

/**
 * Tarjeta de Control de Suministro (kardex) impresa sobre la tarjeta.
 *
 * Como el BRES: sin líneas ni títulos, solo los datos en su lugar. Las medidas
 * son las de la plantilla del centro (documentacion/Plantillas/KARDEX1):
 * papel oficio horizontal al 95 %, 21 renglones en el frente y 27 en el
 * reverso. Se puede empezar en el renglón libre de una tarjeta ya usada.
 *
 * ?insumoId=... un producto; sin él, todos los que se movieron en ?periodo=.
 */
const route = useRoute();

const datos = ref(null);
const error = ref('');

// --- Medidas de la plantilla -----------------------------------------------------
const pulgadas = (ancho) => Math.round(ancho * 7 + 5) / 96;
function columnas(anchos) {
  const res = {};
  let x = 0;
  for (const [letra, ancho] of Object.entries(anchos)) {
    res[letra] = { left: x, width: pulgadas(ancho) };
    x += pulgadas(ancho);
  }
  return res;
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
const LADO = {
  frente: {
    margen: { left: 1.52, top: 0.75 },
    col: columnas({ A: 8.71, B: 12.43, C: 26.86, D: 10.71, E: 9.43, F: 8.86, G: 15.43, H: 11.43, I: 9.29, J: 9.29, K: 9.29, L: 9.29, M: 9.29, N: 9.29, O: 9.71 }),
    fila: filas({ 1: 5.25, 2: 36, 3: 26.25, 4: 28.5, 5: 15, 6: 15.75, 7: 18.95, ...Object.fromEntries(Array.from({ length: 21 }, (_, i) => [8 + i, 20.1])) }),
    primera: 8,
    renglones: 21,
    // Fecha, referencia, remitente, entrada (cant, precio, valor), vence, lote, salida, reajuste, saldo (cant, precio), observaciones
    campos: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'],
    obsHasta: 'O',
  },
  reverso: {
    margen: { left: 1.28, top: 0.75 },
    col: columnas({ A: 4.86, B: 8.71, C: 11.43, D: 26.86, E: 10.71, F: 8.86, G: 10, H: 13.29, I: 11.43, J: 10.14, K: 9.29, L: 9.29, M: 9.29, N: 9.29, O: 9.29, P: 9.71 }),
    fila: filas({ 1: 27, ...Object.fromEntries(Array.from({ length: 27 }, (_, i) => [2 + i, 20.1])) }),
    primera: 2,
    renglones: 27,
    campos: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'],
    obsHasta: 'P',
  },
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
    f.observaciones ?? '',
  ];
}
const ALINEAR = ['izq chica', 'centro', 'izq', 'centro', 'centro', 'der', 'centro', 'centro', 'centro', 'centro', 'centro', 'centro', 'izq'];

/** Cada producto en tarjetas: frente y reverso, empezando en el renglón libre. */
const paginas = computed(() => {
  const salida = [];
  const enc = datos.value?.encabezado ?? {};
  for (const t of datos.value?.tarjetas ?? []) {
    const renglones = [];
    if (route.query.periodo && t.saldoAnterior) {
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
    left: `${L.col[letra].left}in`,
    width: `${L.col[hasta].left + L.col[hasta].width - L.col[letra].left}in`,
    top: `${L.fila[fila].top}pt`,
    height: `${L.fila[fila].height}pt`,
  };
};
const producto = (i) => [i.nombreGenerico, i.concentracion, i.presentacion].filter(Boolean).join(', ');

onMounted(async () => {
  try {
    const q = {};
    if (route.query.periodo) q.periodo = route.query.periodo;
    if (route.query.insumoId) q.insumoId = route.query.insumoId;
    datos.value = await bodega.kardex(q);
    registrarImpresion('kardex', `${route.query.periodo ?? 'historia'}${route.query.insumoId ? ` insumo ${route.query.insumoId}` : ''}`);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
</script>

<template>
  <p v-if="error" role="alert" class="no-imprimir p-6 text-red-700">{{ error }}</p>

  <div v-if="datos" class="no-imprimir mx-auto flex max-w-[14in] flex-wrap items-center gap-2 p-4 text-sm">
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
    <button type="button" class="ml-auto rounded bg-black px-3 py-1.5 font-bold text-white" @click="imprimir">Imprimir</button>
    <p class="w-full text-xs text-slate-600">
      Tarjeta en papel oficio horizontal. Las casillas punteadas solo se ven aquí. Para el reverso, voltee la tarjeta y elija "Solo reverso".
    </p>
  </div>
  <p v-if="datos && !paginas.length" class="no-imprimir p-6 text-center">No hay movimientos para imprimir.</p>

  <div v-for="(p, i) in paginas" :key="i" class="pagina" :class="guias ? 'con-guias' : ''">
    <div
      class="forma"
      :style="{ left: `${LADO[p.lado].margen.left}in`, top: `${LADO[p.lado].margen.top}in`, transform: `translate(${ajuste.x}mm, ${ajuste.y}mm) scale(0.95)` }"
    >
      <template v-if="p.lado === 'frente' && p.conEncabezado">
        <div class="celda centro" :style="posicion('frente', 'C', 2, 'H')">{{ producto(p.t.insumo) }}</div>
        <div class="celda centro" :style="posicion('frente', 'C', 3)">{{ p.enc.distrito }}</div>
        <div class="celda centro arial" :style="posicion('frente', 'G', 3)">{{ p.enc.servicio }}</div>
        <div class="celda centro arial" :style="posicion('frente', 'J', 3)">{{ numero(p.enc.nivelMinimo) }}</div>
        <div class="celda der arial" :style="posicion('frente', 'K', 3)">{{ numero(p.enc.nivelMaximo) }}</div>
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
</template>

<style scoped>
.pagina { position: relative; width: 14in; height: 8.5in; margin: 0 auto 16px; background: #fff; color: #000; overflow: hidden; box-shadow: 0 1px 6px rgba(0, 0, 0, .15); }
.forma { position: absolute; transform-origin: 0 0; font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt; width: 12in; height: 7.5in; }
.celda { position: absolute; display: flex; align-items: center; padding: 0 2px; white-space: nowrap; overflow: hidden; line-height: 1.1; }
.centro { justify-content: center; }
.der { justify-content: flex-end; }
.izq { justify-content: flex-start; }
.chica { font-size: 8pt; }
.arial { font-family: Arial, sans-serif; font-size: 10pt; }
.con-guias .celda { outline: 1px dashed #CBD5E1; outline-offset: -1px; }
@media print {
  @page { size: 14in 8.5in; margin: 0; }
  .pagina { margin: 0; box-shadow: none; page-break-after: always; }
  .pagina:last-child { page-break-after: auto; }
  .con-guias .celda { outline: none; }
}
</style>
