const prisma = require('../config/db');
const abastecimiento = require('../services/abastecimiento.service');
const inventarioFisico = require('../services/inventarioFisico.service');
const bresService = require('../services/bres.service');
const trazabilidad = require('../services/trazabilidad.service');
const retiroService = require('../services/retiro.service');
const oficioService = require('../services/oficioBaja.service');
const { periodoDe } = require('../services/logistica.service');
const {
  CAUSAS_POSITIVAS,
  CAUSAS_NEGATIVAS,
  ETIQUETA_CAUSA,
  ETIQUETA_TIPO,
  ETIQUETA_ORIGEN,
  ETIQUETA_ESTADO_LOTE,
  cambiarEstadoLote,
} = require('../services/movimientos.service');

/**
 * Logistica segun el MSPAS: abastecimiento, inventario fisico, BRES,
 * trazabilidad, retiros y bajas.
 */

// --- Catalogos -------------------------------------------------------------

/** Catalogos oficiales que necesitan los formularios. */
async function catalogos(req, res) {
  const etiquetar = (claves) => claves.map((c) => ({ valor: c, etiqueta: ETIQUETA_CAUSA[c] }));

  res.json({
    causasPositivas: etiquetar(CAUSAS_POSITIVAS),
    causasNegativas: etiquetar(CAUSAS_NEGATIVAS),
    tiposMovimiento: Object.entries(ETIQUETA_TIPO).map(([valor, etiqueta]) => ({ valor, etiqueta })),
    origenes: Object.entries(ETIQUETA_ORIGEN).map(([valor, etiqueta]) => ({ valor, etiqueta })),
    estadosLote: Object.entries(ETIQUETA_ESTADO_LOTE).map(([valor, etiqueta]) => ({ valor, etiqueta })),
  });
}

// --- Configuracion ---------------------------------------------------------

async function obtenerConfiguracion(req, res) {
  const config = await abastecimiento.configuracion(req.usuario.establecimientoId);
  res.json({
    configuracion: {
      ...config,
      mesesSolicitudRecepcion: Number(config.mesesSolicitudRecepcion),
      mesesFrecuenciaPedido: Number(config.mesesFrecuenciaPedido),
      nivelMinimoMeses: Number(config.nivelMinimoMeses),
      nivelMaximoMeses: Number(config.nivelMaximoMeses),
    },
  });
}

async function guardarConfiguracion(req, res) {
  const establecimientoId = req.usuario.establecimientoId;

  const config = await prisma.configuracionLogistica.upsert({
    where: { establecimientoId },
    create: { establecimientoId, ...req.body, actualizadoPor: req.usuario.id, actualizadoEn: new Date() },
    update: { ...req.body, actualizadoPor: req.usuario.id, actualizadoEn: new Date() },
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'configuracion_logistica',
    entidadId: establecimientoId,
    detalle: `BRES: mínimo ${config.nivelMinimoMeses} y máximo ${config.nivelMaximoMeses} meses, promedio de ${config.mesesPromedio} meses, fórmula ${config.formulaPedido}. `
      + `Semáforo: rojo a menos de ${config.semaforoRojoMeses} meses, amarillo hasta ${config.semaforoAmarilloMeses}${config.provisional ? ' (provisional)' : ''}`,
  });

  res.json({ configuracion: config });
}

// --- Abastecimiento --------------------------------------------------------

