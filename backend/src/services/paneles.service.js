const prisma = require('../config/db');
const { obtenerCola, resumenDelDia } = require('./cola.service');
const { alertasDeAtencion } = require('./alertasClinicas.service');
const { INCLUIR_PACIENTE } = require('./cola.service');
const { existenciaTotal, diasParaVencer } = require('./inventario.service');
const { semaforoDelCentro } = require('./abastecimiento.service');
const { evaluarCobertura, excedenteProyectado } = require('./indicadores.service');
const { consumoDiario } = require('./consumo.service');
const { pendienteDe } = require('./dispensacion.service');
const { describirPeriodo } = require('./periodo.service');
const { panelDireccion } = require('./panelDireccion.service');

const MS_POR_DIA = 86400000;

// Horizonte hasta el proximo despacho del almacen departamental.
// PENDIENTE DE CONFIRMAR: el documento habla del "proximo despacho" pero no
// define cada cuanto ocurre. Se asume mensual.
const DIAS_PROXIMO_DESPACHO = 30;

const DIAS_SIN_ATENCION_COMUNIDAD = 30;

function variacion(actual, anterior) {
  if (anterior === 0) return { absoluta: actual, porcentaje: null };
  return {
    absoluta: actual - anterior,
    porcentaje: Math.round(((actual - anterior) / anterior) * 100),
  };
}

async function alertasAbiertas(establecimientoId, tipos = null, limite = 20) {
  return prisma.alerta.findMany({
    where: {
      establecimientoId,
      estado: { not: 'resuelta' },
      ...(tipos ? { tipo: { in: tipos } } : {}),
    },
    include: { usuario: { select: { nombre: true } } },
    orderBy: [{ severidad: 'asc' }, { generadaEn: 'desc' }],
    take: limite,
  });
}

// --- Preconsulta -----------------------------------------------------------

async function panelPreconsulta(establecimientoId, ahora = new Date()) {
  const cola = await obtenerCola(establecimientoId, ahora);

  // Citas programadas para hoy que aun no llegan.
  const inicioDia = new Date(ahora);
  inicioDia.setHours(0, 0, 0, 0);
  const finDia = new Date(inicioDia.getTime() + MS_POR_DIA);

  const citasHoy = await prisma.atencion.findMany({
    where: {
      establecimientoId,
      estado: { not: 'cancelada' },
      proximaCita: { gte: inicioDia, lt: finDia },
    },
    include: { paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true, expedientePapel: true, comunidad: true } } },
  });

  // Se descartan los que ya llegaron hoy.
  const idsEnCola = new Set([
    ...cola.cola.map((e) => e.paciente.id),
    ...cola.enAtencion.map((e) => e.paciente.id),
  ]);

  const pendientesDeLlegar = [];
  for (const cita of citasHoy) {
    if (idsEnCola.has(cita.pacienteId)) continue;
    const yaVino = await prisma.atencion.findFirst({
      where: { pacienteId: cita.pacienteId, registradaEn: { gte: inicioDia } },
    });
    if (yaVino) continue;

    pendientesDeLlegar.push({
      pacienteId: cita.paciente.id,
      expediente: cita.paciente.expediente,
      expedientePapel: cita.paciente.expedientePapel,
      nombreCompleto: `${cita.paciente.apellidos}, ${cita.paciente.nombres}`,
      comunidad: cita.paciente.comunidad,
      proximaCita: cita.proximaCita,
    });
  }

  return {
    rol: 'preconsulta',
    cola: cola.cola.slice(0, 10),
    resumen: cola.resumen,
    jornada: cola.jornada,
    // Advertencia visible, no escondida en una tabla.
    advertencia:
      cola.resumen.superan90 > 0
        ? `${cola.resumen.superan90} paciente(s) llevan más de 90 minutos esperando. El más antiguo: ${cola.resumen.esperaMaxima} minutos`
        : null,
    citasDeHoySinLlegar: pendientesDeLlegar,
  };
}

// --- Medico ----------------------------------------------------------------

