const prisma = require('../config/db');
const { semaforoBodega } = require('../services/bodega.service');
const {
  mesesParaVencer,
  excedenteAlVencer,
} = require('../services/logistica.service');
const abastecimiento = require('../services/abastecimiento.service');
const { diagnosticosRepetidos } = require('../services/alertasClinicas.service');
const { vencerEpisodios } = require('../controllers/embarazo.controller');

const INTERVALO_MS = 60 * 60 * 1000; // cada hora
const MS_POR_DIA = 86400000;

// Un caso de desnutricion sin control en este plazo es el hallazgo de mas
// valor del sistema: identifica al nino que dejo de asistir estando enfermo.
const DIAS_SIN_CONTROL = 30;

// Una comunidad sin atenciones en este plazo se vuelve una decision: hay que
// programar una visita. Pasado el doble, deja de ser un descuido y pasa a ser
// un vacio de cobertura.
const DIAS_SIN_ATENCION_COMUNIDAD = 30;
const DIAS_COBERTURA_GRAVE = 60;

/**
 * Crea o actualiza una alerta abierta. Es idempotente: al correr cada hora
 * no acumula duplicados, gracias al indice unico parcial sobre las que no
 * estan resueltas (establecimiento, tipo, entidad).
 *
 * Si alguien ya actuo sobre ella, el estado no se toca: que el suero siga
 * faltando no borra que el despacho ya se solicito.
 */
async function registrarAlerta({ establecimientoId, tipo, severidad, entidadTipo, entidadId, mensaje }) {
  const existente = await prisma.alerta.findFirst({
    where: { establecimientoId, tipo, entidadTipo, entidadId, estado: { not: 'resuelta' } },
  });

  if (existente) {
    if (existente.mensaje === mensaje && existente.severidad === severidad) return existente;
    return prisma.alerta.update({
      where: { id: existente.id },
      data: { mensaje, severidad, generadaEn: new Date() },
    });
  }

  return prisma.alerta.create({
    data: { establecimientoId, tipo, severidad, entidadTipo, entidadId, mensaje },
  });
}

/**
 * Cierra las alertas de un tipo cuya causa ya no existe.
 *
 * Esto es lo que hace que nadie tenga que "marcar atendida" una alerta de
 * existencia: llega el despacho, el saldo sube, y en la siguiente pasada la
 * alerta se resuelve sola. Sin usuario, porque no la cerro una persona.
 */
async function cerrarResueltas(establecimientoId, tipo, idsVigentes, ahora = new Date()) {
  await prisma.alerta.updateMany({
    where: {
      establecimientoId,
      tipo,
      estado: { not: 'resuelta' },
      ...(idsVigentes.length > 0 ? { NOT: { entidadId: { in: idsVigentes } } } : {}),
    },
    data: { estado: 'resuelta', estadoEn: ahora, estadoPor: null },
  });
}

// --- Inventario ------------------------------------------------------------

/**
 * Alertas de inventario segun el MSPAS.
 *
 * El cambio de fondo frente a lo anterior: el minimo ya no es un numero fijo
 * igual para todos los insumos, sino el que resulta del propio consumo de
 * cada uno (PMDR por el nivel minimo). Asi, un insumo de mucho movimiento
 * avisa antes que uno que casi no se usa, aunque los dos tengan el mismo
 * saldo.
 */
