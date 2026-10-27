/**
 * Escritura de existencias.
 *
 * Todo cambio de saldo pasa por aqui y deja su movimiento. Los movimientos no
 * se editan ni se borran nunca: un error se corrige con un reajuste que lo
 * compensa, y asi la tarjeta de control conserva la historia completa, que es
 * lo que la auditoria necesita ver.
 *
 * El saldo del lote se actualiza en la misma transaccion que el movimiento,
 * de modo que no puedan quedar desalineados.
 */

// --- Causas del catalogo oficial del MSPAS --------------------------------

const CAUSAS_POSITIVAS = [
  'sobrante_inventario_fisico',
  'sobrante_recepcion',
  'traslado_recibido',
  'prestamo_recibido',
  'correccion_error_registro_positiva',
  'devolucion_nivel_inferior',
  'donacion_externa',
];

const CAUSAS_NEGATIVAS = [
  'faltante_inventario_fisico',
  'faltante_recepcion',
  'traslado_enviado',
  'prestamo_enviado',
  'correccion_error_registro_negativa',
  'devolucion_nivel_superior',
  'producto_vencido',
  'producto_danado',
];

const CAUSAS = [...CAUSAS_POSITIVAS, ...CAUSAS_NEGATIVAS];

// Como se nombra cada causa en pantalla y en los documentos impresos.
const ETIQUETA_CAUSA = {
  sobrante_inventario_fisico: 'Sobrante en inventario físico',
  sobrante_recepcion: 'Sobrante en recepción',
  traslado_recibido: 'Traslado recibido',
  prestamo_recibido: 'Préstamo recibido',
  correccion_error_registro_positiva: 'Corrección de error de registro (positiva)',
  devolucion_nivel_inferior: 'Devolución de un nivel inferior',
  donacion_externa: 'Donación que no viene del nivel superior',
  faltante_inventario_fisico: 'Faltante en inventario físico',
  faltante_recepcion: 'Faltante en recepción',
  traslado_enviado: 'Traslado enviado',
  prestamo_enviado: 'Préstamo enviado',
  correccion_error_registro_negativa: 'Corrección de error de registro (negativa)',
  devolucion_nivel_superior: 'Devolución a un nivel superior',
  producto_vencido: 'Producto vencido',
  producto_danado: 'Producto dañado',
};

const ETIQUETA_TIPO = {
  ingreso: 'Ingreso',
  entrega: 'Entrega a paciente',
  consumo_interno: 'Consumo interno',
  traslado: 'Traslado a otro servicio',
  paso_farmacia: 'Entre bodega y farmacia',
  reajuste: 'Reajuste',
  baja: 'Baja',
  devolucion: 'Devolución por anulación',
};

// La bodega y la farmacia (post-consulta) del centro.
const UBICACIONES = ['bodega', 'farmacia'];
const ETIQUETA_UBICACION = { bodega: 'Bodega', farmacia: 'Farmacia' };

/** Lo que hay de un lote en una ubicacion: la farmacia aparte, la bodega el resto. */
function existenciaEn(lote, ubicacion) {
  const farmacia = lote.cantidadFarmacia ?? 0;
  return ubicacion === 'farmacia' ? farmacia : lote.cantidadActual - farmacia;
}

const ETIQUETA_ORIGEN = {
  despacho: 'Despacho del nivel superior',
  donacion: 'Donación',
  traslado: 'Traslado de otro servicio',
  prestamo: 'Préstamo',
};

const ETIQUETA_ESTADO_LOTE = {
  disponible: 'Disponible',
  cuarentena: 'En cuarentena',
  retirado: 'Retirado',
  vencido: 'Vencido',
  agotado: 'Agotado',
  dado_de_baja: 'Dado de baja',
};

/** Si la causa suma o resta. Un reajuste con el signo cambiado no cuadra. */
function signoDeCausa(causa) {
  if (CAUSAS_POSITIVAS.includes(causa)) return 1;
  if (CAUSAS_NEGATIVAS.includes(causa)) return -1;
  return 0;
}

function fallo(status, codigo, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  error.codigo = codigo;
  error.mensaje = mensaje;
  return error;
}

/**
 * Deja el lote en el estado que le corresponde despues de un movimiento.
 * Agotado y vencido se asignan solos; los demas los pone una persona.
 */