/** Todos los insumos con sus niveles, para la pantalla de inventario. */
async function resumenAbastecimiento(req, res) {
  const datos = await abastecimiento.evaluarTodos(req.usuario.establecimientoId);

  const filas = req.query.soloBajoMinimo
    ? datos.filas.filter((f) => f.bajoMinimo || f.desabastecido || f.sinExistencia)
    : datos.filas;

  res.json({
    provisional: datos.provisional,
    configuracion: {
      mesesSolicitudRecepcion: Number(datos.configuracion.mesesSolicitudRecepcion),
      mesesFrecuenciaPedido: Number(datos.configuracion.mesesFrecuenciaPedido),
    },
    resumen: {
      insumos: datos.filas.length,
      // Sin existencia cuenta aunque aun no haya demanda con que calcular.
      sinExistencia: datos.filas.filter((f) => f.sinExistencia).length,
      bajoMinimo: datos.filas.filter((f) => f.bajoMinimo).length,
      desabastecidos: datos.filas.filter((f) => f.desabastecido).length,
      enCuarentena: datos.filas.filter((f) => f.lotesEnCuarentena > 0).length,
      lotesEnRojo: datos.filas.reduce((s, f) => s + f.lotesEnRojo, 0),
    },
    filas: filas.sort((a, b) => (a.med ?? Infinity) - (b.med ?? Infinity)),
  });
}

/** Un insumo con su historia de demanda y el detalle de cada lote. */
async function detalleAbastecimiento(req, res, next) {
  const datos = await abastecimiento.evaluarAbastecimiento(
    req.params.id,
    req.usuario.establecimientoId,
  );

  if (!datos) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });
  }

  res.json(datos);
}

/** Verificacion de que los saldos cuadran con los movimientos. */
async function verificarSaldos(req, res) {
  const resultado = await abastecimiento.verificarSaldos(req.usuario.establecimientoId);

  await req.bitacora({
    accion: 'leer',
    entidad: 'lote',
    detalle: `Verificación de saldos: ${resultado.revisados} lote(s), ${resultado.descuadrados.length} descuadrado(s)`,
  });

  res.json(resultado);
}

// --- Lotes -----------------------------------------------------------------

async function cambiarEstado(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  const lote = await prisma.lote.findFirst({
    where: { id: req.params.id, insumo: { establecimientoId } },
    include: { insumo: { select: { nombreGenerico: true } } },
  });

  if (!lote) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Lote no encontrado' });
  }

  const actualizado = await prisma.$transaction((tx) =>
    cambiarEstadoLote(tx, {
      loteId: lote.id,
      estado: req.body.estado,
      motivo: req.body.motivo,
      usuarioId: req.usuario.id,
    }),
  );

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'lote',
    entidadId: lote.id,
    detalle: `${lote.insumo.nombreGenerico} lote ${lote.numeroLote}: ${ETIQUETA_ESTADO_LOTE[lote.estado]} → ${ETIQUETA_ESTADO_LOTE[req.body.estado]}. ${req.body.motivo}`,
  });

  res.json({ lote: actualizado });
}

// --- Trazabilidad ----------------------------------------------------------

async function trazaLote(req, res, next) {
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
 * Pacientes que recibieron algo de farmacia, para buscar su trazabilidad.
 * Solo los que tienen entregas: bodega no necesita ver el resto del padrón.
 */
async function buscarPacientesConEntregas(req, res) {
  const palabras = (req.query.buscar ?? '').trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return res.json({ pacientes: [] });
  const pacientes = await prisma.paciente.findMany({
    where: {
      establecimientoId: req.usuario.establecimientoId,
      AND: palabras.map((w) => ({ OR: [{ nombres: { contains: w, mode: 'insensitive' } }, { apellidos: { contains: w, mode: 'insensitive' } }, { expediente: { contains: w } }, { expedientePapel: { contains: w, mode: 'insensitive' } }, { cui: { contains: w } }] })),
      atenciones: { some: { prescripciones: { some: { dispensaciones: { some: { anulada: false } } } } } },
    },
    select: { id: true, nombres: true, apellidos: true, expediente: true, expedientePapel: true, comunidad: true },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    take: 15,
  });
  res.json({ pacientes: pacientes.map((p) => ({ ...p, nombreCompleto: `${p.apellidos}, ${p.nombres}` })) });
}

async function trazaPaciente(req, res, next) {
  const datos = await trazabilidad.desdePaciente(req.params.id, req.usuario.establecimientoId);

  if (!datos) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  await req.bitacora({
    accion: 'leer',
    entidad: 'paciente',
    entidadId: Number(req.params.id),
    detalle: `Insumos entregados al expediente ${datos.paciente.expediente}`,
  });

  res.json(datos);
}

async function tarjetaControl(req, res, next) {
  // Sin ubicacion, la del centro entero; con ella, la de la bodega o la de la farmacia.
  const datos = await trazabilidad.tarjetaDeControl(req.params.id, req.usuario.establecimientoId, { ubicacion: req.query.ubicacion ?? null });

  if (!datos) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });
  }

  await req.bitacora({
    accion: 'leer',
    entidad: 'insumo',
    entidadId: Number(req.params.id),
    detalle: `Tarjeta de control de ${datos.insumo.nombreGenerico}`,
  });

  res.json(datos);
}

