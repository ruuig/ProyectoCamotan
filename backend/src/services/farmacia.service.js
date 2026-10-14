const prisma = require('../config/db');
const { configuracion, rangosSemaforo } = require('./abastecimiento.service');
const { semaforoBodega, mesesParaVencer } = require('./bodega.service');
const { registrarReajuste, pasarEntreUbicaciones } = require('./movimientos.service');
const { lotesDisponibles, enUbicacion } = require('./inventario.service');

/**
 * Control diario de la farmacia (post-consulta).
 *
 * La farmacia recibe de la bodega, entrega a los pacientes y, al cerrar el
 * dia, cuenta lo que tiene. Todo sale de los movimientos de farmacia, lote
 * por lote, asi que el resumen del dia, la existencia y la trazabilidad dicen
 * lo mismo.
 */

const DESFASE_GT_MS = 6 * 3600000;
const MS_DIA = 86400000;

function fallo(status, codigo, mensaje, detalles = null) {
  const error = new Error(mensaje);
  Object.assign(error, { status, codigo, mensaje, detalles });
  return error;
}

/** Hoy en Guatemala, como AAAA-MM-DD. */
function hoyGuatemala(ahora = new Date()) {
  return new Date(ahora.getTime() - DESFASE_GT_MS).toISOString().slice(0, 10);
}

/** Limites de un dia de Guatemala (UTC-6). */
function limitesDelDia(fecha) {
  const desde = new Date(Date.parse(`${fecha}T00:00:00Z`) + DESFASE_GT_MS);
  return { desde, hasta: new Date(desde.getTime() + MS_DIA) };
}

/** Existencia de la farmacia, por insumo y por lote, con su semaforo. */
async function existencias(establecimientoId, ahora = new Date()) {
  const config = await configuracion(establecimientoId);
  const rangos = rangosSemaforo(config);
  const insumos = await prisma.insumo.findMany({
    where: { establecimientoId, OR: [{ activo: true }, { lotes: { some: { cantidadFarmacia: { gt: 0 } } } }] },
    include: { lotes: { where: { cantidadActual: { gt: 0 } }, orderBy: { fechaVence: 'asc' } } },
    orderBy: { nombreGenerico: 'asc' },
  });
  return insumos
    .map((i) => {
      const enFarmacia = i.lotes.filter((l) => l.cantidadFarmacia > 0);
      const usable = lotesDisponibles(enUbicacion(i.lotes, 'farmacia'), ahora).reduce((s, l) => s + l.cantidadActual, 0);
      const bodega = lotesDisponibles(enUbicacion(i.lotes, 'bodega'), ahora).reduce((s, l) => s + l.cantidadActual, 0);
      return {
        insumoId: i.id,
        nombre: i.nombreGenerico,
        categoria: i.categoria,
        unidadEntrega: i.unidadEntrega,
        prescribible: i.prescribible,
        enFarmacia: enFarmacia.reduce((s, l) => s + l.cantidadFarmacia, 0),
        // Lo que se puede entregar hoy: sin lo vencido, en cuarentena o retirado.
        entregable: usable,
        enBodega: bodega,
        lotes: enFarmacia.map((l) => ({
          loteId: l.id,
          numeroLote: l.numeroLote,
          fechaVence: l.fechaVence,
          cantidad: l.cantidadFarmacia,
          estado: l.estado,
          mesesParaVencer: Number(mesesParaVencer(l.fechaVence, ahora).toFixed(1)),
          semaforo: l.numeroLote === 'SIN-LOTE' ? 'sin_fecha' : semaforoBodega(l.fechaVence, ahora, rangos),
        })),
      };
    })
    .filter((x) => x.enFarmacia > 0 || x.enBodega > 0 || x.prescribible);
}

/**
 * Resumen de un dia de la farmacia: por insumo, el saldo con que abrio, lo
 * que recibio de la bodega, lo que devolvio, lo entregado, lo que no se pudo
 * entregar, los ajustes del conteo y el saldo con que cerro. Mas la lista de
 * entregas del dia, paciente por paciente y lote por lote.
 */