async function ajustarEstadoAutomatico(tx, loteId, ahora = new Date()) {
  const lote = await tx.lote.findUnique({ where: { id: loteId } });
  if (!lote) return null;

  // Un lote retirado o dado de baja no vuelve a disponible por tener saldo.
  if (['retirado', 'dado_de_baja', 'cuarentena'].includes(lote.estado)) return lote;

  const vencido = new Date(lote.fechaVence) <= new Date(ahora);
  const destino = lote.cantidadActual <= 0 ? 'agotado' : vencido ? 'vencido' : 'disponible';

  if (destino === lote.estado) return lote;
  return tx.lote.update({ where: { id: loteId }, data: { estado: destino, estadoEn: ahora } });
}

/**
 * Resta de un lote en una ubicacion, con la condicion de saldo suficiente en
 * el propio WHERE: dos salidas simultaneas no pueden dejarlo en negativo. Lo
 * que sale de la farmacia baja tambien su parte; lo de la bodega, solo el total.
 * Devuelve cuantas filas cambio (1 si alcanzo).
 */
async function restarEn(tx, loteId, ubicacion, cantidad) {
  if (ubicacion === 'farmacia') {
    return tx.$executeRaw`
      UPDATE lote SET cantidad_actual = cantidad_actual - ${cantidad}, cantidad_farmacia = cantidad_farmacia - ${cantidad}
      WHERE id = ${loteId} AND cantidad_farmacia >= ${cantidad}`;
  }
  return tx.$executeRaw`
    UPDATE lote SET cantidad_actual = cantidad_actual - ${cantidad}
    WHERE id = ${loteId} AND cantidad_actual - cantidad_farmacia >= ${cantidad}`;
}

/**
 * Pasa existencia de un lote entre la bodega y la farmacia. Son dos
 * movimientos, uno en cada ubicacion, que se anulan en el total del centro:
 * el lote no cambia de cantidad, solo de lugar.
 */
async function pasarEntreUbicaciones(tx, { loteId, cantidad, desde, usuarioId, trasladoId = null, motivo = null, ahora = new Date() }) {
  const hacia = desde === 'bodega' ? 'farmacia' : 'bodega';
  const lote = await tx.lote.findUnique({ where: { id: loteId } });
  if (!lote) throw fallo(404, 'lote_no_encontrado', 'El lote no existe');
  if (cantidad <= 0) throw fallo(400, 'cantidad_invalida', 'La cantidad debe ser mayor que cero');

  const condicion = desde === 'bodega'
    ? tx.$executeRaw`UPDATE lote SET cantidad_farmacia = cantidad_farmacia + ${cantidad}
        WHERE id = ${loteId} AND cantidad_actual - cantidad_farmacia >= ${cantidad}`
    : tx.$executeRaw`UPDATE lote SET cantidad_farmacia = cantidad_farmacia - ${cantidad}
        WHERE id = ${loteId} AND cantidad_farmacia >= ${cantidad}`;
  if ((await condicion) !== 1) {
    throw fallo(
      409,
      'existencia_insuficiente',
      `El lote ${lote.numeroLote} no tiene ${cantidad} en ${ETIQUETA_UBICACION[desde].toLowerCase()} (hay ${existenciaEn(lote, desde)})`,
    );
  }
  const actualizado = await tx.lote.findUnique({ where: { id: loteId } });
  await tx.movimientoInsumo.createMany({
    data: [
      { loteId, tipo: 'paso_farmacia', ubicacion: desde, cantidad: -cantidad, saldoResultante: existenciaEn(actualizado, desde), usuarioId, trasladoId, motivo, registradoEn: ahora },
      { loteId, tipo: 'paso_farmacia', ubicacion: hacia, cantidad, saldoResultante: existenciaEn(actualizado, hacia), usuarioId, trasladoId, motivo, registradoEn: ahora },
    ],
  });
  return actualizado;
}

/**
 * Devuelve a la farmacia lo de una entrega anulada: vuelve al mismo lote y
 * a la misma ubicacion de donde salio, con su propio movimiento.
 */
