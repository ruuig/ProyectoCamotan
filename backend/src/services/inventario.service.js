// Logica de inventario. Funciones puras: reciben lotes, devuelven decisiones.
// Sin acceso a base de datos.

// Ventana de alerta de vencimiento por categoria, en meses.
const VENTANA_MESES = {
  biologico: 6,
  medicamento: 3,
  material_curacion: 2,
  uso_unico: 2,
};

const DIAS_POR_MES = 30.4375; // 365.25 / 12

// El unico estado del que se puede entregar.
const ESTADO_DISPONIBLE = 'disponible';
const MS_POR_DIA = 86400000;

function ventanaDias(categoria) {
  const meses = VENTANA_MESES[categoria];
  return meses === undefined ? null : Math.round(meses * DIAS_POR_MES);
}

function diasParaVencer(fechaVence, ahora = new Date()) {
  return Math.floor((new Date(fechaVence) - new Date(ahora)) / MS_POR_DIA);
}

/**
 * Semaforo de vencimiento:
 * verde fuera de la ventana, amarillo dentro,
 * rojo a menos de un tercio de la ventana o ya vencido.
 */
function semaforoVencimiento(fechaVence, categoria, ahora = new Date()) {
  const dias = diasParaVencer(fechaVence, ahora);
  const ventana = ventanaDias(categoria);

  if (dias <= 0) return 'rojo';
  if (ventana === null) return 'verde'; // categoria sin ventana definida
  if (dias <= ventana / 3) return 'rojo';
  if (dias <= ventana) return 'amarillo';
  return 'verde';
}

function dentroDeVentana(fechaVence, categoria, ahora = new Date()) {
  return semaforoVencimiento(fechaVence, categoria, ahora) !== 'verde';
}

// --- FEFO ----------------------------------------------------------------

/**
 * Lotes de los que se puede entregar hoy, ordenados por vencimiento.
 *
 * El estado manda: un lote en cuarentena o retirado esta fisicamente en la
 * bodega pero no se puede entregar. Si no se filtrara aqui, PEPE propondria
 * el lote en cuarentena por vencer primero, la entrega fallaria, y los
 * paneles contarian como existencia algo que no se puede dar.
 *
 * Esta es la unica definicion de "disponible" del sistema: todo lo que mide
 * saldo utilizable pasa por aqui.
 */
function lotesDisponibles(lotes, ahora = new Date()) {
  return lotes
    .filter(
      (l) =>
        l.estado === ESTADO_DISPONIBLE
        && l.cantidadActual > 0
        && new Date(l.fechaVence) > new Date(ahora),
    )
    .sort((a, b) => new Date(a.fechaVence) - new Date(b.fechaVence));
}

/**
 * First Expired, First Out: propone el lote de vencimiento mas proximo
 * con existencia suficiente. Si ninguno alcanza solo, se fracciona.
 */
function seleccionarLoteFEFO(lotes, cantidadRequerida, ahora = new Date()) {
  const disponibles = lotesDisponibles(lotes, ahora);

  const suficiente = disponibles.find((l) => l.cantidadActual >= cantidadRequerida);
  if (suficiente) return { lote: suficiente, requiereFraccionamiento: false };

  return { lotes: disponibles, requiereFraccionamiento: true };
}

/**
 * Reparte la cantidad entre varios lotes en orden FEFO.
 * Devuelve null si la existencia total no alcanza: no se dispensa de mas.
 */
function planFraccionamiento(lotes, cantidadRequerida, ahora = new Date()) {
  const disponibles = lotesDisponibles(lotes, ahora);
  const total = disponibles.reduce((suma, l) => suma + l.cantidadActual, 0);

  if (total < cantidadRequerida) return null;

  const plan = [];
  let restante = cantidadRequerida;

  for (const lote of disponibles) {
    if (restante <= 0) break;
    const tomar = Math.min(lote.cantidadActual, restante);
    plan.push({ loteId: lote.id, lote, cantidad: tomar });
    restante -= tomar;
  }

  return plan;
}

/**
 * Indica si el lote elegido a mano coincide con el que propone FEFO.
 * Si no coincide, el sistema exige motivo escrito.
 */
function esLoteFEFO(loteId, lotes, cantidadRequerida, ahora = new Date()) {
  const propuesta = seleccionarLoteFEFO(lotes, cantidadRequerida, ahora);

  if (!propuesta.requiereFraccionamiento) return propuesta.lote.id === loteId;

  // Fraccionando, el primero del reparto es el que FEFO habria usado.
  const disponibles = lotesDisponibles(lotes, ahora);
  return disponibles.length > 0 && disponibles[0].id === loteId;
}

function existenciaTotal(lotes, ahora = new Date()) {
  return lotesDisponibles(lotes, ahora).reduce((suma, l) => suma + l.cantidadActual, 0);
}

module.exports = {
  ESTADO_DISPONIBLE,
  VENTANA_MESES,
  DIAS_POR_MES,
  ventanaDias,
  diasParaVencer,
  semaforoVencimiento,
  dentroDeVentana,
  lotesDisponibles,
  seleccionarLoteFEFO,
  planFraccionamiento,
  esLoteFEFO,
  existenciaTotal,
};