async function resumenDelDia(establecimientoId, fecha) {
  const { desde, hasta } = limitesDelDia(fecha);
  const delInsumo = { lote: { insumo: { establecimientoId } } };
  const [antes, delDia, faltantes, cierre] = await Promise.all([
    prisma.movimientoInsumo.groupBy({
      by: ['loteId'],
      where: { ...delInsumo, ubicacion: 'farmacia', registradoEn: { lt: desde } },
      _sum: { cantidad: true },
    }),
    prisma.movimientoInsumo.findMany({
      where: { ...delInsumo, ubicacion: 'farmacia', registradoEn: { gte: desde, lt: hasta } },
      include: {
        lote: { select: { numeroLote: true, fechaVence: true, insumoId: true, insumo: { select: { nombreGenerico: true, unidadEntrega: true } } } },
        usuario: { select: { nombre: true } },
        traslado: { select: { numero: true } },
        dispensacion: {
          select: {
            id: true,
            prescripcion: {
              select: {
                atencion: {
                  select: {
                    id: true,
                    medico: { select: { nombre: true } },
                    paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ registradoEn: 'asc' }, { id: 'asc' }],
    }),
    prisma.demandaNoAtendida.findMany({
      where: { establecimientoId, registradaEn: { gte: desde, lt: hasta } },
      include: { insumo: { select: { nombreGenerico: true, unidadEntrega: true } } },
    }),
    prisma.cierreFarmacia.findUnique({
      where: { establecimientoId_fecha: { establecimientoId, fecha: new Date(`${fecha}T00:00:00Z`) } },
      include: { usuario: { select: { nombre: true } }, conteos: { include: { insumo: { select: { nombreGenerico: true } } } } },
    }),
  ]);

  const lotesAntes = await prisma.lote.findMany({
    where: { id: { in: antes.map((a) => a.loteId) } },
    select: { id: true, insumoId: true, insumo: { select: { nombreGenerico: true, unidadEntrega: true } } },
  });
  const insumoDeLote = new Map(lotesAntes.map((l) => [l.id, l]));

  const fila = new Map();
  const asegurar = (insumoId, insumo) => {
    if (!fila.has(insumoId)) {
      fila.set(insumoId, {
        insumoId, nombre: insumo.nombreGenerico, unidadEntrega: insumo.unidadEntrega,
        saldoInicial: 0, recibido: 0, devuelto: 0, entregado: 0, noEntregado: 0, ajuste: 0, saldoFinal: 0,
      });
    }
    return fila.get(insumoId);
  };
  for (const a of antes) {
    const l = insumoDeLote.get(a.loteId);
    const f = asegurar(l.insumoId, l.insumo);
    f.saldoInicial += a._sum.cantidad ?? 0;
  }
  const entregas = new Map();
  for (const m of delDia) {
    const f = asegurar(m.lote.insumoId, m.lote.insumo);
    if (m.tipo === 'paso_farmacia') {
      if (m.cantidad > 0) f.recibido += m.cantidad;
      else f.devuelto -= m.cantidad;
    } else if (m.tipo === 'entrega' || m.tipo === 'devolucion') {
      f.entregado -= m.cantidad;
    } else if (m.tipo === 'reajuste') {
      f.ajuste += m.cantidad;
    }
    const atencion = m.dispensacion?.prescripcion?.atencion;
    if (m.tipo === 'entrega' && atencion) {
      if (!entregas.has(atencion.id)) {
        entregas.set(atencion.id, {
          atencionId: atencion.id,
          hora: m.registradoEn,
          paciente: { ...atencion.paciente, nombreCompleto: `${atencion.paciente.apellidos}, ${atencion.paciente.nombres}` },
          medico: atencion.medico?.nombre ?? null,
          entregadoPor: m.usuario.nombre,
          renglones: [],
        });
      }
      entregas.get(atencion.id).renglones.push({
        medicamento: m.lote.insumo.nombreGenerico,
        cantidad: -m.cantidad,
        numeroLote: m.lote.numeroLote,
        fechaVence: m.lote.fechaVence,
      });
    }
  }
  for (const d of faltantes) asegurar(d.insumoId, d.insumo).noEntregado += d.cantidad;
  const filas = [...fila.values()]
    .map((f) => ({ ...f, saldoFinal: f.saldoInicial + f.recibido - f.devuelto - f.entregado + f.ajuste }))
    .filter((f) => f.saldoInicial || f.recibido || f.devuelto || f.entregado || f.noEntregado || f.ajuste)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const recibos = new Map();
  for (const m of delDia.filter((x) => x.tipo === 'paso_farmacia')) {
    const clave = m.traslado?.numero ?? `${m.cantidad > 0 ? 'recibido' : 'devuelto'}-${m.registradoEn.toISOString()}`;
    if (!recibos.has(clave)) {
      recibos.set(clave, { numero: m.traslado?.numero ?? null, tipo: m.cantidad > 0 ? 'recibido' : 'devuelto', hora: m.registradoEn, usuario: m.usuario.nombre, motivo: m.motivo, renglones: [] });
    }
    recibos.get(clave).renglones.push({ medicamento: m.lote.insumo.nombreGenerico, numeroLote: m.lote.numeroLote, cantidad: Math.abs(m.cantidad) });
  }

  return {
    fecha,
    esHoy: fecha === hoyGuatemala(),
    filas,
    totales: {
      recibido: filas.reduce((s, f) => s + f.recibido, 0),
      entregado: filas.reduce((s, f) => s + f.entregado, 0),
      noEntregado: filas.reduce((s, f) => s + f.noEntregado, 0),
      pacientes: entregas.size,
    },
    entregas: [...entregas.values()],
    movimientosBodega: [...recibos.values()],
    cierre: cierre
      ? {
        cerradoEn: cierre.cerradoEn,
        cerradoPor: cierre.usuario.nombre,
        observacion: cierre.observacion,
        conteos: cierre.conteos.map((c) => ({
          insumoId: c.insumoId, nombre: c.insumo.nombreGenerico, enSistema: c.enSistema, contado: c.contado, diferencia: c.contado - c.enSistema, motivo: c.motivo,
        })),
      }
      : null,
  };
}

/**
 * Cierra el dia: lo contado se compara con el sistema y cada diferencia se
 * ajusta en la farmacia con su motivo (faltante o sobrante de inventario
 * fisico). Solo el dia de hoy: el conteo es de lo que hay ahora en el estante.
 */
async function cerrarDia(establecimientoId, { conteos, observacion = null }, usuarioId, ahora = new Date()) {
  const fecha = hoyGuatemala(ahora);
  const yaCerrado = await prisma.cierreFarmacia.findUnique({
    where: { establecimientoId_fecha: { establecimientoId, fecha: new Date(`${fecha}T00:00:00Z`) } },
  });
  if (yaCerrado) throw fallo(409, 'dia_cerrado', 'El día de hoy ya se cerró en farmacia');

  const ids = conteos.map((c) => c.insumoId);
  const insumos = await prisma.insumo.findMany({
    where: { id: { in: ids }, establecimientoId },
    include: { lotes: { orderBy: [{ fechaVence: 'asc' }, { id: 'asc' }] } },
  });
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const sinMotivo = [];
  for (const c of conteos) {
    const i = porId.get(c.insumoId);
    if (!i) throw fallo(404, 'insumo_no_encontrado', 'Uno de los insumos contados no existe');
    const enSistema = i.lotes.reduce((s, l) => s + l.cantidadFarmacia, 0);
    if (c.contado !== enSistema && !c.motivo) sinMotivo.push(i.nombreGenerico);
  }
  if (sinMotivo.length) {
    throw fallo(400, 'motivo_requerido', `Explique la diferencia de: ${sinMotivo.join(', ')}`, { insumos: sinMotivo });
  }

  return prisma.$transaction(async (tx) => {
    const cierre = await tx.cierreFarmacia.create({
      data: { establecimientoId, fecha: new Date(`${fecha}T00:00:00Z`), cerradoPor: usuarioId, observacion },
    });
    const ajustes = [];
    for (const c of conteos) {
      const i = porId.get(c.insumoId);
      const enSistema = i.lotes.reduce((s, l) => s + l.cantidadFarmacia, 0);
      const diferencia = c.contado - enSistema;
      await tx.conteoFarmacia.create({
        data: { cierreId: cierre.id, insumoId: i.id, enSistema, contado: c.contado, motivo: diferencia ? c.motivo : (c.motivo || null) },
      });
      if (!diferencia) continue;
      const motivo = `Conteo de farmacia del ${fecha}: ${c.motivo}`;
      if (diferencia < 0) {
        // Faltante: se descuenta de los lotes en farmacia, primero el que vence antes.
        let falta = -diferencia;
        for (const l of i.lotes.filter((x) => x.cantidadFarmacia > 0)) {
          if (!falta) break;
          const quitar = Math.min(falta, l.cantidadFarmacia);
          await registrarReajuste(tx, { loteId: l.id, cantidad: -quitar, causa: 'faltante_inventario_fisico', usuarioId, motivo, ubicacion: 'farmacia', ahora });
          ajustes.push({ insumo: i.nombreGenerico, numeroLote: l.numeroLote, cantidad: -quitar });
          falta -= quitar;
        }
      } else {
        // Sobrante: al lote que ya esta en farmacia y vence antes; si no hay,
        // al lote vigente del insumo que vence antes.
        const lote = i.lotes.find((x) => x.cantidadFarmacia > 0)
          ?? i.lotes.find((x) => new Date(x.fechaVence) > ahora)
          ?? i.lotes[i.lotes.length - 1];
        if (!lote) throw fallo(409, 'sin_lote', `${i.nombreGenerico} no tiene ningún lote registrado: registre su recepción en bodega`);
        await registrarReajuste(tx, { loteId: lote.id, cantidad: diferencia, causa: 'sobrante_inventario_fisico', usuarioId, motivo, ubicacion: 'farmacia', ahora });
        ajustes.push({ insumo: i.nombreGenerico, numeroLote: lote.numeroLote, cantidad: diferencia });
      }
    }
    return { cierre, ajustes };
  }, { timeout: 60000 });
}

/** Devolucion de la farmacia a la bodega (por ejemplo, lo que va a vencer). */
async function devolverABodega(establecimientoId, { renglones, motivo }, usuarioId) {
  const lotes = await prisma.lote.findMany({
    where: { id: { in: renglones.map((r) => r.loteId) }, insumo: { establecimientoId } },
    select: { id: true },
  });
  if (lotes.length !== new Set(renglones.map((r) => r.loteId)).size) {
    throw fallo(404, 'lote_no_encontrado', 'Uno de los lotes no existe');
  }
  return prisma.$transaction(async (tx) => {
    const hechos = [];
    for (const r of renglones) {
      const lote = await pasarEntreUbicaciones(tx, {
        loteId: r.loteId, cantidad: r.cantidad, desde: 'farmacia', usuarioId, motivo: `Devolución a bodega: ${motivo}`,
      });
      hechos.push({ loteId: lote.id, numeroLote: lote.numeroLote, cantidad: r.cantidad, quedaEnFarmacia: lote.cantidadFarmacia });
    }
    return hechos;
  });
}

/**
 * Poner el lote a lo que entró sin número ("SIN-LOTE", en cuarentena): se
 * mira la caja y se escribe el lote y el vencimiento. La cantidad pasa del
 * registro sin lote al lote real con dos movimientos en el kardex, y desde ahí
 * se puede entregar y rastrear hasta el paciente.
 */
async function ponerLote(establecimientoId, { loteId, numeroLote, fechaVence, cantidad }, usuarioId) {
  const origen = await prisma.lote.findFirst({ where: { id: loteId, insumo: { establecimientoId } }, include: { insumo: { select: { nombreGenerico: true } } } });
  if (!origen) throw fallo(404, 'lote_no_encontrado', 'El registro no existe');
  if (origen.numeroLote !== 'SIN-LOTE') throw fallo(409, 'ya_tiene_lote', `Este registro ya tiene lote: ${origen.numeroLote}`);
  if (cantidad > origen.cantidadFarmacia) throw fallo(409, 'cantidad_excede', `En farmacia hay ${origen.cantidadFarmacia} sin lote de este producto`);
  const numero = numeroLote.trim().toUpperCase();
  if (numero === 'SIN-LOTE') throw fallo(400, 'lote_invalido', 'Escriba el número de lote que dice la caja');
  const vence = new Date(`${fechaVence}T12:00:00Z`);

  return prisma.$transaction(async (tx) => {
    let destino = await tx.lote.findFirst({ where: { insumoId: origen.insumoId, numeroLote: numero } });
    if (destino && destino.fechaVence.toISOString().slice(0, 10) !== fechaVence) {
      throw fallo(409, 'vencimiento_distinto', `El lote ${numero} ya existe con vencimiento ${destino.fechaVence.toISOString().slice(0, 10)}: revise la caja`);
    }
    if (!destino) {
      destino = await tx.lote.create({
        data: {
          insumoId: origen.insumoId, numeroLote: numero, fechaVence: vence, cantidadInicial: cantidad, cantidadActual: 0,
          cantidadFarmacia: 0, origen: origen.origen, recibidoEn: origen.recibidoEn, requisicionId: origen.requisicionId,
          observacionRecepcion: 'Identificado en farmacia a partir de existencia sin lote',
        },
      });
    }
    const motivo = `Se identificó el lote ${numero} (vence ${fechaVence}) en existencia registrada sin lote`;
    await registrarReajuste(tx, { loteId: origen.id, cantidad: -cantidad, causa: 'correccion_error_registro_negativa', usuarioId, motivo, ubicacion: 'farmacia' });
    await registrarReajuste(tx, { loteId: destino.id, cantidad, causa: 'correccion_error_registro_positiva', usuarioId, motivo, ubicacion: 'farmacia' });
    return { insumo: origen.insumo.nombreGenerico, loteId: destino.id, numeroLote: numero, cantidad };
  });
}

module.exports = { hoyGuatemala, limitesDelDia, existencias, resumenDelDia, cerrarDia, devolverABodega, ponerLote };