async function devolverEntrega(tx, { movimiento, usuarioId, dispensacionId, motivo }) {
  const devolver = Math.abs(movimiento.cantidad);
  const ubicacion = movimiento.ubicacion ?? 'bodega';
  const lote = await tx.lote.update({
    where: { id: movimiento.loteId },
    data: {
      cantidadActual: { increment: devolver },
      ...(ubicacion === 'farmacia' ? { cantidadFarmacia: { increment: devolver } } : {}),
    },
  });
  await tx.movimientoInsumo.create({
    data: {
      loteId: movimiento.loteId,
      tipo: 'devolucion',
      ubicacion,
      cantidad: devolver,
      saldoResultante: existenciaEn(lote, ubicacion),
      dispensacionId,
      usuarioId,
      motivo,
    },
  });
  await ajustarEstadoAutomatico(tx, movimiento.loteId);
  return lote;
}

/**
 * Descuenta de un lote de forma segura ante concurrencia.
 *
 * El UPDATE lleva la condicion de saldo suficiente en el propio WHERE, asi
 * que dos entregas simultaneas no pueden dejar el lote en negativo: la
 * segunda no encuentra fila que actualizar y falla.
 */
async function descontarDeLote(
  tx,
  {
    loteId, cantidad, usuarioId, tipo = 'entrega', ubicacion = 'bodega', dispensacionId = null, motivo = null,
    causa = null, servicio = null, trasladoId = null, ahora = new Date(),
  },
) {
  const lote = await tx.lote.findUnique({ where: { id: loteId } });
  if (!lote) throw fallo(404, 'lote_no_encontrado', 'El lote no existe');

  // Solo un lote disponible se puede entregar. Esta es la regla que impide
  // que salga algo que esta en cuarentena o retirado.
  if (lote.estado !== 'disponible') {
    throw fallo(
      409,
      'lote_no_disponible',
      `El lote ${lote.numeroLote} está en estado "${ETIQUETA_ESTADO_LOTE[lote.estado] ?? lote.estado}" y no se puede entregar`,
    );
  }

  const afectados = await restarEn(tx, loteId, ubicacion, cantidad);
  if (afectados !== 1) {
    throw fallo(
      409,
      'existencia_insuficiente',
      `La existencia del lote en ${ETIQUETA_UBICACION[ubicacion].toLowerCase()} cambió y ya no alcanza. Vuelva a intentarlo`,
    );
  }

  const actualizado = await tx.lote.findUnique({ where: { id: loteId } });

  await tx.movimientoInsumo.create({
    data: {
      loteId,
      tipo,
      ubicacion,
      cantidad: -cantidad, // lo que sale se guarda en negativo
      saldoResultante: existenciaEn(actualizado, ubicacion),
      dispensacionId,
      usuarioId,
      motivo,
      causa,
      servicio,
      trasladoId,
    },
  });

  await ajustarEstadoAutomatico(tx, loteId, ahora);
  return actualizado;
}

/**
 * Registra la entrada de un lote con su verificacion de recepcion.
 *
 * Se ingresa lo realmente recibido, no lo que dice el documento: si no
 * coinciden, la diferencia queda anotada para el BRES. Si algo no cumple la
 * verificacion, el lote entra en cuarentena como producto no conforme y no
 * se puede entregar hasta que alguien lo libere.
 */