async function evaluarInventario(establecimientoId, ahora) {
  const evaluacion = await abastecimiento.evaluarTodos(establecimientoId, ahora);
  const config = evaluacion.configuracion;

  const conExistenciaBaja = [];
  const conDesabastecimiento = [];
  const conVencimiento = [];
  const conCuarentena = [];

  for (const fila of evaluacion.filas) {
    const insumo = await prisma.insumo.findUnique({
      where: { id: fila.insumoId },
      include: { lotes: true },
    });
    if (!insumo) continue;

    // Desabastecimiento: en cero y con demanda reciente. Que no haya de algo
    // que nadie pide no le hace falta a nadie.
    if (fila.desabastecido) {
      await registrarAlerta({
        establecimientoId,
        tipo: 'desabastecimiento',
        severidad: 'alta',
        entidadTipo: 'insumo',
        entidadId: insumo.id,
        mensaje: `${insumo.nombreGenerico}: sin existencia, con demanda de ${Math.round(fila.pmdr)} al mes`,
      });
      conDesabastecimiento.push(insumo.id);
    } else if (fila.bajoMinimo) {
      // Bajo la cantidad minima calculada con su propio consumo.
      const meses = fila.med === null ? null : Number(fila.med.toFixed(1));
      await registrarAlerta({
        establecimientoId,
        tipo: 'existencia_baja',
        severidad: meses !== null && meses < 1 ? 'alta' : 'media',
        entidadTipo: 'insumo',
        entidadId: insumo.id,
        mensaje:
          `${insumo.nombreGenerico}: ${fila.saldo} ${insumo.unidadEntrega}`
          + (meses === null ? '' : `, ${meses} mes(es) de existencia`)
          + `, bajo el mínimo de ${fila.cantidadMinima}`,
      });
      conExistenciaBaja.push(insumo.id);
    } else if (!(fila.pmdr > 0) && insumo.stockMinimo > 0 && fila.saldo < insumo.stockMinimo) {
      // Sin historia de demanda no se puede calcular el minimo del MSPAS. El
      // minimo fijo del insumo queda como respaldo hasta que la haya: es peor
      // no avisar que avisar con un criterio provisional.
      await registrarAlerta({
        establecimientoId,
        tipo: fila.saldo === 0 ? 'desabastecimiento' : 'existencia_baja',
        severidad: fila.saldo === 0 ? 'alta' : 'media',
        entidadTipo: 'insumo',
        entidadId: insumo.id,
        mensaje:
          fila.saldo === 0
            ? `${insumo.nombreGenerico}: sin existencia`
            : `${insumo.nombreGenerico}: ${fila.saldo} ${insumo.unidadEntrega}, bajo el mínimo de ${insumo.stockMinimo}. Aún no hay demanda registrada con que calcular el mínimo del MSPAS`,
      });
      if (fila.saldo === 0) conDesabastecimiento.push(insumo.id);
      else conExistenciaBaja.push(insumo.id);
    }

    for (const lote of insumo.lotes) {
      // Cuarentena que se prolonga: o se libera o se da de baja, pero no se
      // queda ahi ocupando espacio indefinidamente.
      if (lote.estado === 'cuarentena' && lote.estadoEn) {
        const dias = Math.floor((new Date(ahora) - new Date(lote.estadoEn)) / MS_POR_DIA);
        if (dias >= config.diasMaximoCuarentena) {
          await registrarAlerta({
            establecimientoId,
            tipo: 'cuarentena',
            severidad: 'media',
            entidadTipo: 'lote',
            entidadId: lote.id,
            mensaje: `${insumo.nombreGenerico} lote ${lote.numeroLote}: ${dias} días en cuarentena. Libérelo o dele de baja`,
          });
          conCuarentena.push(lote.id);
        }
        continue;
      }

      if (lote.estado !== 'disponible' || lote.cantidadActual <= 0) continue;

      // Vencimiento: solo en rojo, y solo si va a sobrar. Un lote que se va a
      // consumir antes de vencer no es una decision pendiente.
      // Rojo o ya vencido, con los rangos del centro.
      const semaforo = semaforoBodega(lote.fechaVence, ahora, abastecimiento.rangosSemaforo(config));
      if (semaforo !== 'rojo' && semaforo !== 'vencido') continue;

      const meses = Number(mesesParaVencer(lote.fechaVence, ahora).toFixed(1));
      const excedente = excedenteAlVencer(lote.cantidadActual, fila.pmdr, lote.fechaVence, ahora);

      if (excedente === 0) continue;

      const detalle =
        excedente === null
          ? `${lote.cantidadActual} sin usar`
          : `sobrarán unas ${excedente} de ${lote.cantidadActual}`;

      await registrarAlerta({
        establecimientoId,
        tipo: 'vencimiento',
        severidad: meses <= 1 ? 'alta' : 'media',
        entidadTipo: 'lote',
        entidadId: lote.id,
        mensaje:
          meses <= 0
            ? `${insumo.nombreGenerico} lote ${lote.numeroLote}: VENCIDO, ${lote.cantidadActual} en existencia`
            : `${insumo.nombreGenerico} lote ${lote.numeroLote}: vence en ${meses} mes(es), ${detalle}`,
      });
      conVencimiento.push(lote.id);
    }
  }

  await cerrarResueltas(establecimientoId, 'existencia_baja', conExistenciaBaja, ahora);
  await cerrarResueltas(establecimientoId, 'desabastecimiento', conDesabastecimiento, ahora);
  await cerrarResueltas(establecimientoId, 'vencimiento', conVencimiento, ahora);
  await cerrarResueltas(establecimientoId, 'cuarentena', conCuarentena, ahora);

  return {
    existenciaBaja: conExistenciaBaja.length,
    desabastecimiento: conDesabastecimiento.length,
    vencimiento: conVencimiento.length,
    cuarentena: conCuarentena.length,
  };
}

