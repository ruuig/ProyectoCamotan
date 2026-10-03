const prisma = require('../config/db');
const { cambiarEstadoLote } = require('./movimientos.service');

/**
 * Retiro sanitario.
 *
 * Cuando llega una alerta sanitaria hay que hacer dos cosas a la vez: sacar
 * los lotes de circulacion ya, y encontrar a quien ya los recibio. Lo primero
 * es inmediato; lo segundo es la razon por la que se lleva trazabilidad.
 *
 * La lista de pacientes se arma sola desde los movimientos de entrega. Nadie
 * la escribe a mano, porque a mano se olvidan personas.
 */

function fallo(status, codigo, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  error.codigo = codigo;
  error.mensaje = mensaje;
  return error;
}

/**
 * Registra el retiro: pasa los lotes a retirado y arma la lista de pacientes
 * que los recibieron, con la cantidad y la fecha de cada entrega.
 */
async function registrar(establecimientoId, { referencia, motivo, emitidoEn, loteIds, usuarioId }) {
  const lotes = await prisma.lote.findMany({
    where: { id: { in: loteIds }, insumo: { establecimientoId } },
    include: { insumo: { select: { nombreGenerico: true } } },
  });

  if (lotes.length !== loteIds.length) {
    throw fallo(404, 'lote_no_encontrado', 'Alguno de los lotes indicados no existe');
  }

  return prisma.$transaction(async (tx) => {
    const retiro = await tx.retiroSanitario.create({
      data: { establecimientoId, referencia, motivo, emitidoEn, registradoPor: usuarioId },
    });

    for (const lote of lotes) {
      await tx.retiroLote.create({ data: { retiroId: retiro.id, loteId: lote.id } });

      // Fuera de circulacion de inmediato, antes de buscar a nadie.
      if (lote.estado !== 'dado_de_baja') {
        await cambiarEstadoLote(tx, {
          loteId: lote.id,
          estado: 'retirado',
          motivo: `Retiro sanitario ${referencia}`,
          usuarioId,
        });
      }

      // A quien le llego. Sale de los movimientos, no de una lista aparte.
      const entregas = await tx.movimientoInsumo.findMany({
        where: { loteId: lote.id, tipo: 'entrega' },
        include: {
          dispensacion: {
            select: {
              prescripcion: { select: { atencion: { select: { pacienteId: true } } } },
            },
          },
        },
      });

      // Varias entregas al mismo paciente del mismo lote se suman en una fila.
      const porPaciente = new Map();
      for (const e of entregas) {
        const pacienteId = e.dispensacion?.prescripcion?.atencion?.pacienteId;
        if (!pacienteId) continue;

        const fila = porPaciente.get(pacienteId) ?? { cantidad: 0, entregadoEn: e.registradoEn };
        fila.cantidad += Math.abs(e.cantidad);
        if (new Date(e.registradoEn) > new Date(fila.entregadoEn)) {
          fila.entregadoEn = e.registradoEn;
        }
        porPaciente.set(pacienteId, fila);
      }

      for (const [pacienteId, fila] of porPaciente) {
        await tx.retiroPaciente.create({
          data: {
            retiroId: retiro.id,
            pacienteId,
            loteId: lote.id,
            cantidad: fila.cantidad,
            entregadoEn: fila.entregadoEn,
          },
        });
      }
    }

    return retiro;
  });
}

