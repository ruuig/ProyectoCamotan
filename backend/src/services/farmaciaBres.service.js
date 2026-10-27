/**
 * BRES de la farmacia (post-consulta).
 *
 * Post-consulta lleva su propia existencia: recibe de la bodega por
 * requisición, entrega a los pacientes y cuenta su estante. Su BRES se arma
 * solo con los movimientos que ocurrieron en la farmacia, con las mismas
 * columnas y fórmulas del BRES del centro, para imprimirlo en el formulario:
 *
 *   B saldo anterior   = lo que había en farmacia al empezar el mes.
 *   C entradas         = lo que llegó de la bodega.
 *   D entregado        = lo entregado a pacientes, menos las entregas anuladas.
 *   E no entregado     = lo recetado que no había.
 *   G reajustes        = conteos del estante, correcciones y devoluciones a bodega.
 *   H saldo siguiente  = B + C - D + G (lo que hay en el estante).
 *   J promedio         = demanda (D + E) de los últimos meses.
 *
 * Los meses anteriores al sistema salen del informe de post-consulta: el que
 * se importó del Excel o el que farmacia escribe a mano desde su BRES de papel
 * (solo entradas, entregado, no entregado y reajustes; lo demás se calcula).
 * Un mes con informe se toma de ahí, para sus cifras y para el promedio.
 */
const prisma = require('../config/db');
const { configuracion, limitesDePeriodo } = require('./abastecimiento.service');
const { filaBres, ultimosPeriodos, periodoAnterior } = require('./bodega.service');
const { parametrosBres } = require('./bodegaDatos.service');
const { COLUMNAS } = require('./bres.service');
const { periodoDe } = require('./logistica.service');

const vacia = () => ({ B: 0, C: 0, D: 0, E: 0, G: 0 });
// Así queda marcado el informe que farmacia escribe a mano.
const MARCA = 'Escrito por farmacia';
const CAMPOS_INFORME = { insumoId: true, saldoAnterior: true, entradas: true, entregado: true, noEntregado: true, saldoSiguiente: true };

