/**
 * Escribe en la base la migracion de la bodega que preparo
 * scripts/importarBodega.js. Una sola transaccion: o queda todo o nada.
 *
 *   1. Borra el inventario de prueba (insumos, lotes, movimientos y todo lo
 *      que cuelga de ellos).
 *   2. Crea el catalogo del balance, con su orden, categoria y alias.
 *   3. Carga el historial: reportes de cada servicio por mes y los BRES
 *      cerrados con las cifras del balance. Post-consulta es el propio centro:
 *      su historial queda como reporte de post-consulta, para el promedio.
 *   4. Crea la existencia del centro (bodega + post-consulta) al cierre del
 *      ultimo mes, con los lotes del semaforo. Lo que no tiene lote conocido
 *      queda en cuarentena para registrar su lote en el inventario fisico.
 */

const { entero } = require('../src/services/importacionBodega.service');
const { normalizarAlias } = require('../src/services/bodega.service');

// Fin del ultimo mes en hora de Guatemala (UTC-6), un minuto antes del corte.
function finDelMes(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(Date.UTC(anio, mes, 1) + 6 * 3600000 - 60000);
}

module.exports = async function aplicar({ prisma, eid, catalogo, duenoAlias, mapaServicios, meses, conciliacion, existenciaCentro }) {
  const admin = await prisma.usuario.findFirst({ where: { establecimientoId: eid, rol: 'admin' } });
  const ultimo = meses[meses.length - 1];
  const fechaInicial = finDelMes(ultimo.periodo);
  const hoy = new Date();

  await prisma.$transaction(async (tx) => {
    // --- 1. Inventario de prueba -------------------------------------------
    const insumos = (await tx.insumo.findMany({ where: { establecimientoId: eid }, select: { id: true } })).map((i) => i.id);
    const lotes = (await tx.lote.findMany({ where: { insumoId: { in: insumos } }, select: { id: true } })).map((l) => l.id);
    const prescripciones = (await tx.prescripcion.findMany({ where: { insumoId: { in: insumos } }, select: { id: true } })).map((p) => p.id);
    await tx.alerta.deleteMany({ where: { establecimientoId: eid, entidadTipo: { in: ['lote', 'insumo', 'ubicacion', 'reporte_servicio'] } } });
    await tx.retiroPaciente.deleteMany({ where: { loteId: { in: lotes } } });
    await tx.retiroLote.deleteMany({ where: { loteId: { in: lotes } } });
    await tx.retiroSanitario.deleteMany({ where: { establecimientoId: eid, lotes: { none: {} } } });
    await tx.oficioBaja.deleteMany({ where: { loteId: { in: lotes } } });
    await tx.conteoFisico.deleteMany({ where: { loteId: { in: lotes } } });
    await tx.inventarioFisico.deleteMany({ where: { establecimientoId: eid } });
    await tx.movimientoInsumo.deleteMany({ where: { loteId: { in: lotes } } });
    await tx.traslado.deleteMany({ where: { establecimientoId: eid } });
    await tx.dispensacion.deleteMany({ where: { prescripcionId: { in: prescripciones } } });
    await tx.demandaNoAtendida.deleteMany({ where: { insumoId: { in: insumos } } });
    await tx.prescripcion.deleteMany({ where: { id: { in: prescripciones } } });
    await tx.bresRenglon.deleteMany({ where: { insumoId: { in: insumos } } });
    await tx.bres.deleteMany({ where: { establecimientoId: eid } });
    await tx.reporteServicio.deleteMany({ where: { ubicacion: { establecimientoId: eid } } });
    await tx.lote.deleteMany({ where: { id: { in: lotes } } });
    await tx.insumoAlias.deleteMany({ where: { insumoId: { in: insumos } } });
    await tx.insumo.deleteMany({ where: { id: { in: insumos } } });

    // --- 2. Catalogo ----------------------------------------------------------
    await tx.insumo.createMany({
      data: catalogo.map((c) => ({
        establecimientoId: eid,
        codigoInterno: `INS-${String(c.orden).padStart(5, '0')}`,
        nombreGenerico: c.nombre,
        categoria: c.categoria,
        // El Excel no separa forma ni presentacion: el nombre las trae.
        presentacion: 'unidad',
        unidadMedida: 'unidad',
        unidadEntrega: 'unidad',
        ordenFormulario: c.orden,
      })),
    });
    const creados = await tx.insumo.findMany({ where: { establecimientoId: eid }, select: { id: true, ordenFormulario: true } });
    const idDe = new Map(creados.map((i) => [i.ordenFormulario, i.id]));
    await tx.insumoAlias.createMany({
      data: [...duenoAlias.entries()].map(([norm, a]) => ({ insumoId: idDe.get(a.clave), alias: a.nombre, aliasNormalizado: norm })),
      skipDuplicates: true,
    });

    // --- 3. Historial ------------------------------------------------------------
    for (const m of meses) {
      for (const [nombreServicio, ubicacion] of mapaServicios) {
        if (!ubicacion) continue;
        const renglones = [];
        m.renglones.forEach((r) => {
          const clave = catalogo.find((c) => normalizarAlias(c.nombre) === normalizarAlias(r.nombre))?.clave;
          const s = r.servicios.find((x) => x.servicio === nombreServicio);
          if (!clave || !s) return;
          const valores = [s.saldoAnterior, s.entradas, s.entregado, s.noEntregado, s.saldoSiguiente].map(entero);
          if (valores.every((v) => v === 0)) return;
          renglones.push({
            insumoId: idDe.get(clave),
            saldoAnterior: valores[0],
            entradas: Math.max(0, valores[1]),
            entregado: Math.max(0, valores[2]),
            noEntregado: Math.max(0, valores[3]),
            saldoSiguiente: valores[4],
            promedioAnotado: s.promedio === null || s.promedio === undefined ? null : entero(s.promedio),
          });
        });
        if (!renglones.length) continue;
        const rep = await tx.reporteServicio.create({
          data: { ubicacionId: ubicacion.id, periodo: m.periodo, capturadoPor: admin.id, revisado: true, importado: true, observacion: `Importado de ${m.hoja}` },
        });
        await tx.reporteServicioRenglon.createMany({ data: renglones.map((x) => ({ ...x, reporteId: rep.id })), skipDuplicates: true });
      }

      // El BRES del mes, cerrado, con las cifras que el centro envio.
      const bres = await tx.bres.create({
        data: { establecimientoId: eid, periodo: m.periodo, estado: 'cerrado', generadoPor: admin.id, cerradoEn: finDelMes(m.periodo), observaciones: `Importado del balance ${m.hoja}` },
      });
      const vistos = new Set();
      const filas = [];
      for (const r of m.renglones) {
        const clave = catalogo.find((c) => normalizarAlias(c.nombre) === normalizarAlias(r.nombre))?.clave;
        if (!clave || vistos.has(clave) || !r.totales) continue;
        vistos.add(clave);
        const t = r.totales;
        const J = Number(t.J) || 0;
        filas.push({
          bresId: bres.id,
          insumoId: idDe.get(clave),
          saldoInicial: entero(t.B), entradas: entero(t.C), reajustes: 0, entregado: entero(t.D), noEntregado: entero(t.E),
          demandaReal: entero(t.F), saldoFinal: entero(t.H), existenciaBodega: entero(t.I),
          pmdr: J, med: J > 0 && Number.isFinite(Number(t.K)) ? Math.round(Number(t.K) * 100) / 100 : null,
          cantidadMaxima: entero(t.L), cantidadSolicitar: entero(t.M), cantidadMinima: Math.round(J * 2),
        });
      }
      await tx.bresRenglon.createMany({ data: filas });
    }

    // --- 4. Existencia inicial con sus lotes ---------------------------------------
    for (const { c, lotes: lotesConciliados, sinLote } of conciliacion) {
      const insumoId = idDe.get(c.clave);
      // El mismo lote anotado dos veces en el semaforo se junta.
      const porNumero = new Map();
      for (const l of lotesConciliados) {
        const previo = porNumero.get(l.lote);
        porNumero.set(l.lote, previo ? { ...previo, cantidad: previo.cantidad + l.cantidad } : { ...l });
      }
      const aCrear = [...porNumero.values()].map((l) => ({
        numeroLote: l.lote,
        fechaVence: new Date(`${l.vence}T12:00:00Z`),
        cantidad: l.cantidad,
        estado: new Date(`${l.vence}T12:00:00Z`) < hoy ? 'vencido' : 'disponible',
        motivoEstado: null,
      }));
      if (sinLote > 0) {
        aCrear.push({
          numeroLote: 'SIN-LOTE',
          // Sin fecha conocida: se registra la real en el inventario fisico.
          fechaVence: new Date(Date.UTC(hoy.getUTCFullYear() + 1, hoy.getUTCMonth(), 1)),
          cantidad: sinLote,
          estado: 'cuarentena',
          motivoEstado: 'Saldo importado sin lote ni vencimiento: registrar el lote real en el inventario físico',
        });
      }
      for (const l of aCrear) {
        const lote = await tx.lote.create({
          data: {
            insumoId, numeroLote: l.numeroLote, fechaVence: l.fechaVence, cantidadInicial: l.cantidad, cantidadActual: l.cantidad,
            recibidoEn: fechaInicial, origen: 'despacho', estado: l.estado, motivoEstado: l.motivoEstado, estadoEn: fechaInicial, estadoPor: admin.id,
            observacionRecepcion: `Saldo inicial importado del inventario de cierre y post-consulta de ${ultimo.hoja}`,
          },
        });
        await tx.movimientoInsumo.create({
          data: {
            loteId: lote.id, tipo: 'ingreso', cantidad: l.cantidad, saldoResultante: l.cantidad, usuarioId: admin.id,
            motivo: `Saldo inicial al cierre de ${ultimo.hoja} (bodega + post-consulta)`, registradoEn: fechaInicial,
          },
        });
      }
    }

    await tx.configuracionLogistica.upsert({
      where: { establecimientoId: eid },
      create: { establecimientoId: eid, nivelMinimoMeses: 2, nivelMaximoMeses: ultimo.nivelMaximo ?? 4 },
      update: { nivelMinimoMeses: 2, nivelMaximoMeses: ultimo.nivelMaximo ?? 4 },
    });

    await tx.bitacora.createMany({
      data: [
        { usuarioId: admin.id, accion: 'eliminar', entidad: 'insumo', detalle: `Inventario de prueba eliminado: ${insumos.length} insumos, ${lotes.length} lotes` },
        { usuarioId: admin.id, accion: 'crear', entidad: 'insumo', detalle: `Catálogo del balance ${ultimo.hoja}: ${catalogo.length} insumos, ${duenoAlias.size} alias` },
        { usuarioId: admin.id, accion: 'crear', entidad: 'reporte_servicio', detalle: `Historial importado: ${meses.length} meses (${meses[0].periodo} a ${ultimo.periodo}) y sus BRES` },
        { usuarioId: admin.id, accion: 'crear', entidad: 'lote', detalle: `Existencia inicial al cierre de ${ultimo.hoja}: ${conciliacion.reduce((s, x) => s + existenciaCentro(x.c.clave), 0)} unidades` },
      ],
    });
  }, { timeout: 900000, maxWait: 30000 });

  for (const vista of ['saldo_insumo', 'consumo_diario', 'cobertura_comunidad']) {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${vista}`).catch(() => {});
  }
  console.log('Carga aplicada.');
};
