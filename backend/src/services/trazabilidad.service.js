const prisma = require('../config/db');
const { mesesParaVencer, saldoDesdeMovimientos } = require('./logistica.service');
const { semaforoDelCentro } = require('./abastecimiento.service');
const { ETIQUETA_TIPO, ETIQUETA_CAUSA, ETIQUETA_ESTADO_LOTE, ETIQUETA_ORIGEN, ETIQUETA_UBICACION } = require('./movimientos.service');

/**
 * Trazabilidad en las dos direcciones.
 *
 * Desde un lote: todo lo que le paso y a quien llego, paso por paso:
 * recepcion en bodega, paso a la farmacia, entrega a cada paciente (con la
 * atencion, el medico, el diagnostico y quien entrego), traslados a los
 * servicios, consumo interno, reajustes y bajas. Y la cuenta de donde esta
 * cada unidad que entro.
 * Desde un paciente: todo lo que recibio y en que estado esta cada lote.
 *
 * La segunda direccion es la que importa cuando llega un retiro sanitario:
 * hay que poder responder "a quien le dimos esto" en minutos, no revisando
 * recetas en papel.
 */

/** Como se lee un movimiento en la tarjeta de control. */
function describirMovimiento(m) {
  if (m.tipo === 'paso_farmacia') {
    return m.cantidad > 0
      ? `Entra a ${ETIQUETA_UBICACION[m.ubicacion].toLowerCase()}`
      : `Sale de ${ETIQUETA_UBICACION[m.ubicacion].toLowerCase()}`;
  }
  const partes = [ETIQUETA_TIPO[m.tipo] ?? m.tipo];
  if (m.causa) partes.push(ETIQUETA_CAUSA[m.causa] ?? m.causa);
  if (m.servicio) partes.push(m.servicio);
  return partes.join(' · ');
}

/**
 * Tarjeta de control de suministros (kardex) de un insumo.
 *
 * La tarjeta oficial esta autorizada por la Contraloria General de Cuentas,
 * asi que esta es de apoyo y lo dice en el documento impreso.
 */