/**
 * Obligaciones del calendario logistico: el BRES del mes y el inventario
 * fisico. No nacen de un dato que cambio, sino de una fecha que llego.
 */
async function evaluarCalendario(establecimientoId, ahora) {
  const config = await abastecimiento.configuracion(establecimientoId);
  const { periodoDe } = require('../services/logistica.service');
  const periodo = periodoDe(ahora);
  const diaDelMes = new Date(ahora).getUTCDate();

  const pendientes = [];

  if (diaDelMes >= config.diaCorteBres) {
    const bres = await prisma.bres.findUnique({
      where: { establecimientoId_periodo: { establecimientoId, periodo } },
    });

    if (!bres || bres.estado !== 'cerrado') {
      await registrarAlerta({
        establecimientoId,
        tipo: 'bres_pendiente',
        severidad: 'media',
        entidadTipo: 'establecimiento',
        entidadId: establecimientoId,
        mensaje: `El BRES de ${periodo} aún no se ha cerrado y ya pasó el día ${config.diaCorteBres}`,
      });
      pendientes.push('bres');
    } else {
      await cerrarResueltas(establecimientoId, 'bres_pendiente', [], ahora);
    }
  } else {
    await cerrarResueltas(establecimientoId, 'bres_pendiente', [], ahora);
  }

  // El centro no hace conteo fisico: su inventario de cierre sale de los
  // movimientos. Se cierran avisos viejos de inventario pendiente.
  await cerrarResueltas(establecimientoId, 'inventario_pendiente', [], ahora);

  // Reporte mensual de los servicios. Solo se espera de los que ya reciben
  // traslados por el sistema: uno que nunca recibió nada no tiene qué reportar.
  const conReportePendiente = [];
  if (diaDelMes >= config.diaCorteReportes) {
    const servicios = await prisma.ubicacion.findMany({
      where: {
        establecimientoId,
        activo: true,
        tipo: { in: ['puesto_salud', 'centro_comunitario'] },
        traslados: { some: {} },
        reportes: { none: { periodo } },
      },
      select: { id: true, nombre: true },
    });
    for (const s of servicios) {
      await registrarAlerta({
        establecimientoId,
        tipo: 'reporte_pendiente',
        severidad: 'media',
        entidadTipo: 'ubicacion',
        entidadId: s.id,
        mensaje: `${s.nombre} no ha enviado su reporte de ${periodo} y ya pasó el día ${config.diaCorteReportes}`,
      });
      conReportePendiente.push(s.id);
    }
  }
  await cerrarResueltas(establecimientoId, 'reporte_pendiente', conReportePendiente, ahora);

  // Reportes cuyo saldo o entradas no cuadran y nadie ha revisado.
  const conDiferencia = await prisma.reporteServicio.findMany({
    where: { revisado: false, ubicacion: { establecimientoId } },
    include: { ubicacion: { select: { nombre: true } } },
  });
  for (const r of conDiferencia) {
    await registrarAlerta({
      establecimientoId,
      tipo: 'diferencia_reporte',
      severidad: 'baja',
      entidadTipo: 'reporte_servicio',
      entidadId: r.id,
      mensaje: `El reporte de ${r.ubicacion.nombre} de ${r.periodo} no cuadra con lo trasladado o con su saldo`,
    });
  }
  await cerrarResueltas(establecimientoId, 'diferencia_reporte', conDiferencia.map((r) => r.id), ahora);

  return { calendarioPendiente: pendientes.length, reportesPendientes: conReportePendiente.length, reportesConDiferencia: conDiferencia.length };
}

// --- Desnutricion ----------------------------------------------------------