async function registrarIngreso(
  tx,
  {
    insumoId,
    numeroLote,
    fechaVence,
    fechaFabricacion = null,
    cantidad,
    usuarioId,
    origen = 'despacho',
    actaDonacion = null,
    fabricante = null,
    registroSanitario = null,
    costoUnitario = null,
    ubicacion = null,
    cantidadDocumento = null,
    verificacion = {},
    observacionRecepcion = null,
    motivo = null,
    requisicionId = null,
    recepcionId = null,
  },
) {
  const conforme =
    verificacion.etiquetado !== false
    && verificacion.empaque !== false
    && verificacion.aspecto !== false;

  const diferenciaCantidad =
    cantidadDocumento === null ? 0 : cantidad - cantidadDocumento;

  const estado = conforme ? 'disponible' : 'cuarentena';
  const motivoEstado = conforme
    ? null
    : 'Producto no conforme en la verificación de recepción';

  // La DDRISS manda el mismo lote en varias remesas: lo que llega se suma al
  // lote que ya existe (mismo número y mismo vencimiento).
  const existente = await tx.lote.findFirst({ where: { insumoId, numeroLote } });
  if (existente) {
    const problema = problemaConLoteExistente(existente, fechaVence);
    if (problema) throw fallo(409, 'lote_distinto', problema);
    const lote = await tx.lote.update({
      where: { id: existente.id },
      data: {
        cantidadInicial: { increment: cantidad },
        cantidadActual: { increment: cantidad },
        ...(existente.estado === 'agotado' ? { estado: 'disponible', motivoEstado: null, estadoEn: new Date(), estadoPor: usuarioId } : {}),
        ...(costoUnitario !== null && existente.costoUnitario === null ? { costoUnitario } : {}),
      },
    });
    await tx.movimientoInsumo.create({
      data: {
        loteId: lote.id,
        tipo: 'ingreso',
        cantidad,
        saldoResultante: existenciaEn(lote, 'bodega'),
        usuarioId,
        motivo,
        causa: origen === 'donacion' ? 'donacion_externa' : null,
      },
    });
    return { lote, diferenciaCantidad, enCuarentena: false, sumado: true };
  }

  const lote = await tx.lote.create({
    data: {
      insumoId,
      numeroLote,
      fechaVence,
      fechaFabricacion,
      cantidadInicial: cantidad,
      cantidadActual: cantidad,
      origen,
      actaDonacion,
      fabricante,
      registroSanitario,
      costoUnitario,
      ubicacion,
      estado,
      motivoEstado,
      estadoEn: new Date(),
      estadoPor: usuarioId,
      cantidadDocumento,
      verifCantidad: cantidadDocumento === null ? null : diferenciaCantidad === 0,
      verifEtiquetado: verificacion.etiquetado ?? null,
      verifEmpaque: verificacion.empaque ?? null,
      verifAspecto: verificacion.aspecto ?? null,
      observacionRecepcion,
      requisicionId,
      recepcionId,
    },
  });

  await tx.movimientoInsumo.create({
    data: {
      loteId: lote.id,
      tipo: 'ingreso',
      cantidad,
      saldoResultante: cantidad,
      usuarioId,
      motivo,
      causa: origen === 'donacion' ? 'donacion_externa' : null,
    },
  });

  return { lote, diferenciaCantidad, enCuarentena: !conforme };
}

/**
 * Si un lote que ya existe puede recibir más: tiene que traer el mismo
 * vencimiento y no estar dado de baja ni retirado. Devuelve el problema o null.
 */
function problemaConLoteExistente(lote, fechaVence) {
  const dia = (f) => new Date(f).toISOString().slice(0, 10);
  if (dia(lote.fechaVence) !== dia(fechaVence)) {
    return `El lote ${lote.numeroLote} ya existe con vencimiento ${dia(lote.fechaVence).split('-').reverse().join('/')}: revise la caja`;
  }
  if (['dado_de_baja', 'retirado'].includes(lote.estado)) {
    return `El lote ${lote.numeroLote} está ${lote.estado === 'retirado' ? 'retirado' : 'dado de baja'}: no se puede recibir más de él`;
  }
  return null;
}

/**
 * Reajuste con causa del catalogo oficial.
 *
 * La cantidad va con su signo y la causa tiene que concordar: un sobrante no
 * puede restar ni un faltante sumar. Nunca se edita el movimiento anterior.
 */
async function registrarReajuste(tx, { loteId, cantidad, causa, usuarioId, motivo = null, ubicacion = 'bodega', ahora = new Date() }) {
  if (cantidad === 0) {
    throw fallo(400, 'sin_diferencia', 'Un reajuste de cero no cambia nada');
  }
  if (!CAUSAS.includes(causa)) {
    throw fallo(400, 'causa_invalida', 'Esa causa no está en el catálogo del MSPAS');
  }

  const signo = signoDeCausa(causa);
  if (Math.sign(cantidad) !== signo) {
    throw fallo(
      400,
      'causa_no_concuerda',
      `La causa "${ETIQUETA_CAUSA[causa]}" ${signo > 0 ? 'suma' : 'resta'} existencia, y la cantidad va en sentido contrario`,
    );
  }

  const lote = await tx.lote.findUnique({ where: { id: loteId } });
  if (!lote) throw fallo(404, 'lote_no_encontrado', 'El lote no existe');

  const nuevoSaldo = existenciaEn(lote, ubicacion) + cantidad;
  if (nuevoSaldo < 0) {
    throw fallo(
      400,
      'reajuste_invalido',
      `El reajuste dejaría el lote en ${nuevoSaldo} en ${ETIQUETA_UBICACION[ubicacion].toLowerCase()}. La existencia no puede ser negativa`,
    );
  }

  const actualizado = await tx.lote.update({
    where: { id: loteId },
    data: {
      cantidadActual: lote.cantidadActual + cantidad,
      ...(ubicacion === 'farmacia' ? { cantidadFarmacia: lote.cantidadFarmacia + cantidad } : {}),
    },
  });

  await tx.movimientoInsumo.create({
    data: {
      loteId,
      tipo: 'reajuste',
      ubicacion,
      cantidad,
      saldoResultante: nuevoSaldo,
      usuarioId,
      causa,
      motivo,
    },
  });

  await ajustarEstadoAutomatico(tx, loteId, ahora);
  return { lote: actualizado, diferencia: cantidad };
}

