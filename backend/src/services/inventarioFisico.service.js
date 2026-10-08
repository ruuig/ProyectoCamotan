const prisma = require('../config/db');
const { registrarReajuste } = require('./movimientos.service');

/**
 * Inventario fisico mensual.
 *
 * La normativa pide que el conteo sea ciego: la hoja lleva insumo, lote y
 * ubicacion, pero no el saldo que el sistema cree tener. Si lo llevara, quien
 * cuenta tiende a escribir lo que dice el papel en vez de lo que ve, y el
 * inventario deja de servir para detectar perdidas.
 *
 * Por eso el saldo del sistema se congela al cerrar, nunca antes, y la hoja
 * de conteo se genera sin el.
 */

// Una diferencia de este tamano o mas necesita autorizacion del director:
// deja de ser un error de conteo y pasa a ser una perdida que hay que
// explicar. PENDIENTE DE CONFIRMAR con el centro.
const DIFERENCIA_QUE_EXIGE_AUTORIZACION = 10;
const PORCENTAJE_QUE_EXIGE_AUTORIZACION = 0.1;

function fallo(status, codigo, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  error.codigo = codigo;
  error.mensaje = mensaje;
  return error;
}

/**
 * Si una diferencia es lo bastante grande como para necesitar autorizacion.
 * Se mira en unidades y en proporcion: perder 8 de 10 es grave aunque sean
 * pocas unidades.
 */
function requiereAutorizacion(diferencia, saldoSistema) {
  const magnitud = Math.abs(diferencia);
  if (magnitud === 0) return false;
  if (magnitud >= DIFERENCIA_QUE_EXIGE_AUTORIZACION) return true;
  return saldoSistema > 0 && magnitud / saldoSistema >= PORCENTAJE_QUE_EXIGE_AUTORIZACION;
}

/** La causa del reajuste segun el signo de la diferencia. */
function causaDeDiferencia(diferencia) {
  return diferencia > 0 ? 'sobrante_inventario_fisico' : 'faltante_inventario_fisico';
}

// Un lote que se agoto hace poco sigue entrando en el conteo: si quedara
// producto en el estante, un inventario que solo mira lo que el sistema cree
// tener nunca lo encontraria.
const DIAS_AGOTADO_QUE_AUN_SE_CUENTA = 90;

/**
 * Hoja de conteo: lo que hay que contar, sin decir cuanto deberia haber.
 *
 * Entran los lotes con existencia, los que estan en cuarentena o retirados
 * porque ocupan espacio fisico, y los recien agotados, para verificar que el
 * cero del sistema es un cero de verdad.
 */
async function hojaDeConteo(establecimientoId, ahora = new Date()) {
  const desdeAgotado = new Date(
    new Date(ahora).getTime() - DIAS_AGOTADO_QUE_AUN_SE_CUENTA * 86400000,
  );

  const lotes = await prisma.lote.findMany({
    where: {
      insumo: { establecimientoId, activo: true },
      OR: [
        { cantidadActual: { gt: 0 } },
        { estado: { in: ['cuarentena', 'retirado'] } },
        { estado: 'agotado', estadoEn: { gte: desdeAgotado } },
      ],
    },
    include: {
      insumo: {
        select: {
          id: true,
          codigoInterno: true,
          nombreGenerico: true,
          formaFarmaceutica: true,
          concentracion: true,
          presentacion: true,
          unidadEntrega: true,
          categoria: true,
        },
      },
    },
    orderBy: [{ insumo: { nombreGenerico: 'asc' } }, { fechaVence: 'asc' }],
  });

  return lotes.map((l) => ({
    loteId: l.id,
    numeroLote: l.numeroLote,
    fechaVence: l.fechaVence,
    ubicacion: l.ubicacion,
    estado: l.estado,
    insumo: l.insumo,
    // Deliberadamente no viaja cantidadActual: el conteo es ciego.
  }));
}

/** Abre el inventario del periodo. Solo puede haber uno por mes. */
async function abrir(establecimientoId, { periodo, observaciones, usuarioId }) {
  const existente = await prisma.inventarioFisico.findUnique({
    where: { establecimientoId_periodo: { establecimientoId, periodo } },
  });

  if (existente) {
    throw fallo(
      409,
      'inventario_duplicado',
      `Ya hay un inventario del período ${periodo} en estado "${existente.estado}"`,
    );
  }

  return prisma.inventarioFisico.create({
    data: { establecimientoId, periodo, observaciones, iniciadoPor: usuarioId },
  });
}