async function evaluarDesnutricion(establecimientoId, ahora) {
  const limite = new Date(new Date(ahora).getTime() - DIAS_SIN_CONTROL * MS_POR_DIA);

  // Ultima medicion de cada paciente con clasificacion de desnutricion.
  const mediciones = await prisma.antropometria.findMany({
    where: {
      paciente: { establecimientoId, activo: true },
      clasificacion: { in: ['desnutricion_aguda_severa', 'desnutricion_aguda_moderada'] },
    },
    orderBy: { fecha: 'desc' },
    include: { paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true } } },
  });

  const vistos = new Set();
  const conAlerta = [];

  for (const m of mediciones) {
    if (vistos.has(m.pacienteId)) continue;
    vistos.add(m.pacienteId);

    // Si ya hubo una medicion posterior sana, el caso esta siendo atendido.
    const posterior = await prisma.antropometria.findFirst({
      where: { pacienteId: m.pacienteId, fecha: { gt: m.fecha } },
    });
    if (posterior) continue;

    const severa = m.clasificacion === 'desnutricion_aguda_severa';
    const sinControl = new Date(m.fecha) < limite;

    await registrarAlerta({
      establecimientoId,
      tipo: 'desnutricion',
      severidad: severa ? 'alta' : 'media',
      entidadTipo: 'paciente',
      entidadId: m.pacienteId,
      mensaje: sinControl
        ? `${m.paciente.apellidos}, ${m.paciente.nombres} (exp. ${m.paciente.expediente}): ${m.clasificacion.replace(/_/g, ' ')} sin control desde hace ${Math.floor((new Date(ahora) - new Date(m.fecha)) / MS_POR_DIA)} días`
        : `${m.paciente.apellidos}, ${m.paciente.nombres} (exp. ${m.paciente.expediente}): ${m.clasificacion.replace(/_/g, ' ')}`,
    });
    conAlerta.push(m.pacienteId);
  }

  await cerrarResueltas(establecimientoId, 'desnutricion', conAlerta, ahora);
  return { desnutricion: conAlerta.length };
}

// --- Citas vencidas --------------------------------------------------------

async function evaluarCitasVencidas(establecimientoId, ahora) {
  const atenciones = await prisma.atencion.findMany({
    where: {
      establecimientoId,
      proximaCita: { lt: new Date(ahora) },
      estado: 'atendido',
    },
    include: { paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true } } },
    orderBy: { proximaCita: 'desc' },
  });

  const vistos = new Set();
  const conAlerta = [];

  for (const a of atenciones) {
    if (vistos.has(a.pacienteId)) continue;
    vistos.add(a.pacienteId);

    // Si volvio despues de la fecha de la cita, no hay nada que alertar.
    const volvio = await prisma.atencion.findFirst({
      where: { pacienteId: a.pacienteId, registradaEn: { gte: a.proximaCita } },
    });
    if (volvio) continue;

    const diasVencida = Math.floor((new Date(ahora) - new Date(a.proximaCita)) / MS_POR_DIA);

    await registrarAlerta({
      establecimientoId,
      tipo: 'cita_vencida',
      severidad: diasVencida > 30 ? 'media' : 'baja',
      entidadTipo: 'paciente',
      entidadId: a.pacienteId,
      mensaje: `${a.paciente.apellidos}, ${a.paciente.nombres} (exp. ${a.paciente.expediente}): cita vencida hace ${diasVencida} días`,
    });
    conAlerta.push(a.pacienteId);
  }

  await cerrarResueltas(establecimientoId, 'cita_vencida', conAlerta, ahora);
  return { citaVencida: conAlerta.length };
}

// --- Cobertura territorial -------------------------------------------------

/**
 * Comunidades que llevan demasiado tiempo sin registrar una atencion.
 *
 * Es la unica alerta que mira lo que NO paso. Las demas nacen de un registro;
 * esta nace de su ausencia, y por eso hay que construirla desde el catalogo
 * de lugares poblados y no desde las atenciones.
 *
 * Solo entran comunidades con pacientes registrados: una aldea sin un solo
 * paciente no es un vacio de cobertura, es una aldea que no le corresponde a
 * este establecimiento.
 */
async function evaluarComunidades(establecimientoId, ahora) {
  const lugares = await prisma.lugarPoblado.findMany({
    where: { establecimientoId, activo: true },
    select: { id: true, nombre: true, sector: true },
  });

  const conAlerta = [];

  for (const lugar of lugares) {
    const pacientes = await prisma.paciente.findMany({
      where: { establecimientoId, activo: true, lugarPobladoId: lugar.id },
      select: {
        fechaNacimiento: true,
        atenciones: {
          where: { estado: 'atendido' },
          orderBy: { registradaEn: 'desc' },
          take: 1,
          select: { registradaEn: true },
        },
      },
    });

    if (pacientes.length === 0) continue;

    // La ultima atencion de la comunidad es la mas reciente de cualquiera de
    // sus pacientes, no la del ultimo que se registro.
    let ultima = null;
    for (const p of pacientes) {
      const fecha = p.atenciones[0]?.registradaEn ?? null;
      if (fecha && (!ultima || new Date(fecha) > new Date(ultima))) ultima = fecha;
    }

    const dias = ultima
      ? Math.floor((new Date(ahora) - new Date(ultima)) / MS_POR_DIA)
      : null;

    if (dias !== null && dias < DIAS_SIN_ATENCION_COMUNIDAD) continue;

    const nombre = lugar.sector ? `${lugar.nombre} (${lugar.sector})` : lugar.nombre;

    await registrarAlerta({
      establecimientoId,
      tipo: 'comunidad_sin_atencion',
      severidad: dias === null || dias >= DIAS_COBERTURA_GRAVE ? 'alta' : 'media',
      entidadTipo: 'lugar_poblado',
      entidadId: lugar.id,
      mensaje:
        dias === null
          ? `${nombre}: nunca ha registrado atenciones, ${pacientes.length} paciente(s) inscritos`
          : `${nombre}: ${dias} días sin atenciones, ${pacientes.length} paciente(s) inscritos`,
    });
    conAlerta.push(lugar.id);
  }

  await cerrarResueltas(establecimientoId, 'comunidad_sin_atencion', conAlerta, ahora);
  return { comunidadSinAtencion: conAlerta.length };
}