async function tarjetaDeControl(insumoId, establecimientoId, { desde = null, hasta = null, ubicacion = null } = {}) {
  const insumo = await prisma.insumo.findFirst({
    where: { id: insumoId, establecimientoId },
  });
  if (!insumo) return null;

  // Por ubicacion se ve todo lo de la bodega o de la farmacia. Del centro
  // entero, el paso entre las dos no cambia nada y no se muestra.
  const movimientos = await prisma.movimientoInsumo.findMany({
    where: {
      lote: { insumoId },
      ...(ubicacion ? { ubicacion } : { NOT: { tipo: 'paso_farmacia' } }),
      ...(desde || hasta
        ? { registradoEn: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lt: hasta } : {}) } }
        : {}),
    },
    include: {
      lote: { select: { id: true, numeroLote: true, fechaVence: true } },
      usuario: { select: { nombre: true } },
      dispensacion: {
        select: {
          id: true,
          prescripcion: {
            select: {
              atencion: {
                select: {
                  id: true,
                  paciente: { select: { id: true, expediente: true, nombres: true, apellidos: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ registradoEn: 'asc' }, { id: 'asc' }],
  });

  // El saldo corrido del insumo entero, que es lo que muestra la tarjeta.
  let corrido = 0;
  const filas = movimientos.map((m) => {
    corrido += m.cantidad;
    const paciente = m.dispensacion?.prescripcion?.atencion?.paciente ?? null;
    return {
      id: m.id,
      fecha: m.registradoEn,
      tipo: m.tipo,
      ubicacion: m.ubicacion,
      etiqueta: describirMovimiento(m),
      causa: m.causa,
      servicio: m.servicio,
      numeroLote: m.lote.numeroLote,
      loteId: m.lote.id,
      entrada: m.cantidad > 0 ? m.cantidad : null,
      salida: m.cantidad < 0 ? Math.abs(m.cantidad) : null,
      saldoLote: m.saldoResultante,
      saldoInsumo: corrido,
      usuario: m.usuario.nombre,
      motivo: m.motivo,
      paciente: paciente
        ? {
            id: paciente.id,
            expediente: paciente.expediente,
            nombreCompleto: `${paciente.apellidos}, ${paciente.nombres}`,
          }
        : null,
    };
  });

  return {
    insumo: {
      id: insumo.id,
      codigoInterno: insumo.codigoInterno,
      nombreGenerico: insumo.nombreGenerico,
      formaFarmaceutica: insumo.formaFarmaceutica,
      concentracion: insumo.concentracion,
      presentacion: insumo.presentacion,
      unidadEntrega: insumo.unidadEntrega,
      categoria: insumo.categoria,
    },
    ubicacion: ubicacion ?? 'centro',
    movimientos: filas,
    saldoFinal: corrido,
    // Leyenda obligatoria: la tarjeta oficial es la de Contraloría.
    esDeApoyo: true,
  };
}

/** Todo lo que le paso a un lote y a quien llego. */
async function desdeLote(loteId, establecimientoId, ahora = new Date()) {
  const colorDe = await semaforoDelCentro(establecimientoId);
  const lote = await prisma.lote.findFirst({
    where: { id: loteId, insumo: { establecimientoId } },
    include: {
      insumo: true,
      usuarioEstado: { select: { nombre: true } },
      retiros: { include: { retiro: true } },
      movimientos: {
        include: {
          usuario: { select: { nombre: true } },
          traslado: { select: { id: true, numero: true, recibidoPor: true, ubicacion: { select: { id: true, nombre: true, tipo: true } } } },
          dispensacion: {
            select: {
              id: true,
              registradaEn: true,
              anulada: true,
              usuario: { select: { nombre: true } },
              prescripcion: {
                select: {
                  indicaciones: true,
                  atencion: {
                    select: {
                      id: true,
                      registradaEn: true,
                      diagnosticoCie: true,
                      diagnosticoTxt: true,
                      medico: { select: { nombre: true } },
                      paciente: {
                        select: { id: true, expediente: true, nombres: true, apellidos: true, comunidad: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ registradoEn: 'asc' }, { id: 'asc' }],
      },
    },
  });

  if (!lote) return null;

  const pacientes = [];
  for (const movimiento of lote.movimientos) {
    if (movimiento.tipo !== 'entrega') continue;
    const d = movimiento.dispensacion;
    const atencion = d?.prescripcion?.atencion;
    if (!atencion?.paciente) continue;
    const paciente = atencion.paciente;
    pacientes.push({
      pacienteId: paciente.id,
      expediente: paciente.expediente,
      nombreCompleto: `${paciente.apellidos}, ${paciente.nombres}`,
      comunidad: paciente.comunidad,
      cantidad: Math.abs(movimiento.cantidad),
      entregadoEn: movimiento.registradoEn,
      atencionId: atencion.id,
      consultaEn: atencion.registradaEn,
      medico: atencion.medico?.nombre ?? null,
      diagnostico: atencion.diagnosticoTxt ? `${atencion.diagnosticoTxt}${atencion.diagnosticoCie ? ` (${atencion.diagnosticoCie})` : ''}` : null,
      indicaciones: d.prescripcion.indicaciones,
      entregadoPor: d.usuario?.nombre ?? movimiento.usuario.nombre,
      dispensacionId: d.id,
      // Una entrega anulada volvio al lote: se muestra, pero ya no la tiene el paciente.
      anulada: d.anulada,
    });
  }

  // Bodega <-> farmacia: cada paso con su documento de entrega.
  const pasosFarmacia = lote.movimientos
    .filter((m) => m.tipo === 'paso_farmacia' && m.ubicacion === 'farmacia')
    .map((m) => ({
      fecha: m.registradoEn,
      sentido: m.cantidad > 0 ? 'a_farmacia' : 'a_bodega',
      cantidad: Math.abs(m.cantidad),
      numero: m.traslado?.numero ?? null,
      recibidoPor: m.traslado?.recibidoPor ?? null,
      usuario: m.usuario.nombre,
      motivo: m.motivo,
    }));

  // Puestos y centros comunitarios entregan en papel: la trazabilidad llega
  // hasta el servicio, no hasta el paciente.
  const servicios = lote.movimientos
    .filter((movimiento) => movimiento.tipo === 'traslado' && movimiento.traslado)
    .map(({ traslado, cantidad, registradoEn }) => ({
      trasladoId: traslado.id,
      numero: traslado.numero,
      ubicacionId: traslado.ubicacion.id,
      ubicacion: traslado.ubicacion.nombre,
      recibidoPor: traslado.recibidoPor,
      cantidad: Math.abs(cantidad),
      fecha: registradoEn,
    }));

  const calculado = saldoDesdeMovimientos(lote.movimientos);
  const retiroActivo = lote.retiros.find((r) => !r.retiro.cerradoEn) ?? null;

  // Donde esta cada unidad que entro al lote. La suma de lo que salio y lo
  // que queda tiene que dar lo que entro: si no, falta un movimiento.
  const suma = (fn) => lote.movimientos.filter(fn).reduce((s, m) => s + m.cantidad, 0) || 0;
  const cuenta = {
    recibido: suma((m) => m.tipo === 'ingreso'),
    sobrantes: suma((m) => m.tipo === 'reajuste' && m.cantidad > 0),
    faltantes: 0 - suma((m) => m.tipo === 'reajuste' && m.cantidad < 0),
    aPacientes: 0 - suma((m) => m.tipo === 'entrega') - suma((m) => m.tipo === 'devolucion'),
    aServicios: 0 - suma((m) => m.tipo === 'traslado'),
    consumoInterno: 0 - suma((m) => m.tipo === 'consumo_interno'),
    bajas: 0 - suma((m) => m.tipo === 'baja'),
    enBodega: lote.cantidadActual - lote.cantidadFarmacia,
    enFarmacia: lote.cantidadFarmacia,
  };
  cuenta.cuadra = cuenta.recibido + cuenta.sobrantes - cuenta.faltantes - cuenta.aPacientes - cuenta.aServicios
    - cuenta.consumoInterno - cuenta.bajas === cuenta.enBodega + cuenta.enFarmacia;

  return {
    lote: {
      id: lote.id,
      numeroLote: lote.numeroLote,
      fechaVence: lote.fechaVence,
      recibidoEn: lote.recibidoEn,
      cantidadInicial: lote.cantidadInicial,
      cantidadActual: lote.cantidadActual,
      enBodega: lote.cantidadActual - lote.cantidadFarmacia,
      enFarmacia: lote.cantidadFarmacia,
      estado: lote.estado,
      estadoEtiqueta: ETIQUETA_ESTADO_LOTE[lote.estado] ?? lote.estado,
      motivoEstado: lote.motivoEstado,
      cambiadoPor: lote.usuarioEstado?.nombre ?? null,
      origen: lote.origen,
      origenEtiqueta: ETIQUETA_ORIGEN[lote.origen] ?? lote.origen,
      actaDonacion: lote.actaDonacion,
      fabricante: lote.fabricante,
      registroSanitario: lote.registroSanitario,
      ubicacion: lote.ubicacion,
      costoUnitario: lote.costoUnitario,
      semaforo: colorDe(lote.fechaVence, ahora),
      mesesParaVencer: Number(mesesParaVencer(lote.fechaVence, ahora).toFixed(1)),
      recepcion: {
        cantidadDocumento: lote.cantidadDocumento,
        diferencia:
          lote.cantidadDocumento === null ? null : lote.cantidadInicial - lote.cantidadDocumento,
        etiquetado: lote.verifEtiquetado,
        empaque: lote.verifEmpaque,
        aspecto: lote.verifAspecto,
        observacion: lote.observacionRecepcion,
      },
    },
    insumo: {
      id: lote.insumo.id,
      codigoInterno: lote.insumo.codigoInterno,
      nombreGenerico: lote.insumo.nombreGenerico,
      formaFarmaceutica: lote.insumo.formaFarmaceutica,
      concentracion: lote.insumo.concentracion,
      presentacion: lote.insumo.presentacion,
      unidadEntrega: lote.insumo.unidadEntrega,
      categoria: lote.insumo.categoria,
      cadenaFrio: lote.insumo.cadenaFrio,
    },
    movimientos: lote.movimientos.map((m) => ({
      id: m.id,
      fecha: m.registradoEn,
      tipo: m.tipo,
      ubicacion: m.ubicacion,
      ubicacionEtiqueta: ETIQUETA_UBICACION[m.ubicacion],
      etiqueta: describirMovimiento(m),
      cantidad: m.cantidad,
      saldoResultante: m.saldoResultante,
      usuario: m.usuario.nombre,
      motivo: m.motivo,
      causa: m.causa,
      servicio: m.servicio,
    })),
    pacientes,
    servicios,
    pasosFarmacia,
    cuenta,
    retiroActivo: retiroActivo
      ? {
          id: retiroActivo.retiro.id,
          referencia: retiroActivo.retiro.referencia,
          motivo: retiroActivo.retiro.motivo,
          emitidoEn: retiroActivo.retiro.emitidoEn,
        }
      : null,
    // La verificacion de integridad va a la vista, no a un registro escondido.
    saldoCalculado: calculado,
    cuadra: calculado === lote.cantidadActual
      && saldoDesdeMovimientos(lote.movimientos.filter((m) => m.ubicacion === 'farmacia')) === lote.cantidadFarmacia,
  };
}

/**
 * Todo lo que un paciente ha recibido, con el estado de cada lote.
 *
 * Si alguno tiene un retiro activo se marca, para que quien abra la ficha lo
 * vea sin tener que ir a buscarlo.
 */
async function desdePaciente(pacienteId, establecimientoId, ahora = new Date()) {
  const colorDe = await semaforoDelCentro(establecimientoId);
  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, establecimientoId },
    select: { id: true, expediente: true, nombres: true, apellidos: true, comunidad: true },
  });
  if (!paciente) return null;

  const movimientos = await prisma.movimientoInsumo.findMany({
    where: {
      tipo: 'entrega',
      dispensacion: { prescripcion: { atencion: { pacienteId } } },
    },
    include: {
      lote: {
        include: {
          insumo: { select: { id: true, nombreGenerico: true, unidadEntrega: true, presentacion: true } },
          retiros: { include: { retiro: true } },
        },
      },
      usuario: { select: { nombre: true } },
      dispensacion: {
        select: {
          id: true,
          anulada: true,
          prescripcion: {
            select: {
              atencionId: true,
              indicaciones: true,
              atencion: {
                select: { registradaEn: true, diagnosticoCie: true, diagnosticoTxt: true, medico: { select: { nombre: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { registradoEn: 'desc' },
  });

  const entregas = movimientos.map((m) => {
    const retiroActivo = m.lote.retiros.find((r) => !r.retiro.cerradoEn) ?? null;
    return {
      movimientoId: m.id,
      fecha: m.registradoEn,
      cantidad: Math.abs(m.cantidad),
      atencionId: m.dispensacion?.prescripcion?.atencionId ?? null,
      indicaciones: m.dispensacion?.prescripcion?.indicaciones ?? null,
      consultaEn: m.dispensacion?.prescripcion?.atencion?.registradaEn ?? null,
      medico: m.dispensacion?.prescripcion?.atencion?.medico?.nombre ?? null,
      diagnostico: m.dispensacion?.prescripcion?.atencion?.diagnosticoTxt ?? null,
      cie: m.dispensacion?.prescripcion?.atencion?.diagnosticoCie ?? null,
      entregadoPor: m.usuario.nombre,
      anulada: m.dispensacion?.anulada ?? false,
      insumo: m.lote.insumo,
      lote: {
        id: m.lote.id,
        numeroLote: m.lote.numeroLote,
        fechaVence: m.lote.fechaVence,
        estado: m.lote.estado,
        estadoEtiqueta: ETIQUETA_ESTADO_LOTE[m.lote.estado] ?? m.lote.estado,
        semaforo: colorDe(m.lote.fechaVence, ahora),
      },
      retiro: retiroActivo
        ? {
            id: retiroActivo.retiro.id,
            referencia: retiroActivo.retiro.referencia,
            motivo: retiroActivo.retiro.motivo,
          }
        : null,
    };
  });

  return {
    paciente: {
      ...paciente,
      nombreCompleto: `${paciente.apellidos}, ${paciente.nombres}`,
    },
    entregas,
    // Lo que hace que esto valga la pena: cuantos de sus medicamentos estan
    // bajo retiro sanitario ahora mismo.
    conRetiroActivo: entregas.filter((e) => e.retiro !== null).length,
  };
}

module.exports = {
  describirMovimiento,
  tarjetaDeControl,
  desdeLote,
  desdePaciente,
};