/** Guarda lo contado. Se puede llamar varias veces mientras este abierto. */
async function registrarConteos(inventarioId, { conteos, usuarioId }) {
  const inventario = await prisma.inventarioFisico.findUnique({ where: { id: inventarioId } });
  if (!inventario) throw fallo(404, 'no_encontrado', 'Inventario no encontrado');
  if (inventario.estado !== 'abierto') {
    throw fallo(409, 'inventario_cerrado', 'Ese inventario ya está cerrado');
  }

  for (const c of conteos) {
    await prisma.conteoFisico.upsert({
      where: { inventarioId_loteId: { inventarioId, loteId: c.loteId } },
      create: {
        inventarioId,
        loteId: c.loteId,
        cantidadContada: c.cantidadContada,
        contadoPor: usuarioId,
      },
      update: { cantidadContada: c.cantidadContada, contadoPor: usuarioId, contadoEn: new Date() },
    });
  }

  return prisma.conteoFisico.count({ where: { inventarioId } });
}

/**
 * Cierra el inventario: congela el saldo del sistema, calcula las diferencias
 * y aplica los reajustes que no necesiten autorizacion.
 *
 * Las diferencias grandes quedan sin aplicar y con su motivo, esperando al
 * director. Asi el inventario refleja el conteo pero nadie puede borrar una
 * perdida importante sin que se note.
 */
async function cerrar(inventarioId, { usuarioId, observaciones, aplicarReajustes = true, autorizado = false }) {
  const inventario = await prisma.inventarioFisico.findUnique({
    where: { id: inventarioId },
    include: { conteos: { include: { lote: true } } },
  });

  if (!inventario) throw fallo(404, 'no_encontrado', 'Inventario no encontrado');
  if (inventario.estado !== 'abierto') {
    throw fallo(409, 'inventario_cerrado', 'Ese inventario ya está cerrado');
  }
  if (inventario.conteos.length === 0) {
    throw fallo(400, 'sin_conteos', 'No se puede cerrar un inventario sin ningún conteo');
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const filas = [];

    for (const conteo of inventario.conteos) {
      // El saldo se lee ahora, al cerrar: es el que se compara con lo contado.
      const lote = await tx.lote.findUnique({ where: { id: conteo.loteId } });
      // Se cuenta la bodega: lo que esta en farmacia lo cuenta farmacia al cerrar su dia.
      const enBodega = lote.cantidadActual - lote.cantidadFarmacia;
      const diferencia = conteo.cantidadContada - enBodega;
      const pendienteDeAutorizar = requiereAutorizacion(diferencia, enBodega) && !autorizado;

      let aplicado = false;
      if (diferencia !== 0 && aplicarReajustes && !pendienteDeAutorizar) {
        await registrarReajuste(tx, {
          loteId: conteo.loteId,
          cantidad: diferencia,
          causa: causaDeDiferencia(diferencia),
          usuarioId,
          motivo: `Inventario físico ${inventario.periodo}`,
        });
        aplicado = true;
      }

      await tx.conteoFisico.update({
        where: { id: conteo.id },
        data: {
          saldoSistema: enBodega,
          diferencia,
          reajusteAplicado: aplicado,
        },
      });

      filas.push({
        loteId: conteo.loteId,
        numeroLote: lote.numeroLote,
        contado: conteo.cantidadContada,
        saldoSistema: enBodega,
        diferencia,
        reajusteAplicado: aplicado,
        pendienteDeAutorizar,
      });
    }

    await tx.inventarioFisico.update({
      where: { id: inventarioId },
      data: {
        estado: 'cerrado',
        cerradoPor: usuarioId,
        cerradoEn: new Date(),
        observaciones: observaciones ?? inventario.observaciones,
        ...(autorizado ? { autorizadoPor: usuarioId } : {}),
      },
    });

    return filas;
  });

  const conDiferencia = resultado.filter((f) => f.diferencia !== 0);

  return {
    lotesContados: resultado.length,
    conDiferencia: conDiferencia.length,
    reajustesAplicados: resultado.filter((f) => f.reajusteAplicado).length,
    pendientesDeAutorizar: resultado.filter((f) => f.pendienteDeAutorizar),
    filas: resultado,
  };
}

/** El inventario del periodo con sus conteos, para consultarlo o imprimirlo. */
async function obtener(establecimientoId, periodo) {
  return prisma.inventarioFisico.findUnique({
    where: { establecimientoId_periodo: { establecimientoId, periodo } },
    include: {
      conteos: {
        include: {
          lote: { include: { insumo: { select: { nombreGenerico: true, codigoInterno: true, unidadEntrega: true } } } },
        },
        orderBy: { id: 'asc' },
      },
      iniciador: { select: { nombre: true } },
      cerrador: { select: { nombre: true } },
      autorizador: { select: { nombre: true } },
    },
  });
}

module.exports = {
  DIAS_AGOTADO_QUE_AUN_SE_CUENTA,
  DIFERENCIA_QUE_EXIGE_AUTORIZACION,
  PORCENTAJE_QUE_EXIGE_AUTORIZACION,
  requiereAutorizacion,
  causaDeDiferencia,
  hojaDeConteo,
  abrir,
  registrarConteos,
  cerrar,
  obtener,
};