/**
 * Baja de un lote vencido o dañado: sale de la bodega y queda registrada.
 */
async function registrarBaja(tx, { loteId, cantidad, causa, usuarioId, motivo = null, ahora = new Date() }) {
  if (!['producto_vencido', 'producto_danado'].includes(causa)) {
    throw fallo(400, 'causa_invalida', 'Una baja solo procede por producto vencido o dañado');
  }

  // Se da de baja desde la bodega: lo vencido en farmacia se devuelve primero.
  if ((await restarEn(tx, loteId, 'bodega', cantidad)) !== 1) {
    throw fallo(
      409,
      'existencia_insuficiente',
      'La existencia del lote en bodega no alcanza para dar de baja esa cantidad. Si una parte está en farmacia, devuélvala a bodega primero',
    );
  }

  const lote = await tx.lote.findUnique({ where: { id: loteId } });

  await tx.movimientoInsumo.create({
    data: {
      loteId,
      tipo: 'baja',
      ubicacion: 'bodega',
      cantidad: -cantidad,
      saldoResultante: existenciaEn(lote, 'bodega'),
      usuarioId,
      causa,
      motivo,
    },
  });

  // Lo dado de baja no vuelve a circulacion aunque quede saldo.
  await tx.lote.update({
    where: { id: loteId },
    data: {
      estado: 'dado_de_baja',
      motivoEstado: `Baja por ${ETIQUETA_CAUSA[causa].toLowerCase()}`,
      estadoEn: ahora,
      estadoPor: usuarioId,
    },
  });

  return lote;
}

/**
 * Cambia el estado de un lote a mano: cuarentena, liberacion o retiro.
 * Agotado y vencido no se ponen a mano: los asigna el sistema.
 */
async function cambiarEstadoLote(tx, { loteId, estado, motivo, usuarioId, ahora = new Date() }) {
  if (['agotado', 'vencido'].includes(estado)) {
    throw fallo(
      400,
      'estado_automatico',
      'Agotado y vencido los asigna el sistema, no se ponen a mano',
    );
  }

  const lote = await tx.lote.findUnique({ where: { id: loteId } });
  if (!lote) throw fallo(404, 'lote_no_encontrado', 'El lote no existe');

  if (lote.estado === 'dado_de_baja') {
    throw fallo(409, 'lote_dado_de_baja', 'Un lote dado de baja ya no cambia de estado');
  }

  // Volver a disponible exige que el lote siga vigente y con existencia.
  if (estado === 'disponible') {
    if (lote.cantidadActual <= 0) {
      return tx.lote.update({
        where: { id: loteId },
        data: { estado: 'agotado', motivoEstado: motivo, estadoEn: ahora, estadoPor: usuarioId },
      });
    }
    if (new Date(lote.fechaVence) <= new Date(ahora)) {
      throw fallo(409, 'lote_vencido', 'Un lote vencido no se puede liberar a disponible');
    }
  }

  return tx.lote.update({
    where: { id: loteId },
    data: { estado, motivoEstado: motivo, estadoEn: ahora, estadoPor: usuarioId },
  });
}

module.exports = {
  problemaConLoteExistente,
  CAUSAS,
  CAUSAS_POSITIVAS,
  CAUSAS_NEGATIVAS,
  ETIQUETA_CAUSA,
  ETIQUETA_TIPO,
  ETIQUETA_ORIGEN,
  ETIQUETA_ESTADO_LOTE,
  UBICACIONES,
  ETIQUETA_UBICACION,
  existenciaEn,
  signoDeCausa,
  ajustarEstadoAutomatico,
  restarEn,
  pasarEntreUbicaciones,
  devolverEntrega,
  descontarDeLote,
  registrarIngreso,
  registrarReajuste,
  registrarBaja,
  cambiarEstadoLote,
};