/** El retiro con sus lotes y la lista de personas a localizar. */
async function obtener(retiroId, establecimientoId) {
  const retiro = await prisma.retiroSanitario.findFirst({
    where: { id: retiroId, establecimientoId },
    include: {
      usuario: { select: { nombre: true } },
      lotes: {
        include: {
          lote: { include: { insumo: { select: { nombreGenerico: true, presentacion: true } } } },
        },
      },
      pacientes: {
        include: {
          paciente: {
            select: {
              id: true,
              expediente: true,
              nombres: true,
              apellidos: true,
              comunidad: true,
              telefono: true,
              responsableNombre: true,
            },
          },
          lote: { select: { numeroLote: true, insumo: { select: { nombreGenerico: true } } } },
        },
        orderBy: [{ localizado: 'asc' }, { entregadoEn: 'desc' }],
      },
    },
  });

  if (!retiro) return null;

  const total = retiro.pacientes.length;
  const localizados = retiro.pacientes.filter((p) => p.localizado).length;

  // Servicios a los que se trasladaron los lotes retirados: alli la
  // trazabilidad llega hasta el servicio, que debe devolver o separar el
  // producto.
  const traslados = await prisma.movimientoInsumo.findMany({
    where: { tipo: 'traslado', loteId: { in: retiro.lotes.map((l) => l.loteId) }, NOT: { trasladoId: null } },
    include: {
      lote: { select: { numeroLote: true, insumo: { select: { nombreGenerico: true } } } },
      traslado: { select: { numero: true, recibidoPor: true, ubicacion: { select: { id: true, nombre: true } } } },
    },
    orderBy: { registradoEn: 'asc' },
  });
  const servicios = traslados.map((m) => ({
    ubicacionId: m.traslado.ubicacion.id,
    ubicacion: m.traslado.ubicacion.nombre,
    numeroTraslado: m.traslado.numero,
    recibidoPor: m.traslado.recibidoPor,
    insumo: m.lote.insumo.nombreGenerico,
    numeroLote: m.lote.numeroLote,
    cantidad: Math.abs(m.cantidad),
    fecha: m.registradoEn,
  }));

  return {
    ...retiro,
    servicios,
    resumen: {
      lotes: retiro.lotes.length,
      pacientes: total,
      servicios: new Set(servicios.map((x) => x.ubicacionId)).size,
      localizados,
      pendientes: total - localizados,
      // El retiro no se cierra mientras quede alguien sin localizar.
      puedeCerrarse: total === localizados,
    },
  };
}

/** Marca si se localizo a una persona. */
async function marcarLocalizacion(retiroPacienteId, { localizado, notas, usuarioId }) {
  return prisma.retiroPaciente.update({
    where: { id: retiroPacienteId },
    data: { localizado, notas, actualizadoEn: new Date(), actualizadoPor: usuarioId },
  });
}

/** Cierra el retiro. Solo cuando ya no queda nadie por localizar. */
async function cerrar(retiroId, establecimientoId) {
  const retiro = await obtener(retiroId, establecimientoId);
  if (!retiro) throw fallo(404, 'no_encontrado', 'Retiro no encontrado');
  if (retiro.cerradoEn) throw fallo(409, 'retiro_cerrado', 'Ese retiro ya está cerrado');

  if (!retiro.resumen.puedeCerrarse) {
    throw fallo(
      409,
      'quedan_pacientes',
      `Quedan ${retiro.resumen.pendientes} paciente(s) sin localizar`,
    );
  }

  return prisma.retiroSanitario.update({
    where: { id: retiroId },
    data: { cerradoEn: new Date() },
  });
}

/** Los retiros del establecimiento, los abiertos primero. */
async function listar(establecimientoId) {
  const retiros = await prisma.retiroSanitario.findMany({
    where: { establecimientoId },
    include: {
      lotes: true,
      pacientes: { select: { localizado: true } },
      usuario: { select: { nombre: true } },
    },
    orderBy: [{ cerradoEn: 'asc' }, { emitidoEn: 'desc' }],
  });

  return retiros.map((r) => ({
    id: r.id,
    referencia: r.referencia,
    motivo: r.motivo,
    emitidoEn: r.emitidoEn,
    cerradoEn: r.cerradoEn,
    registradoPor: r.usuario.nombre,
    lotes: r.lotes.length,
    pacientes: r.pacientes.length,
    pendientes: r.pacientes.filter((p) => !p.localizado).length,
  }));
}

module.exports = { registrar, obtener, marcarLocalizacion, cerrar, listar };