async function bresFarmacia(establecimientoId, periodo) {
  const config = await configuracion(establecimientoId);
  const p = parametrosBres(config);
  const { desde, hasta } = limitesDePeriodo(periodo);
  // Meses del promedio: los anteriores al del BRES, como en el del centro.
  const meses = ultimosPeriodos(periodoAnterior(periodo), p.mesesPromedio);
  const inicioHistoria = limitesDePeriodo(meses[0]).desde;
  const delInsumo = { lote: { insumo: { establecimientoId } } };

  const [antes, movimientos, faltantes, insumos, informes] = await Promise.all([
    prisma.movimientoInsumo.findMany({
      where: { ...delInsumo, ubicacion: 'farmacia', registradoEn: { lt: desde } },
      select: { cantidad: true, lote: { select: { insumoId: true } } },
    }),
    prisma.movimientoInsumo.findMany({
      where: { ...delInsumo, ubicacion: 'farmacia', registradoEn: { gte: inicioHistoria, lt: hasta } },
      select: { tipo: true, cantidad: true, registradoEn: true, lote: { select: { insumoId: true } } },
    }),
    prisma.demandaNoAtendida.findMany({
      where: { establecimientoId, registradaEn: { gte: inicioHistoria, lt: hasta } },
      select: { insumoId: true, cantidad: true, registradaEn: true },
    }),
    prisma.insumo.findMany({ where: { establecimientoId }, orderBy: [{ nombreGenerico: 'asc' }, { concentracion: 'asc' }] }),
    prisma.informeServicio.findMany({
      where: { periodo: { in: [...meses, periodo] }, importado: true, ubicacion: { establecimientoId, tipo: 'centro_salud' } },
      select: { periodo: true, observacion: true, renglones: { select: CAMPOS_INFORME } },
    }),
  ]);

  const mes = new Map(); // insumo -> cifras del mes del BRES
  const demandaHistoria = new Map(); // insumo -> demanda de los meses del promedio
  const delMes = (id) => { if (!mes.has(id)) mes.set(id, vacia()); return mes.get(id); };
  const sumarHistoria = (id, n) => demandaHistoria.set(id, (demandaHistoria.get(id) ?? 0) + n);
  // Un mes con informe cuenta con ese informe y no con lo del sistema.
  // Los meses de antes del primer dato (informe o movimiento) no cuentan como
  // cero: el promedio se saca de los meses que sí tienen datos.
  const [primerInforme, inicio] = await Promise.all([
    prisma.informeServicio.findFirst({
      where: { importado: true, ubicacion: { establecimientoId, tipo: 'centro_salud' } },
      orderBy: { periodo: 'asc' },
      select: { periodo: true },
    }),
    mesDeInicio(establecimientoId),
  ]);
  const primero = [primerInforme?.periodo, inicio].filter(Boolean).sort()[0];
  const mesesConDatos = primero ? meses.filter((m) => m >= primero) : [];
  const divisor = mesesConDatos.length || p.mesesPromedio;

  const informeDe = new Map(informes.map((i) => [i.periodo, i]));
  const conInforme = new Set(meses.filter((m) => informeDe.has(m)));
  const delSistema = (fecha) => !conInforme.has(periodoDe(fecha));
  for (const m of conInforme) for (const r of informeDe.get(m).renglones) sumarHistoria(r.insumoId, r.entregado + r.noEntregado);

  const informeMes = informeDe.get(periodo);
  if (informeMes) {
    // Mes de antes del sistema: sus cifras como se informaron; G es lo que no cuadra.
    for (const r of informeMes.renglones) {
      mes.set(r.insumoId, { B: r.saldoAnterior, C: r.entradas, D: r.entregado, E: r.noEntregado, G: r.saldoSiguiente - (r.saldoAnterior + r.entradas - r.entregado) });
    }
  } else {
    for (const m of antes) delMes(m.lote.insumoId).B += m.cantidad;
  }
  const movidoEnMes = movimientos.some((m) => m.registradoEn >= desde);
  for (const m of movimientos) {
    const id = m.lote.insumoId;
    const enMes = m.registradoEn >= desde && !informeMes;
    if (m.tipo === 'entrega' || m.tipo === 'devolucion') {
      // La devolución de una entrega anulada regresa al estante: resta de lo entregado.
      if (enMes) delMes(id).D -= m.cantidad;
      else if (delSistema(m.registradoEn)) sumarHistoria(id, -m.cantidad);
    } else if (enMes) {
      if (m.tipo === 'paso_farmacia' && m.cantidad > 0) delMes(id).C += m.cantidad;
      else delMes(id).G += m.cantidad;
    }
  }
  for (const f of faltantes) {
    if (f.registradaEn >= desde) { if (!informeMes) delMes(f.insumoId).E += f.cantidad; }
    else if (delSistema(f.registradaEn)) sumarHistoria(f.insumoId, f.cantidad);
  }

  const renglones = [];
  for (const i of insumos) {
    const c = mes.get(i.id) ?? vacia();
    const historia = demandaHistoria.get(i.id) ?? 0;
    if (!c.B && !c.C && !c.D && !c.E && !c.G && !historia) continue;
    const H = c.B + c.C - c.D + c.G;
    const b = filaBres({ B: c.B, C: c.C, D: c.D, E: c.E, G: c.G, I: H, saldos: [], promedios: [historia / divisor], config: p });
    renglones.push({
      insumoId: i.id,
      codigoInterno: i.codigoInterno,
      nombre: i.nombreGenerico,
      formaFarmaceutica: i.formaFarmaceutica,
      concentracion: i.concentracion,
      unidadEntrega: i.unidadEntrega,
      categoria: i.categoria,
      saldoInicial: b.B,
      entradas: b.C,
      entregado: b.D,
      noEntregado: b.E,
      demandaReal: b.F,
      reajustes: b.G,
      saldoFinal: b.H,
      existenciaBodega: b.I,
      pmdr: b.J,
      med: b.K,
      cantidadMaxima: b.L,
      cantidadSolicitar: Math.max(0, b.M),
    });
  }

  return {
    periodo,
    servicio: 'Farmacia (post-consulta)',
    columnas: COLUMNAS,
    renglones,
    // La farmacia informa por el sistema: no hay servicios ni recepciones que revisar.
    descuadres: [],
    observacionesRecepcion: [],
    serviciosSinInforme: 0,
    // De dónde salen las cifras del mes: excel, farmacia (a mano), sistema o vacio.
    fuente: informeMes ? (informeMes.observacion === MARCA ? 'farmacia' : 'excel') : antes.length || movidoEnMes ? 'sistema' : 'vacio',
    // Los meses del promedio y cuáles salen de un informe (Excel o a mano).
    historia: { meses: mesesConDatos, delExcel: mesesConDatos.filter((m) => conInforme.has(m)) },
    configuracion: p,
    firmas: {
      encargadoBodega: null,
      coordinadorMunicipal: config.coordinadorMunicipal,
      cargoCoordinador: config.cargoCoordinador,
    },
  };
}