// --- Inventario fisico -----------------------------------------------------

async function hojaDeConteo(req, res) {
  const lotes = await inventarioFisico.hojaDeConteo(req.usuario.establecimientoId);
  res.json({ lotes, periodoSugerido: periodoDe(new Date()) });
}

async function abrirInventario(req, res) {
  const inventario = await inventarioFisico.abrir(req.usuario.establecimientoId, {
    ...req.body,
    usuarioId: req.usuario.id,
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'inventario_fisico',
    entidadId: inventario.id,
    detalle: `Inventario físico ${inventario.periodo} abierto`,
  });

  res.status(201).json({ inventario });
}

async function registrarConteo(req, res) {
  const registrados = await inventarioFisico.registrarConteos(Number(req.params.id), {
    conteos: req.body.conteos,
    usuarioId: req.usuario.id,
  });

  res.json({ registrados, mensaje: `${registrados} lote(s) contados` });
}

async function cerrarInventario(req, res) {
  const resultado = await inventarioFisico.cerrar(Number(req.params.id), {
    usuarioId: req.usuario.id,
    observaciones: req.body.observaciones,
    aplicarReajustes: req.body.aplicarReajustes,
    // El director autoriza las diferencias grandes en el mismo acto.
    autorizado: Boolean(req.director),
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'inventario_fisico',
    entidadId: Number(req.params.id),
    detalle: `Inventario cerrado: ${resultado.lotesContados} lote(s), ${resultado.conDiferencia} con diferencia, ${resultado.reajustesAplicados} reajuste(s) aplicado(s)`,
  });

  res.json(resultado);
}

async function obtenerInventario(req, res) {
  const inventario = await inventarioFisico.obtener(
    req.usuario.establecimientoId,
    req.params.periodo,
  );

  // Que el inventario del mes aun no se haya abierto es parte del flujo, no
  // un error: la pantalla lo usa para ofrecer abrirlo.
  res.json({ inventario: inventario ?? null });
}

// --- BRES ------------------------------------------------------------------

async function vistaPreviaBres(req, res) {
  const datos = await bresService.calcular(req.usuario.establecimientoId, req.params.periodo);
  res.json(datos);
}

async function generarBres(req, res) {
  const datos = await bresService.generar(req.usuario.establecimientoId, {
    ...req.body,
    usuarioId: req.usuario.id,
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'bres',
    entidadId: datos.bres.id,
    detalle: `BRES ${req.body.periodo} generado con ${datos.renglones.length} renglón(es)`,
  });

  res.status(201).json(datos);
}

async function cerrarBres(req, res, next) {
  // Cerrar congela el mes: se confirma con la contrasena de quien lo hace.
  const { compararPassword } = require('../services/auth.service');
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
  if (!req.body?.password || !(await compararPassword(req.body.password, usuario?.passwordHash))) {
    return next({ status: 403, codigo: 'contrasena_incorrecta', mensaje: 'La contraseña no es correcta' });
  }
  const bres = await bresService.cerrar(req.usuario.establecimientoId, req.params.periodo);

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'bres',
    entidadId: bres.id,
    detalle: `BRES ${bres.periodo} cerrado`,
  });

  res.json({ bres });
}

