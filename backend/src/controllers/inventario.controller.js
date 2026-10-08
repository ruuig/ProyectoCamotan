const prisma = require('../config/db');
const {
  registrarReajuste,
  descontarDeLote,
  ETIQUETA_CAUSA,
} = require('../services/movimientos.service');
const { planFraccionamiento, lotesDisponibles, enUbicacion } = require('../services/inventario.service');
const trazabilidad = require('../services/trazabilidad.service');
const { periodoDe } = require('../services/logistica.service');
const { limitesDePeriodo } = require('../services/abastecimiento.service');

/**
 * Movimientos de inventario que no son ni recepcion ni entrega a paciente:
 * reajustes, consumo interno y traslados a otro servicio.
 */

/** Trazabilidad de un lote. La version completa vive en su servicio. */
async function trazabilidadLote(req, res, next) {
  const datos = await trazabilidad.desdeLote(req.params.id, req.usuario.establecimientoId);

  if (!datos) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Lote no encontrado' });
  }

  await req.bitacora({
    accion: 'leer',
    entidad: 'lote',
    entidadId: Number(req.params.id),
    detalle: `Trazabilidad del lote ${datos.lote.numeroLote}`,
  });

  res.json(datos);
}

/**
 * Reajuste con causa del catalogo oficial.
 *
 * Reemplaza el ajuste por conteo que habia antes. La diferencia importa: un
 * ajuste "llevaba el saldo al valor contado" sin decir por que cambio, y eso
 * no se puede sustentar ante auditoria. Ahora la cantidad lleva su signo y
 * la causa tiene que concordar con el.
 */
async function reajustar(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { loteId, cantidad, causa, motivo } = req.body;

  const lote = await prisma.lote.findFirst({
    where: { id: loteId, insumo: { establecimientoId } },
    include: { insumo: { select: { nombreGenerico: true, unidadEntrega: true } } },
  });

  if (!lote) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Lote no encontrado' });
  }

  const resultado = await prisma.$transaction((tx) =>
    registrarReajuste(tx, { loteId, cantidad, causa, usuarioId: req.usuario.id, motivo }),
  );

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'lote',
    entidadId: loteId,
    detalle:
      `${lote.insumo.nombreGenerico} lote ${lote.numeroLote}: reajuste de `
      + `${cantidad > 0 ? '+' : ''}${cantidad} por ${ETIQUETA_CAUSA[causa]}`
      + `${motivo ? `. ${motivo}` : ''}`,
  });

  res.json({
    lote: resultado.lote,
    diferencia: resultado.diferencia,
    causa,
    causaEtiqueta: ETIQUETA_CAUSA[causa],
    mensaje: `Saldo reajustado en ${cantidad > 0 ? '+' : ''}${cantidad} ${lote.insumo.unidadEntrega}`,
  });
}

/**
 * Consumo interno: lo que se usa en el propio establecimiento sin receta.
 * Es consumo, no baja, y por eso entra en la demanda del insumo.
 */
async function usoInterno(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { insumoId, cantidad, motivo, servicio, loteId } = req.body;
  const ahora = new Date();

  const insumo = await prisma.insumo.findFirst({
    where: { id: insumoId, establecimientoId, activo: true },
    include: { lotes: true },
  });

  if (!insumo) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });
  }

  // Con lote indicado se respeta la decisión de quien lo registra; sin él, se
  // reparte por PEPE como en cualquier otra salida. Sale de la bodega.
  const lotes = enUbicacion(insumo.lotes, 'bodega');
  let reparto;

  if (loteId) {
    const elegido = lotesDisponibles(lotes, ahora).find((l) => l.id === loteId);

    if (!elegido) {
      return next({
        status: 400,
        codigo: 'lote_invalido',
        mensaje: 'El lote indicado no existe, está vencido, no está disponible o no tiene existencia',
      });
    }

    if (elegido.cantidadActual < cantidad) {
      return next({
        status: 409,
        codigo: 'existencia_insuficiente',
        mensaje: `El lote ${elegido.numeroLote} solo tiene ${elegido.cantidadActual} en bodega`,
      });
    }

    reparto = [{ loteId, cantidad }];
  } else {
    reparto = planFraccionamiento(lotes, cantidad, ahora);

    if (!reparto) {
      return next({
        status: 409,
        codigo: 'existencia_insuficiente',
        mensaje: 'No hay existencia disponible suficiente en bodega',
      });
    }
  }

  const movimientos = await prisma.$transaction(async (tx) => {
    const hechos = [];
    for (const parte of reparto) {
      const lote = await descontarDeLote(tx, {
        loteId: parte.loteId,
        cantidad: parte.cantidad,
        usuarioId: req.usuario.id,
        tipo: 'consumo_interno',
        servicio: servicio ?? null,
        motivo,
        ahora,
      });
      hechos.push({
        loteId: lote.id,
        numeroLote: lote.numeroLote,
        cantidad: parte.cantidad,
        saldoResultante: lote.cantidadActual - lote.cantidadFarmacia,
      });
    }
    return hechos;
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'movimiento_insumo',
    entidadId: insumoId,
    detalle: `Consumo interno de ${insumo.nombreGenerico} x${cantidad}${servicio ? ` en ${servicio}` : ''}. ${motivo}`,
  });

  res.status(201).json({
    movimientos,
    fraccionado: movimientos.length > 1,
    mensaje: `Se registraron ${cantidad} ${insumo.unidadEntrega} como consumo interno`,
  });
}

/**
 * Diferencias de inventario del mes, con el insumo de mayor discrepancia.
 * Ahora cuenta solo los reajustes que vienen de un conteo fisico: los demas
 * son movimientos normales, no diferencias.
 */
async function diferenciasDelMes(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const { desde } = limitesDePeriodo(periodoDe(new Date()));

  const reajustes = await prisma.movimientoInsumo.findMany({
    where: {
      tipo: 'reajuste',
      causa: { in: ['sobrante_inventario_fisico', 'faltante_inventario_fisico'] },
      registradoEn: { gte: desde },
      lote: { insumo: { establecimientoId } },
    },
    include: {
      lote: { include: { insumo: { select: { id: true, nombreGenerico: true, unidadEntrega: true } } } },
    },
  });

  const porInsumo = new Map();
  for (const r of reajustes) {
    const insumo = r.lote.insumo;
    const fila = porInsumo.get(insumo.id) ?? { insumo, sobrantes: 0, faltantes: 0, neto: 0, ajustes: 0 };
    if (r.cantidad > 0) fila.sobrantes += r.cantidad;
    else fila.faltantes += Math.abs(r.cantidad);
    fila.neto += r.cantidad;
    fila.ajustes += 1;
    porInsumo.set(insumo.id, fila);
  }

  const lista = [...porInsumo.values()].sort(
    (a, b) => Math.abs(b.neto) - Math.abs(a.neto),
  );

  res.json({
    totalAjustes: reajustes.length,
    mayorDiscrepancia: lista[0] ?? null,
    lista,
  });
}

module.exports = {
  trazabilidad: trazabilidadLote,
  reajustar,
  usoInterno,
  diferenciasDelMes,
};