// --- Patron clinico --------------------------------------------------------

async function evaluarPatronClinico(establecimientoId, ahora) {
  const desde = new Date(new Date(ahora).getTime() - 60 * MS_POR_DIA);

  const atenciones = await prisma.atencion.findMany({
    where: {
      establecimientoId,
      estado: 'atendido',
      diagnosticoCie: { not: null },
      registradaEn: { gte: desde },
    },
    select: {
      pacienteId: true,
      diagnosticoCie: true,
      diagnosticoTxt: true,
      registradaEn: true,
      paciente: { select: { nombres: true, apellidos: true, expediente: true } },
    },
  });

  const porPaciente = new Map();
  for (const a of atenciones) {
    if (!porPaciente.has(a.pacienteId)) porPaciente.set(a.pacienteId, []);
    porPaciente.get(a.pacienteId).push(a);
  }

  const conAlerta = [];

  for (const [pacienteId, lista] of porPaciente) {
    const repetidos = diagnosticosRepetidos(lista, ahora);
    if (repetidos.length === 0) continue;

    const peor = repetidos.sort((a, b) => b.veces - a.veces)[0];
    const p = lista[0].paciente;

    await registrarAlerta({
      establecimientoId,
      tipo: 'patron_clinico',
      severidad: 'media',
      entidadTipo: 'paciente',
      entidadId: pacienteId,
      mensaje: `${p.apellidos}, ${p.nombres} (exp. ${p.expediente}): ${peor.veces} consultas por ${peor.codigo} en 60 días`,
    });
    conAlerta.push(pacienteId);
  }

  await cerrarResueltas(establecimientoId, 'patron_clinico', conAlerta, ahora);
  return { patronClinico: conAlerta.length };
}

// --- Orquestacion ----------------------------------------------------------

async function ejecutar(ahora = new Date()) {
  // Los embarazos que pasaron las 42 semanas se cierran solos, para que dejen
  // de dar prioridad en la cola sin que nadie tenga que acordarse.
  const embarazos = await vencerEpisodios(ahora);

  const establecimientos = await prisma.establecimiento.findMany({
    where: { activo: true },
    select: { id: true },
  });

  const resumen = [];

  for (const { id } of establecimientos) {
    const [inventario, desnutricion, citas, patron, comunidades, calendario] = [
      await evaluarInventario(id, ahora),
      await evaluarDesnutricion(id, ahora),
      await evaluarCitasVencidas(id, ahora),
      await evaluarPatronClinico(id, ahora),
      await evaluarComunidades(id, ahora),
      await evaluarCalendario(id, ahora),
    ];

    resumen.push({
      establecimientoId: id,
      ...inventario,
      ...desnutricion,
      ...citas,
      ...patron,
      ...comunidades,
      ...calendario,
      embarazosVencidos: embarazos.vencidos,
    });
  }

  return resumen;
}

let temporizador = null;

function iniciar(intervaloMs = INTERVALO_MS) {
  if (temporizador) return temporizador;

  temporizador = setInterval(() => {
    ejecutar().catch((error) => console.error('Fallo evaluarAlertas:', error));
  }, intervaloMs);

  temporizador.unref?.();
  return temporizador;
}

function detener() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}

module.exports = {
  INTERVALO_MS,
  DIAS_SIN_CONTROL,
  DIAS_SIN_ATENCION_COMUNIDAD,
  DIAS_COBERTURA_GRAVE,
  registrarAlerta,
  evaluarInventario,
  evaluarDesnutricion,
  evaluarCitasVencidas,
  evaluarPatronClinico,
  evaluarComunidades,
  evaluarCalendario,
  ejecutar,
  iniciar,
  detener,
};
