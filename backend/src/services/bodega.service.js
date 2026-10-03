/**
 * Reglas de la bodega del centro, tal como trabaja hoy con sus Excel
 * (MD/Bodega.md): categorias con su color, semaforo con los rangos del
 * centro, el balance y el BRES con la formula del centro, la propuesta de
 * distribucion a los servicios y el reporte mensual de cada servicio.
 *
 * Funciones puras: no tocan la base.
 */

const { normalizarTexto } = require('./pacientes.service');

const MS_POR_DIA = 86400000;
const DIAS_POR_MES = 30.4375;

// --- Categorias -----------------------------------------------------------------
// Con el color que ya usa el centro. "Para eliminar" (negro) es un insumo
// inactivo, no una categoria.
const CATEGORIAS = [
  { clave: 'medicamentos', etiqueta: 'Medicamentos', color: 'azul' },
  { clave: 'suplementos', etiqueta: 'Suplementos', color: 'naranja' },
  { clave: 'planificacion_familiar', etiqueta: 'Planificación familiar', color: 'morado' },
  { clave: 'medico_quirurgico', etiqueta: 'Médico quirúrgico', color: 'verde' },
  { clave: 'laboratorio', etiqueta: 'Laboratorio', color: 'amarillo' },
  { clave: 'tuberculosis', etiqueta: 'Tuberculosis', color: 'rojo' },
];
const CLAVES_CATEGORIA = CATEGORIAS.map((c) => c.clave);
const ORDEN_CATEGORIA = new Map(CATEGORIAS.map((c, i) => [c.clave, i]));

/**
 * Orden de una lista de insumos: alfabetico, por categoria (y dentro,
 * alfabetico), por existencia, por meses de existencia o por semaforo.
 */
function ordenarInsumos(lista, orden = 'alfabetico') {
  const nombre = (a, b) => (a.nombre ?? a.nombreGenerico ?? '').localeCompare(b.nombre ?? b.nombreGenerico ?? '', 'es');
  const PESO_SEMAFORO = { vencido: 0, rojo: 1, amarillo: 2, verde: 3, sin_lotes: 4 };
  const comparar = {
    alfabetico: nombre,
    categoria: (a, b) => (ORDEN_CATEGORIA.get(a.categoria) ?? 99) - (ORDEN_CATEGORIA.get(b.categoria) ?? 99) || nombre(a, b),
    existencia: (a, b) => (a.existencia ?? 0) - (b.existencia ?? 0) || nombre(a, b),
    meses: (a, b) => (a.mesesExistencia ?? Infinity) - (b.mesesExistencia ?? Infinity) || nombre(a, b),
    semaforo: (a, b) => (PESO_SEMAFORO[a.semaforo] ?? 9) - (PESO_SEMAFORO[b.semaforo] ?? 9) || nombre(a, b),
  }[orden] ?? nombre;
  return [...lista].sort(comparar);
}

/** Clave con que se compara un alias ("Condón masculino, unidad" = "CONDON MASCULINO UNIDAD"). */
function normalizarAlias(texto) {
  return normalizarTexto(texto);
}

// --- Semaforo ---------------------------------------------------------------------

/** Rangos del Centro de Salud de Camotan, en meses. Configurables. */
const RANGOS_CENTRO = { rojo: 12, amarillo: 18 };

function mesesParaVencer(fechaVence, ahora = new Date()) {
  return (new Date(fechaVence) - new Date(ahora)) / (DIAS_POR_MES * MS_POR_DIA);
}

/**
 * Semaforo de un lote con los rangos del centro: rojo a menos de 12 meses,
 * amarillo de 12 a 18, verde a mas de 18. Lo ya vencido va aparte: no es un
 * color mas, esta bloqueado para entrega.
 */
function semaforoBodega(fechaVence, ahora = new Date(), rangos = RANGOS_CENTRO) {
  const meses = mesesParaVencer(fechaVence, ahora);
  if (meses < 0) return 'vencido';
  if (meses < rangos.rojo) return 'rojo';
  if (meses <= rangos.amarillo) return 'amarillo';
  return 'verde';
}

// --- Lote ----------------------------------------------------------------------------

/**
 * Validaciones de fechas al recibir un lote. El vencimiento no puede ser
 * anterior a la fabricacion ni a hoy; si vence en menos de 3 meses, se avisa
 * (no se impide: a veces es lo unico que mando el area de salud).
 */
function validarFechasLote({ fechaVence, fechaFabricacion }, ahora = new Date()) {
  const errores = [];
  const avisos = [];
  const vence = new Date(fechaVence);
  if (fechaFabricacion && new Date(fechaFabricacion) > vence) {
    errores.push('La fecha de vencimiento no puede ser anterior a la de fabricación');
  }
  if (fechaFabricacion && new Date(fechaFabricacion) > new Date(ahora)) {
    errores.push('La fecha de fabricación no puede ser futura');
  }
  if (vence < new Date(ahora)) {
    errores.push('El lote ya está vencido: no se puede recibir');
  } else if (mesesParaVencer(vence, ahora) < 3) {
    avisos.push('Este lote vence en menos de 3 meses');
  }
  return { errores, avisos };
}

// --- Traslados ---------------------------------------------------------------------

function numeroTraslado(anio, correlativo) {
  return `TRA-${anio}-${String(correlativo).padStart(4, '0')}`;
}

/**
 * Lotes que se proponen para trasladar una cantidad, por PEPE: primero el
 * que vence primero. Solo lotes disponibles y no vencidos.
 */