async function panelMedico(establecimientoId, ahora = new Date()) {
  const [cola, resumenDia] = await Promise.all([
    obtenerCola(establecimientoId, ahora),
    resumenDelDia(establecimientoId, ahora),
  ]);

  // Tarjeta del siguiente paciente: el que esta en atencion, o el primero
  // de la cola si la clinica esta libre.
  let siguiente = null;
  const enAtencion = await prisma.atencion.findFirst({
    where: { establecimientoId, estado: 'en_atencion' },
    include: INCLUIR_PACIENTE,
  });

  const objetivo =
    enAtencion ??
    (cola.cola.length > 0
      ? await prisma.atencion.findUnique({ where: { id: cola.cola[0].id }, include: INCLUIR_PACIENTE })
      : null);

  if (objetivo) {
    const { alertas } = await alertasDeAtencion(objetivo, ahora);
    siguiente = {
      atencion: {
        id: objetivo.id,
        estado: objetivo.estado,
        gravedad: objetivo.gravedad,
        motivoConsulta: objetivo.motivoConsulta,
        registradaEn: objetivo.registradaEn,
      },
      paciente: {
        id: objetivo.paciente.id,
        expediente: objetivo.paciente.expediente,
        expedientePapel: objetivo.paciente.expedientePapel,
        nombreCompleto: `${objetivo.paciente.apellidos}, ${objetivo.paciente.nombres}`,
        fechaNacimiento: objetivo.paciente.fechaNacimiento,
        comunidad: objetivo.paciente.comunidad,
        condiciones: objetivo.paciente.condiciones.map((c) => c.tipo),
      },
      preconsulta: objetivo.preconsulta,
      alertas,
    };
  }

  // Lo ya atendido hoy: da contexto de la jornada sin cambiar de pantalla.
  const inicioHoy = new Date(ahora);
  inicioHoy.setHours(0, 0, 0, 0);

  const atendidosHoy = await prisma.atencion.findMany({
    where: { establecimientoId, estado: 'atendido', cerradaEn: { gte: inicioHoy } },
    orderBy: { cerradaEn: 'desc' },
    take: 8,
    select: {
      id: true,
      gravedad: true,
      diagnosticoCie: true,
      diagnosticoTxt: true,
      iniciadaEn: true,
      cerradaEn: true,
      paciente: { select: { id: true, nombres: true, apellidos: true } },
    },
  });

  return {
    rol: 'medico',
    siguiente,
    atendidosHoy: atendidosHoy.map((a) => ({
      id: a.id,
      gravedad: a.gravedad,
      diagnosticoCie: a.diagnosticoCie,
      diagnosticoTxt: a.diagnosticoTxt,
      cerradaEn: a.cerradaEn,
      duracionMin:
        a.iniciadaEn && a.cerradaEn
          ? Math.round((new Date(a.cerradaEn) - new Date(a.iniciadaEn)) / 60000)
          : null,
      paciente: {
        id: a.paciente.id,
        nombreCompleto: `${a.paciente.apellidos}, ${a.paciente.nombres}`,
      },
    })),
    // El medico necesita ver a quien sigue sin cambiar de pantalla.
    cola: cola.cola.slice(0, 6),
    enEspera: cola.resumen.enEspera,
    esperaMaxima: cola.resumen.esperaMaxima,
    superan90: cola.resumen.superan90,
    jornada: cola.jornada,
    // Al vaciarse la cola, el resumen del dia es lo que queda en pantalla.
    resumenDia,
    colaVacia: cola.resumen.enEspera === 0 && !enAtencion,
  };
}

// --- Farmacia --------------------------------------------------------------

