const prisma = require('../config/db');
const { mesesParaVencer, saldoDesdeMovimientos } = require('./logistica.service');
const { semaforoDelCentro } = require('./abastecimiento.service');
const { ETIQUETA_TIPO, ETIQUETA_CAUSA, ETIQUETA_ESTADO_LOTE, ETIQUETA_ORIGEN } = require('./movimientos.service');

/**
 * Trazabilidad en las dos direcciones.
 *
 * Desde un lote: todo lo que le paso y a quien llego.
 * Desde un paciente: todo lo que recibio y en que estado esta cada lote.
 *
 * La segunda direccion es la que importa cuando llega un retiro sanitario:
 * hay que poder responder "a quien le dimos esto" en minutos, no revisando
 * recetas en papel.
 */

/** Como se lee un movimiento en la tarjeta de control. */
function describirMovimiento(m) {
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
async function tarjetaDeControl(insumoId, establecimientoId, { desde = null, hasta = null } = {}) {
  const insumo = await prisma.insumo.findFirst({
    where: { id: insumoId, establecimientoId },
  });
  if (!insumo) return null;

  const movimientos = await prisma.movimientoInsumo.findMany({
    where: {
      lote: { insumoId },
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
              prescripcion: {
                select: {
                  atencion: {
                    select: {
                      id: true,
                      registradaEn: true,
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
  for (const m of lote.movimientos) {
    const paciente = m.dispensacion?.prescripcion?.atencion?.paciente;
    if (!paciente) continue;
    pacientes.push({
      pacienteId: paciente.id,
      expediente: paciente.expediente,
      nombreCompleto: `${paciente.apellidos}, ${paciente.nombres}`,
      comunidad: paciente.comunidad,
      cantidad: Math.abs(m.cantidad),
      entregadoEn: m.registradoEn,
      atencionId: m.dispensacion.prescripcion.atencion.id,
    });
  }

  // Puestos y centros comunitarios entregan en papel: la trazabilidad llega
  // hasta el servicio, no hasta el paciente.
  const servicios = lote.movimientos
    .filter((m) => m.tipo === 'traslado' && m.traslado)
    .map((m) => ({
      trasladoId: m.traslado.id,
      numero: m.traslado.numero,
      ubicacionId: m.traslado.ubicacion.id,
      ubicacion: m.traslado.ubicacion.nombre,
      recibidoPor: m.traslado.recibidoPor,
      cantidad: Math.abs(m.cantidad),
      fecha: m.registradoEn,
    }));

  const calculado = saldoDesdeMovimientos(lote.movimientos);
  const retiroActivo = lote.retiros.find((r) => !r.retiro.cerradoEn) ?? null;

  return {
    lote: {
      id: lote.id,
      numeroLote: lote.numeroLote,
      fechaVence: lote.fechaVence,
      recibidoEn: lote.recibidoEn,
      cantidadInicial: lote.cantidadInicial,
      cantidadActual: lote.cantidadActual,
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
    cuadra: calculado === lote.cantidadActual,
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
      dispensacion: {
        select: { id: true, prescripcion: { select: { atencionId: true, indicaciones: true } } },
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