function fallo(status, codigo, mensaje, detalles = null) {
  return Object.assign(new Error(mensaje), { status, codigo, mensaje, detalles });
}

function periodoSiguiente(p) {
  const [a, m] = p.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

/** Mes (AAAA-MM, hora de Guatemala) en que farmacia empezó a usar el sistema. */
async function mesDeInicio(establecimientoId) {
  const primero = await prisma.movimientoInsumo.findFirst({
    where: { ubicacion: 'farmacia', lote: { insumo: { establecimientoId } } },
    orderBy: { registradoEn: 'asc' },
    select: { registradoEn: true },
  });
  return primero ? periodoDe(primero.registradoEn) : null;
}

/**
 * Un mes de antes del sistema, para escribirlo desde el BRES de papel. Solo se
 * piden entradas (C), entregado (D), no entregado (E) y reajustes (G); el saldo
 * anterior (B) sale del mes anterior si ya está, y solo se escribe en el primero.
 */
async function historialFarmacia(establecimientoId, periodo) {
  const ubicacion = await prisma.ubicacion.findFirst({ where: { establecimientoId, tipo: 'centro_salud' } });
  if (!ubicacion) throw fallo(404, 'sin_farmacia', 'El centro no tiene post-consulta registrada');
  const [informe, previo, insumos, inicio] = await Promise.all([
    prisma.informeServicio.findUnique({ where: { ubicacionId_periodo: { ubicacionId: ubicacion.id, periodo } }, include: { renglones: true } }),
    prisma.informeServicio.findUnique({ where: { ubicacionId_periodo: { ubicacionId: ubicacion.id, periodo: periodoAnterior(periodo) } }, include: { renglones: true } }),
    prisma.insumo.findMany({ where: { establecimientoId, activo: true }, orderBy: [{ nombreGenerico: 'asc' }, { concentracion: 'asc' }] }),
    mesDeInicio(establecimientoId),
  ]);
  let bloqueado = null;
  if (inicio && periodo >= inicio) bloqueado = 'sistema';
  else if (informe && informe.observacion !== MARCA) bloqueado = 'excel';
  const deInforme = new Map((informe?.renglones ?? []).map((r) => [r.insumoId, r]));
  const saldoPrevio = previo ? new Map(previo.renglones.map((r) => [r.insumoId, r.saldoSiguiente])) : null;
  return {
    periodo,
    bloqueado,
    // Con el mes anterior escrito, el saldo anterior ya no se escribe.
    saldoDelMesAnterior: Boolean(saldoPrevio),
    renglones: insumos.map((i) => {
      const r = deInforme.get(i.id);
      const B = saldoPrevio ? (saldoPrevio.get(i.id) ?? 0) : (r?.saldoAnterior ?? 0);
      return {
        insumoId: i.id,
        nombre: i.nombreGenerico,
        unidadEntrega: i.unidadEntrega,
        saldoAnterior: B,
        entradas: r?.entradas ?? 0,
        entregado: r?.entregado ?? 0,
        noEntregado: r?.noEntregado ?? 0,
        reajustes: r ? r.saldoSiguiente - (r.saldoAnterior + r.entradas - r.entregado) : 0,
      };
    }),
  };
}

/**
 * Guarda un mes escrito por farmacia y reencadena los meses que siguen (también
 * escritos por farmacia): su saldo anterior es el saldo del mes de antes.
 */
async function guardarHistorial(establecimientoId, periodo, { renglones }, usuarioId) {
  const form = await historialFarmacia(establecimientoId, periodo);
  if (form.bloqueado === 'sistema') throw fallo(409, 'mes_del_sistema', 'Ese mes ya lo lleva el sistema');
  if (form.bloqueado === 'excel') throw fallo(409, 'mes_del_excel', 'Ese mes viene del Excel de la bodega');
  const ubicacion = await prisma.ubicacion.findFirst({ where: { establecimientoId, tipo: 'centro_salud' } });
  const escritos = new Map(renglones.map((r) => [r.insumoId, r]));
  const filas = [];
  const negativos = [];
  for (const b of form.renglones) {
    const r = escritos.get(b.insumoId) ?? {};
    const B = form.saldoDelMesAnterior ? b.saldoAnterior : (r.saldoAnterior ?? b.saldoAnterior);
    const fila = {
      insumoId: b.insumoId,
      saldoAnterior: B,
      entradas: r.entradas ?? b.entradas,
      entregado: r.entregado ?? b.entregado,
      noEntregado: r.noEntregado ?? b.noEntregado,
    };
    fila.saldoSiguiente = B + fila.entradas - fila.entregado + (r.reajustes ?? b.reajustes);
    if (fila.saldoSiguiente < 0) negativos.push(b.nombre);
    if (fila.saldoAnterior || fila.entradas || fila.entregado || fila.noEntregado || fila.saldoSiguiente) filas.push(fila);
  }
  if (negativos.length) throw fallo(400, 'saldo_negativo', `El saldo queda en negativo: ${negativos.join(', ')}`, { insumos: negativos });

  await prisma.$transaction(async (tx) => {
    const datos = { capturadoPor: usuarioId, capturadoEn: new Date(), revisado: true, importado: true, observacion: MARCA };
    const informe = await tx.informeServicio.upsert({
      where: { ubicacionId_periodo: { ubicacionId: ubicacion.id, periodo } },
      create: { ubicacionId: ubicacion.id, periodo, ...datos },
      update: datos,
    });
    await tx.informeServicioRenglon.deleteMany({ where: { informeId: informe.id } });
    await tx.informeServicioRenglon.createMany({ data: filas.map((f) => ({ informeId: informe.id, ...f })) });

    // Los meses siguientes escritos a mano toman el nuevo saldo como su saldo anterior.
    let saldos = new Map(filas.map((f) => [f.insumoId, f.saldoSiguiente]));
    let mes = periodo;
    for (;;) {
      mes = periodoSiguiente(mes);
      const sig = await tx.informeServicio.findUnique({ where: { ubicacionId_periodo: { ubicacionId: ubicacion.id, periodo: mes } }, include: { renglones: true } });
      if (!sig || sig.observacion !== MARCA) break;
      const nuevos = new Map();
      for (const r of sig.renglones) {
        const B = saldos.get(r.insumoId) ?? 0;
        const G = r.saldoSiguiente - (r.saldoAnterior + r.entradas - r.entregado);
        const H = B + r.entradas - r.entregado + G;
        await tx.informeServicioRenglon.update({ where: { id: r.id }, data: { saldoAnterior: B, saldoSiguiente: H } });
        nuevos.set(r.insumoId, H);
      }
      saldos = nuevos;
    }
  }, { timeout: 60000 });
  return { periodo, renglones: filas.length };
}

module.exports = { bresFarmacia, historialFarmacia, guardarHistorial };

