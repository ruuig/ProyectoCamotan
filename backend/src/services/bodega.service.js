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
// Se usan en el servicio y no se entregan al paciente: un insumo nuevo de
// estas categorias no aparece en la receta del medico.
const CATEGORIAS_NO_PRESCRIBIBLES = ['medico_quirurgico', 'laboratorio'];
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
  const esUsable = (lote) => lote.estado === 'disponible'
    && lote.cantidadActual > 0
    && new Date(lote.fechaVence) >= new Date(ahora);
  const usables = lotes
    .filter(esUsable)
    .sort((loteA, loteB) => new Date(loteA.fechaVence) - new Date(loteB.fechaVence));

  const propuesta = [];
  let pendiente = cantidad;
  for (const lote of usables) {
    if (pendiente <= 0) break;
    const cantidadDelLote = Math.min(lote.cantidadActual, pendiente);
    propuesta.push({ loteId: lote.id, numeroLote: lote.numeroLote, fechaVence: lote.fechaVence, cantidad: cantidadDelLote });
    pendiente -= cantidadDelLote;
  }
  return { propuesta, faltante: Math.max(0, pendiente) };
}

/**
 * Propuesta de distribucion de un insumo entre los servicios.
 *
 * iguales: la cantidad entre los lugares del centro (lugares, 32 por
 *   defecto), como la columna "Saldo Actual / 32" del inventario de cierre:
 *   cuanto le toca a cada lugar. Si hay menos servicios que lugares, lo de
 *   los lugares que sobran se queda en bodega.
 * consumo: en proporcion al promedio de entregas reportadas por cada uno.
 *
 * Por lugar se redondea al entero, como lo muestra el Excel; con empaque se
 * baja al multiplo del empaque: no se manda media caja. Nunca se reparte mas
 * de lo que hay.
 *
 * servicios: [{ id, nombre, promedio }]
 */
function propuestaDistribucion({ cantidad, servicios, modo = 'iguales', empaque = 1, lugares = null }) {
  const n = servicios.length;
  if (n === 0 || cantidad <= 0) {
    return { modo, filas: [], asignado: 0, sobrante: Math.max(0, cantidad), aviso: null };
  }

  const haciaAbajo = (x) => Math.floor(x / empaque) * empaque;
  const redondear = (x) => (empaque > 1 ? haciaAbajo(x) : Math.round(x));
  let aviso = null;
  let pesos;
  const totalConsumo = servicios.reduce((s, x) => s + (x.promedio ?? 0), 0);

  if (modo === 'consumo' && totalConsumo > 0) {
    pesos = servicios.map((s) => (s.promedio ?? 0) / totalConsumo);
  } else {
    if (modo === 'consumo') aviso = 'Ningún servicio tiene entregas reportadas: se reparte en partes iguales';
    const entre = Math.max(n, lugares ?? n);
    pesos = servicios.map(() => 1 / entre);
  }

  let filas = servicios.map((s, i) => ({
    ubicacionId: s.id,
    nombre: s.nombre,
    promedio: s.promedio ?? 0,
    cantidad: redondear(cantidad * pesos[i]),
  }));
  // Redondear al entero puede pasarse de lo que hay: entonces, hacia abajo.
  if (filas.reduce((s, f) => s + f.cantidad, 0) > cantidad) {
    filas = filas.map((f, i) => ({ ...f, cantidad: haciaAbajo(cantidad * pesos[i]) }));
  }
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
 * Una fila de los totales del balance (columnas B a M de MD/Bodega.md
 * seccion 7), con las mismas formulas del Excel del centro:
 *
 *   B saldo anterior: el saldo siguiente (H) del mes previo.
 *   C entradas a bodega.   D entregado (post-consulta + servicios).
 *   E no entregado.        F demanda = D + E.
 *   saldo x demanda = B + C - D: lo que deberia haber; si no coincide con H,
 *     algo no se reporto.
 *   H saldo siguiente = la suma de los saldos de cada servicio (post-consulta
 *     incluida) mas la existencia fisica en bodega (I): lo que hay.
 *   J promedio = la suma del promedio de cada servicio.
 *   K meses de existencia = H / J.   L maximo = J x nivel maximo.
 *   M cantidad a solicitar = L - I (el MSPAS resta H). Negativa si sobra: el
 *     balance la muestra asi, y el formulario de pedido la toma como cero.
 *
 * saldos: saldo siguiente de cada servicio. promedios: el de cada servicio.
 */
function filaBres({ B, C, D, E, G = 0, I, saldos, promedios, config }) {
  const F = D + E;
  const H = saldos.reduce((s, x) => s + x, 0) + I;
  const J = promedios.reduce((s, x) => s + x, 0);
  const K = J > 0 ? H / J : null;
  const L = J * config.nivelMaximoMeses;
  const minimo = J * config.nivelMinimoMeses;
  const restar = config.formulaPedido === 'mspas' ? H : I;
  const M = L - restar;
  return {
    B, C, D, E, F, G, H, I, J, K, L, M,
    saldoPorDemanda: B + C - D,
    minimo: Math.ceil(minimo),
    bajoMinimo: J > 0 && H < minimo,
    sinConsumo: J === 0,
    mesesConDatos: promedios.length,
  };
}

/**
 * Situacion de un insumo en el BRES, la misma que muestra Existencias:
 * agotado es la bodega en cero teniendo consumo; bajo es el municipio por
 * debajo del minimo. Sin consumo no se juzga: no hay contra que medir.
 */
function situacionBres(bres) {
  if (bres.sinConsumo) return 'sin_consumo';
  if (bres.I === 0) return 'agotado';
  if (bres.bajoMinimo) return 'bajo';
  return 'bien';
}

module.exports = {
  situacionBres,
  CATEGORIAS,
  CLAVES_CATEGORIA,
  CATEGORIAS_NO_PRESCRIBIBLES,
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