async function panelFarmacia(establecimientoId, ahora = new Date()) {
  const colorDe = await semaforoDelCentro(establecimientoId);
  const insumos = await prisma.insumo.findMany({
    where: { establecimientoId, activo: true },
    include: { lotes: true },
  });

  const requierenAccion = [];
  const lotesEnVentana = [];

  for (const insumo of insumos) {
    const saldo = existenciaTotal(insumo.lotes, ahora);
    const consumo = await consumoDiario(insumo.id, ahora);
    const cobertura = evaluarCobertura({
      saldoTotal: saldo,
      consumoDiario: consumo.consumoDia,
      diasHistorial: consumo.diasHistorial,
    });

    if (saldo === 0 || (cobertura.calculable && cobertura.critica) || saldo < insumo.stockMinimo) {
      requierenAccion.push({
        insumoId: insumo.id,
        nombreGenerico: insumo.nombreGenerico,
        unidadMedida: insumo.unidadMedida,
        saldoTotal: saldo,
        stockMinimo: insumo.stockMinimo,
        cobertura,
      });
    }

    for (const lote of insumo.lotes) {
      if (lote.cantidadActual <= 0) continue;
      const semaforo = colorDe(lote.fechaVence, ahora);
      if (semaforo === 'verde') continue;

      lotesEnVentana.push({
        loteId: lote.id,
        insumoId: insumo.id,
        nombreGenerico: insumo.nombreGenerico,
        numeroLote: lote.numeroLote,
        fechaVence: lote.fechaVence,
        diasParaVencer: diasParaVencer(lote.fechaVence, ahora),
        cantidadActual: lote.cantidadActual,
        semaforo,
        excedenteProyectado: consumo.historialSuficiente
          ? excedenteProyectado(lote.cantidadActual, consumo.consumoDia, lote.fechaVence, ahora)
          : null,
      });
    }
  }

  // Prescripciones pendientes de entrega.
  const prescripciones = await prisma.prescripcion.findMany({
    where: { atencion: { establecimientoId } },
    orderBy: { creadaEn: 'desc' },
    take: 200,
    include: {
      dispensaciones: true,
      demandaNoAtendida: { select: { cantidad: true } },
      insumo: { select: { id: true, nombreGenerico: true, unidadMedida: true } },
      atencion: {
        select: { paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true, expedientePapel: true } } },
      },
    },
  });

  const pendientes = prescripciones
    .map((p) => ({ p, pendiente: pendienteDe(p) }))
    .filter((x) => x.pendiente > 0)
    .map(({ p, pendiente }) => ({
      prescripcionId: p.id,
      pendiente,
      insumo: p.insumo,
      paciente: {
        id: p.atencion.paciente.id,
        expediente: p.atencion.paciente.expediente,
        expedientePapel: p.atencion.paciente.expedientePapel,
        nombreCompleto: `${p.atencion.paciente.apellidos}, ${p.atencion.paciente.nombres}`,
      },
    }));

  // Diferencia de inventario del mes con el insumo de mayor discrepancia.
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const ajustes = await prisma.movimientoInsumo.findMany({
    // Solo cuentan los reajustes que vienen de un conteo fisico: los demas
    // son movimientos normales, no diferencias de inventario.
    where: {
      tipo: 'reajuste',
      causa: { in: ['sobrante_inventario_fisico', 'faltante_inventario_fisico'] },
      registradoEn: { gte: inicioMes },
      lote: { insumo: { establecimientoId } },
    },
    include: { lote: { include: { insumo: { select: { id: true, nombreGenerico: true } } } } },
  });

  const porInsumo = new Map();
  for (const a of ajustes) {
    const i = a.lote.insumo;
    const actual = porInsumo.get(i.id) ?? { insumo: i, diferenciaNeta: 0, absoluta: 0 };
    actual.diferenciaNeta += a.cantidad;
    actual.absoluta += Math.abs(a.cantidad);
    porInsumo.set(i.id, actual);
  }
  const ordenados = [...porInsumo.values()].sort((a, b) => b.absoluta - a.absoluta);

  return {
    rol: 'farmacia',
    requierenAccion: {
      insumos: requierenAccion.sort((a, b) => (a.cobertura.dias ?? 0) - (b.cobertura.dias ?? 0)),
      lotes: lotesEnVentana.sort((a, b) => a.diasParaVencer - b.diasParaVencer),
    },
    prescripcionesPendientes: pendientes,
    diferenciasDelMes: {
      desde: inicioMes,
      totalAjustes: ajustes.length,
      diferenciaNeta: ajustes.reduce((s, a) => s + a.cantidad, 0),
      mayorDiscrepancia: ordenados[0] ?? null,
    },
    alertas: await alertasAbiertas(establecimientoId, ['existencia_baja', 'vencimiento']),
  };
}

// --- Administrador ---------------------------------------------------------

async function panelAdmin(establecimientoId, ahora = new Date(), periodo = 'semana') {
  // Todo el panel viaja en una sola respuesta: quien entra a ver como va el
  // establecimiento no deberia esperar a que se completen cuatro peticiones.
  const panel = await panelDireccion(establecimientoId, ahora, periodo);

  // Consultas cerradas sin codigo CIE-10. Cerrar no exige el codigo para no
  // detener la atencion, pero el consolidado SIGSA si lo necesita: aqui queda
  // la lista para completarlas.
  const pendientesDeCodificar = await prisma.atencion.findMany({
    where: { establecimientoId, estado: 'atendido', diagnosticoCie: null },
    select: {
      id: true,
      diagnosticoTxt: true,
      cerradaEn: true,
      paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true, expedientePapel: true } },
    },
    orderBy: { cerradaEn: 'desc' },
    take: 50,
  });

  return {
    rol: 'admin',
    ...panel,
    pendientesDeCodificar,
    alertas: await alertasAbiertas(establecimientoId),
  };
}

const PANELES = {
  preconsulta: panelPreconsulta,
  medico: panelMedico,
  farmacia: panelFarmacia,
  // Bodega ve lo mismo que farmacia: existencias, vencimientos y diferencias.
  bodega: panelFarmacia,
  admin: panelAdmin,
};

module.exports = {
  DIAS_PROXIMO_DESPACHO,
  DIAS_SIN_ATENCION_COMUNIDAD,
  PANELES,
  variacion,
  alertasAbiertas,
  panelPreconsulta,
  panelMedico,
  panelFarmacia,
  panelAdmin,
};