async function obtenerBres(req, res) {
  const bres = await bresService.obtener(req.usuario.establecimientoId, req.params.periodo);

  // Lo mismo que el inventario: aun no generado no es un fallo.
  res.json({ bres: bres ?? null });
}

async function registroDiario(req, res) {
  const dias = await bresService.registroDiario(req.usuario.establecimientoId, req.params.periodo);
  res.json({ periodo: req.params.periodo, dias });
}

// --- Retiro sanitario ------------------------------------------------------

async function listarRetiros(req, res) {
  res.json({ retiros: await retiroService.listar(req.usuario.establecimientoId) });
}

async function registrarRetiro(req, res) {
  const retiro = await retiroService.registrar(req.usuario.establecimientoId, {
    ...req.body,
    usuarioId: req.usuario.id,
  });

  const completo = await retiroService.obtener(retiro.id, req.usuario.establecimientoId);

  await req.bitacora({
    accion: 'crear',
    entidad: 'retiro_sanitario',
    entidadId: retiro.id,
    detalle: `Retiro ${retiro.referencia}: ${completo.resumen.lotes} lote(s) retirados, ${completo.resumen.pacientes} paciente(s) por localizar`,
  });

  res.status(201).json({ retiro: completo });
}

async function obtenerRetiro(req, res, next) {
  const retiro = await retiroService.obtener(Number(req.params.id), req.usuario.establecimientoId);

  if (!retiro) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Retiro no encontrado' });
  }

  res.json({ retiro });
}

async function marcarLocalizacion(req, res) {
  const fila = await retiroService.marcarLocalizacion(Number(req.params.id), {
    ...req.body,
    usuarioId: req.usuario.id,
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'retiro_paciente',
    entidadId: fila.id,
    detalle: req.body.localizado ? 'Paciente localizado' : 'Paciente marcado como no localizado',
  });

  res.json({ retiroPaciente: fila });
}

async function cerrarRetiro(req, res) {
  const retiro = await retiroService.cerrar(Number(req.params.id), req.usuario.establecimientoId);

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'retiro_sanitario',
    entidadId: retiro.id,
    detalle: `Retiro ${retiro.referencia} cerrado`,
  });

  res.json({ retiro });
}

// --- Bajas --------------------------------------------------------------------

async function candidatosBaja(req, res) {
  res.json({ lotes: await oficioService.candidatos(req.usuario.establecimientoId) });
}

async function listarBajas(req, res) {
  res.json({ bajas: await oficioService.listar(req.usuario.establecimientoId) });
}

async function darDeBaja(req, res) {
  const baja = await oficioService.darDeBaja(req.usuario.establecimientoId, {
    ...req.body,
    usuarioId: req.usuario.id,
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'baja',
    entidadId: baja.id,
    detalle: `Baja ${baja.correlativo}: ${baja.cantidad} por ${ETIQUETA_CAUSA[baja.causa]}`,
  });

  res.status(201).json({ baja });
}

module.exports = {
  buscarPacientesConEntregas,
  catalogos,
  obtenerConfiguracion,
  guardarConfiguracion,
  resumenAbastecimiento,
  detalleAbastecimiento,
  verificarSaldos,
  cambiarEstado,
  trazaLote,
  trazaPaciente,
  tarjetaControl,
  hojaDeConteo,
  abrirInventario,
  registrarConteo,
  cerrarInventario,
  obtenerInventario,
  vistaPreviaBres,
  generarBres,
  cerrarBres,
  obtenerBres,
  registroDiario,
  listarRetiros,
  registrarRetiro,
  obtenerRetiro,
  marcarLocalizacion,
  cerrarRetiro,
  candidatosBaja,
  listarBajas,
  darDeBaja,
};