function lotesPepe(lotes, cantidad, ahora = new Date()) {
  const usables = lotes
    .filter((l) => l.estado === 'disponible' && l.cantidadActual > 0 && new Date(l.fechaVence) >= new Date(ahora))
    .sort((a, b) => new Date(a.fechaVence) - new Date(b.fechaVence));
  const propuesta = [];
  let falta = cantidad;
  for (const l of usables) {
    if (falta <= 0) break;
    const toma = Math.min(l.cantidadActual, falta);
    propuesta.push({ loteId: l.id, numeroLote: l.numeroLote, fechaVence: l.fechaVence, cantidad: toma });
    falta -= toma;
  }
  return { propuesta, faltante: Math.max(0, falta) };
}

/**
 * Propuesta de distribucion de un insumo entre los servicios.
 *
 * iguales: la cantidad entre el numero de servicios, como hoy.
 * consumo: en proporcion al promedio de entregas reportadas por cada uno.
 *
 * En ambos modos se redondea hacia abajo a multiplos del empaque: no se
 * manda media caja. Lo que sobra por el redondeo queda en bodega.
 *
 * servicios: [{ id, nombre, promedio }]
 */
function propuestaDistribucion({ cantidad, servicios, modo = 'iguales', empaque = 1 }) {
  const n = servicios.length;
  if (n === 0 || cantidad <= 0) {
    return { modo, filas: [], asignado: 0, sobrante: Math.max(0, cantidad), aviso: null };
  }

  const redondear = (x) => Math.floor(x / empaque) * empaque;
  let aviso = null;
  let pesos;
  const totalConsumo = servicios.reduce((s, x) => s + (x.promedio ?? 0), 0);

  if (modo === 'consumo' && totalConsumo > 0) {
    pesos = servicios.map((s) => (s.promedio ?? 0) / totalConsumo);
  } else {
    if (modo === 'consumo') aviso = 'Ningún servicio tiene entregas reportadas: se reparte en partes iguales';
    pesos = servicios.map(() => 1 / n);
  }

  const filas = servicios.map((s, i) => ({
    ubicacionId: s.id,
    nombre: s.nombre,
    promedio: s.promedio ?? 0,
    cantidad: redondear(cantidad * pesos[i]),
  }));
  const asignado = filas.reduce((s, f) => s + f.cantidad, 0);
  return { modo: aviso ? 'iguales' : modo, filas, asignado, sobrante: cantidad - asignado, aviso };
}

// --- Reporte mensual de un servicio -------------------------------------------------

/**
 * Un renglon del reporte: saldo siguiente calculado y diferencias contra lo
 * que reporta el servicio (saldo y entradas).
 */
function filaReporte({ saldoAnterior = 0, entradas = 0, entregado = 0, noEntregado = 0, saldoReportado = null, entradasReportadas = null }) {
  const saldoSiguiente = saldoAnterior + entradas - entregado;
  const vacio = (v) => v === null || v === undefined || v === '';
  return {
    saldoAnterior,
    entradas,
    entregado,
    noEntregado,
    saldoSiguiente,
    saldoReportado: vacio(saldoReportado) ? null : saldoReportado,
    entradasReportadas: vacio(entradasReportadas) ? null : entradasReportadas,
    diferenciaSaldo: vacio(saldoReportado) ? null : saldoReportado - saldoSiguiente,
    diferenciaEntradas: vacio(entradasReportadas) ? null : entradasReportadas - entradas,
    negativo: saldoSiguiente < 0,
  };
}

// --- Periodos ----------------------------------------------------------------------

function periodoAnterior(periodo, meses = 1) {
  const [anio, mes] = periodo.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1 - meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Los n periodos que terminan en el dado, del mas antiguo al mas reciente. */
function ultimosPeriodos(periodo, n) {
  return Array.from({ length: n }, (_, i) => periodoAnterior(periodo, n - 1 - i));
}

// --- Balance y BRES con la formula del centro -----------------------------------------

/**
 * Una fila del BRES (columnas B a M de MD/Bodega.md seccion 7).
 *
 * B saldo anterior del municipio, C entradas a bodega, D entregado (centro +
 * servicios), E no entregado, G reajustes, I existencia fisica en bodega,
 * demandas: demanda (D + E) de los meses del promedio, incluido el actual.
 */
function filaBres({ B, C, D, E, G, I, demandas, config }) {
  const F = D + E;
  const H = B + C - D + G;
  const conDatos = demandas.filter((d) => d !== null && d !== undefined);
  const J = conDatos.length ? conDatos.reduce((s, d) => s + d, 0) / conDatos.length : 0;
  const K = J > 0 ? H / J : null;
  const L = J * config.nivelMaximoMeses;
  const minimo = J * config.nivelMinimoMeses;
  // El centro resta la existencia de bodega; el MSPAS, el saldo total.
  const restar = config.formulaPedido === 'mspas' ? H : I;
  const M = Math.max(0, Math.ceil(L - restar));
  return {
    B, C, D, E, F, G, H, I,
    J: Math.round(J * 100) / 100,
    K: K === null ? null : Math.round(K * 10) / 10,
    L: Math.ceil(L),
    M,
    minimo: Math.ceil(minimo),
    bajoMinimo: J > 0 && H < minimo,
    sinConsumo: J === 0,
    mesesConDatos: conDatos.length,
  };
}

module.exports = {
  CATEGORIAS,
  CLAVES_CATEGORIA,
  ordenarInsumos,
  normalizarAlias,
  RANGOS_CENTRO,
  mesesParaVencer,
  semaforoBodega,
  validarFechasLote,
  numeroTraslado,
  lotesPepe,
  propuestaDistribucion,
  filaReporte,
  periodoAnterior,
  ultimosPeriodos,
  filaBres,
};
