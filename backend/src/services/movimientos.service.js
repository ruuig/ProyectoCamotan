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
  reajuste: 'Reajuste',
  baja: 'Baja',
};

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
 * Descuenta de un lote de forma segura ante concurrencia.
 *
 * El UPDATE lleva la condicion de saldo suficiente en el propio WHERE, asi
 * que dos entregas simultaneas no pueden dejar el lote en negativo: la
 * segunda no encuentra fila que actualizar y falla.
 */
async function descontarDeLote(
  tx,
  { loteId, cantidad, usuarioId, tipo = 'entrega', dispensacionId = null, motivo = null, causa = null, servicio = null, trasladoId = null, ahora = new Date() },
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

  const afectados = await tx.lote.updateMany({
    where: { id: loteId, cantidadActual: { gte: cantidad } },
    data: { cantidadActual: { decrement: cantidad } },
  });

  if (afectados.count !== 1) {
    throw fallo(
      409,
      'existencia_insuficiente',
      'La existencia del lote cambió y ya no alcanza. Vuelva a intentarlo',
    );
  }

  const actualizado = await tx.lote.findUnique({ where: { id: loteId } });

  await tx.movimientoInsumo.create({
    data: {
      loteId,
      tipo,
      cantidad: -cantidad, // lo que sale se guarda en negativo
      saldoResultante: actualizado.cantidadActual,
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
 * Reajuste con causa del catalogo oficial.
 *
 * La cantidad va con su signo y la causa tiene que concordar: un sobrante no
 * puede restar ni un faltante sumar. Nunca se edita el movimiento anterior.
 */
async function registrarReajuste(tx, { loteId, cantidad, causa, usuarioId, motivo = null, ahora = new Date() }) {
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

  const nuevoSaldo = lote.cantidadActual + cantidad;
  if (nuevoSaldo < 0) {
    throw fallo(
      400,
      'reajuste_invalido',
      `El reajuste dejaría el lote en ${nuevoSaldo}. La existencia no puede ser negativa`,
    );
  }

  const actualizado = await tx.lote.update({
    where: { id: loteId },
    data: { cantidadActual: nuevoSaldo },
  });

  await tx.movimientoInsumo.create({
    data: {
      loteId,
      tipo: 'reajuste',
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
 * Baja de un lote. Solo se aplica desde un oficio autorizado: el
 * procedimiento del MSPAS no permite sacar producto del inventario sin
 * respaldo documental.
 */
async function registrarBaja(tx, { loteId, cantidad, causa, usuarioId, motivo = null, ahora = new Date() }) {
  if (!['producto_vencido', 'producto_danado'].includes(causa)) {
    throw fallo(400, 'causa_invalida', 'Una baja solo procede por producto vencido o dañado');
  }

  const afectados = await tx.lote.updateMany({
    where: { id: loteId, cantidadActual: { gte: cantidad } },
    data: { cantidadActual: { decrement: cantidad } },
  });

  if (afectados.count !== 1) {
    throw fallo(
      409,
      'existencia_insuficiente',
      'La existencia del lote no alcanza para dar de baja esa cantidad',
    );
  }

  const lote = await tx.lote.findUnique({ where: { id: loteId } });

  await tx.movimientoInsumo.create({
    data: {
      loteId,
      tipo: 'baja',
      cantidad: -cantidad,
      saldoResultante: lote.cantidadActual,
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
  CAUSAS,
  CAUSAS_POSITIVAS,
  CAUSAS_NEGATIVAS,
  ETIQUETA_CAUSA,
  ETIQUETA_TIPO,
  ETIQUETA_ORIGEN,
  ETIQUETA_ESTADO_LOTE,
  signoDeCausa,
  ajustarEstadoAutomatico,
  descontarDeLote,
  registrarIngreso,
  registrarReajuste,
  registrarBaja,
  cambiarEstadoLote,
};
