const prisma = require('../config/db');
const { validarFechasLote, CATEGORIAS_NO_PRESCRIBIBLES } = require('../services/bodega.service');
const { enUbicacion } = require('../services/inventario.service');
const { registrarIngreso } = require('../services/movimientos.service');
const {
  mesesParaVencer,
} = require('../services/logistica.service');
const abastecimiento = require('../services/abastecimiento.service');

async function listar(req, res) {
  const { buscar, categoria, prescribible } = req.query;

  const insumos = await prisma.insumo.findMany({
    where: {
      establecimientoId: req.usuario.establecimientoId,
      activo: true,
      ...(categoria ? { categoria } : {}),
      // La receta del medico solo ofrece lo que se entrega al paciente.
      ...(prescribible !== undefined ? { prescribible } : {}),
      // Los cinco criterios de busqueda que el personal usa en la practica:
      // nombre generico, componente activo, codigo del cuadro basico MSPAS,
      // nombre comercial y numero de lote.
      ...(buscar
        ? {
            OR: [
              { nombreGenerico: { contains: buscar, mode: 'insensitive' } },
              { nombreComercial: { contains: buscar, mode: 'insensitive' } },
              { componente: { contains: buscar, mode: 'insensitive' } },
              { codigoMspas: { contains: buscar, mode: 'insensitive' } },
              { lotes: { some: { numeroLote: { contains: buscar, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    orderBy: { nombreGenerico: 'asc' },
    include: { lotes: { orderBy: { fechaVence: 'asc' } } },
  });

  const ahora = new Date();
  const colorDe = await abastecimiento.semaforoDelCentro(req.usuario.establecimientoId);

  res.json({
    insumos: insumos.map((insumo) => {
      // Solo cuenta lo que se puede entregar hoy: un lote en cuarentena está
      // físicamente ahí pero no es existencia utilizable.
      const saldo = abastecimiento.saldoUtilizable(insumo.lotes, ahora);
      const proximo = insumo.lotes
        .filter((l) => l.estado === 'disponible' && l.cantidadActual > 0 && l.fechaVence > ahora)
        .sort((a, b) => new Date(a.fechaVence) - new Date(b.fechaVence))[0];

      return {
        id: insumo.id,
        codigoMspas: insumo.codigoMspas,
        nombreGenerico: insumo.nombreGenerico,
        nombreComercial: insumo.nombreComercial,
        presentacion: insumo.presentacion,
        unidadMedida: insumo.unidadMedida,
        categoria: insumo.categoria,
        codigoInterno: insumo.codigoInterno,
        formaFarmaceutica: insumo.formaFarmaceutica,
        concentracion: insumo.concentracion,
        unidadEntrega: insumo.unidadEntrega,
        cadenaFrio: insumo.cadenaFrio,
        prescribible: insumo.prescribible,
        saldoTotal: saldo,
        // Donde esta: farmacia entrega a los pacientes, bodega traslada.
        saldoBodega: abastecimiento.saldoUtilizable(enUbicacion(insumo.lotes, 'bodega'), ahora),
        saldoFarmacia: abastecimiento.saldoUtilizable(enUbicacion(insumo.lotes, 'farmacia'), ahora),
        lotesConSaldo: insumo.lotes.filter((l) => l.cantidadActual > 0).length,
        lotesEnCuarentena: insumo.lotes.filter((l) => l.estado === 'cuarentena').length,
        proximoVencimiento: proximo
          ? {
              fechaVence: proximo.fechaVence,
              mesesParaVencer: Number(mesesParaVencer(proximo.fechaVence, ahora).toFixed(1)),
              semaforo: colorDe(proximo.fechaVence, ahora),
            }
          : null,
      };
    }),
  });
}

async function crear(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  if (req.body.codigoMspas) {
    const existente = await prisma.insumo.findFirst({
      where: { establecimientoId, codigoMspas: req.body.codigoMspas },
    });
    if (existente) {
      return next({
        status: 409,
        codigo: 'codigo_duplicado',
        mensaje: `Ya existe un insumo con el código ${req.body.codigoMspas}`,
      });
    }
  }

  // El MSPAS identifica por nombre generico, forma y concentracion. Dos
  // insumos activos con la misma identidad serian el mismo producto llevando
  // dos tarjetas de control, y ninguna de las dos cuadraria.
  const gemelo = await prisma.insumo.findFirst({
    where: {
      establecimientoId,
      activo: true,
      nombreGenerico: { equals: req.body.nombreGenerico, mode: 'insensitive' },
      formaFarmaceutica: req.body.formaFarmaceutica ?? null,
      concentracion: req.body.concentracion ?? null,
    },
  });

  if (gemelo) {
    return next({
      status: 409,
      codigo: 'insumo_duplicado',
      mensaje: `Ya existe "${gemelo.nombreGenerico}${gemelo.formaFarmaceutica ? ` ${gemelo.formaFarmaceutica}` : ''}${gemelo.concentracion ? ` ${gemelo.concentracion}` : ''}" con el código ${gemelo.codigoInterno}`,
      detalles: { insumoId: gemelo.id },
    });
  }

  const datos = { ...req.body, establecimientoId };
  datos.unidadEntrega = datos.unidadEntrega ?? datos.unidadMedida;
  datos.prescribible = datos.prescribible ?? !CATEGORIAS_NO_PRESCRIBIBLES.includes(datos.categoria);

  const insumo = await prisma.$transaction(async (tx) => {
    if (!datos.codigoInterno) {
      const ultimo = await tx.insumo.findFirst({
        where: { establecimientoId },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      datos.codigoInterno = `INS-${String((ultimo?.id ?? 0) + 1).padStart(5, '0')}`;
    }
    return tx.insumo.create({ data: datos });
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'insumo',
    entidadId: insumo.id,
    detalle: `${insumo.codigoInterno} ${insumo.nombreGenerico}`,
  });

  res.status(201).json({ insumo });
}

async function cobertura(req, res, next) {
  const datos = await abastecimiento.evaluarAbastecimiento(
    req.params.id,
    req.usuario.establecimientoId,
  );

  if (!datos) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });
  }

  res.json(datos);
}

/**
 * Recepcion de un lote con la verificacion que exige el procedimiento AL-MFA.
 *
 * Se ingresa lo realmente recibido, no lo que dice el documento de despacho.
 * Si no coinciden, la diferencia queda anotada para el BRES. Si el producto
 * no cumple alguna verificacion, entra en cuarentena y no se puede entregar
 * hasta que alguien lo libere.
 */
async function recibirLote(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  const insumo = await prisma.insumo.findFirst({
    where: { id: req.params.id, establecimientoId, activo: true },
  });

  if (!insumo) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });
  }

  // El vencimiento no puede ser anterior a la fabricacion ni a hoy.
  const fechas = validarFechasLote(req.body);
  if (fechas.errores.length > 0) {
    return next({ status: 400, codigo: 'fechas_invalidas', mensaje: fechas.errores[0], detalles: fechas.errores });
  }

  const repetido = await prisma.lote.findFirst({
    where: { insumoId: insumo.id, numeroLote: req.body.numeroLote },
  });

  if (repetido) {
    return next({
      status: 409,
      codigo: 'lote_duplicado',
      mensaje: `El lote ${req.body.numeroLote} ya fue recibido para este insumo`,
    });
  }

  const resultado = await prisma.$transaction((tx) =>
    registrarIngreso(tx, {
      insumoId: insumo.id,
      numeroLote: req.body.numeroLote,
      fechaVence: req.body.fechaVence,
      fechaFabricacion: req.body.fechaFabricacion ?? null,
      cantidad: req.body.cantidad,
      cantidadDocumento: req.body.cantidadDocumento ?? null,
      origen: req.body.origen,
      actaDonacion: req.body.actaDonacion ?? null,
      fabricante: req.body.fabricante ?? null,
      registroSanitario: req.body.registroSanitario ?? null,
      costoUnitario: req.body.costoUnitario ?? null,
      ubicacion: req.body.ubicacion ?? null,
      verificacion: req.body.verificacion ?? {},
      observacionRecepcion: req.body.observacionRecepcion ?? null,
      usuarioId: req.usuario.id,
      motivo: 'Recepción de insumo',
    }),
  );

  const { lote, diferenciaCantidad, enCuarentena } = resultado;

  await req.bitacora({
    accion: 'crear',
    entidad: 'lote',
    entidadId: lote.id,
    detalle:
      `${insumo.nombreGenerico} lote ${lote.numeroLote} x${req.body.cantidad}`
      + (diferenciaCantidad !== 0 ? `, diferencia de ${diferenciaCantidad} contra el documento` : '')
      + (enCuarentena ? '. Entra en cuarentena por producto no conforme' : ''),
  });

  // Los avisos van en el momento de recibir, no en una bandeja aparte.
  const semaforo = (await abastecimiento.semaforoDelCentro(establecimientoId))(lote.fechaVence);
  const meses = Number(mesesParaVencer(lote.fechaVence).toFixed(1));

  const avisos = [...fechas.avisos];
  if (semaforo === 'rojo') {
    avisos.push(`Este lote vence en ${meses} meses: queda en rojo según los rangos del centro. Verifique que alcanzará a usarse.`);
  } else if (semaforo === 'amarillo') {
    avisos.push(`Este lote vence en ${meses} meses: queda en amarillo según los rangos del centro.`);
  }
  if (diferenciaCantidad !== 0) {
    avisos.push(
      diferenciaCantidad < 0
        ? `Se recibieron ${Math.abs(diferenciaCantidad)} menos de lo que dice el documento. Queda anotado para el BRES.`
        : `Se recibieron ${diferenciaCantidad} más de lo que dice el documento. Queda anotado para el BRES.`,
    );
  }
  if (enCuarentena) {
    avisos.push('El producto no cumplió la verificación y entra en cuarentena. No se podrá entregar hasta liberarlo.');
  }
  if (insumo.cadenaFrio) {
    avisos.push('Este insumo requiere cadena de frío. Verifique la temperatura de almacenamiento.');
  }

  res.status(201).json({
    lote,
    semaforo,
    mesesParaVencer: meses,
    diferenciaCantidad,
    enCuarentena,
    avisos,
  });
}

module.exports = { listar, crear, cobertura, recibirLote };
