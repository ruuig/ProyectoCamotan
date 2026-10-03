const prisma = require('../config/db');
const { hashearPassword, usuarioPublico } = require('../services/auth.service');
const { generarSecreto, codigoQr, verificarCodigo } = require('../services/totp.service');

// --- Signos de peligro -----------------------------------------------------

const CAMPOS_SIGNO = ['descripcion', 'grupoEtario', 'gravedadSugerida', 'orden', 'activo'];

function describirCambios(anterior, nuevo) {
  return CAMPOS_SIGNO.filter((c) => nuevo[c] !== undefined && anterior[c] !== nuevo[c])
    .map((c) => `${c}: "${anterior[c]}" a "${nuevo[c]}"`)
    .join('; ');
}

async function crearSignoPeligro(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  const repetido = await prisma.signoPeligro.findFirst({
    where: { establecimientoId, codigo: req.body.codigo },
  });

  if (repetido) {
    return next({
      status: 409,
      codigo: 'codigo_duplicado',
      mensaje: `Ya existe un signo de peligro con el código ${req.body.codigo}`,
    });
  }

  const signo = await prisma.signoPeligro.create({
    data: { ...req.body, establecimientoId, actualizadoPor: req.director.id },
  });

  await req.bitacora({
    accion: 'config_signos',
    entidad: 'signo_peligro',
    entidadId: signo.id,
    detalle: `Creado "${signo.codigo}" (${signo.gravedadSugerida}, ${signo.grupoEtario}). Autorizo el director ${req.director.nombre}`,
  });

  res.status(201).json({ signo });
}

async function actualizarSignoPeligro(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  const anterior = await prisma.signoPeligro.findFirst({
    where: { id: req.params.id, establecimientoId },
  });

  if (!anterior) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Signo de peligro no encontrado' });
  }

  const cambios = describirCambios(anterior, req.body);

  const signo = await prisma.signoPeligro.update({
    where: { id: anterior.id },
    data: { ...req.body, actualizadoPor: req.director.id },
  });

  // La bitacora guarda el valor anterior y el nuevo, no solo que hubo cambio.
  await req.bitacora({
    accion: 'config_signos',
    entidad: 'signo_peligro',
    entidadId: signo.id,
    detalle: `"${signo.codigo}" ${cambios || 'sin cambios efectivos'}. Autorizo el director ${req.director.nombre}`,
  });

  res.json({ signo, cambios });
}

// El catalogo completo, incluidos los inactivos, para administrarlo.
async function listarSignosPeligro(req, res) {
  const signos = await prisma.signoPeligro.findMany({
    where: { establecimientoId: req.usuario.establecimientoId },
    orderBy: [{ orden: 'asc' }, { codigo: 'asc' }],
    include: { editor: { select: { nombre: true } } },
  });

  res.json({ signos });
}

// --- Usuarios --------------------------------------------------------------

async function listarUsuarios(req, res) {
  const usuarios = await prisma.usuario.findMany({
    where: { establecimientoId: req.usuario.establecimientoId },
    orderBy: [{ activo: 'desc' }, { usuario: 'asc' }],
    select: {
      id: true,
      usuario: true,
      nombre: true,
      dpi: true,
      rol: true,
      esDirector: true,
      activo: true,
      totpSecret: true,
      creadoEn: true,
    },
  });

  // Nunca se devuelve el secreto, solo si existe.
  res.json({
    usuarios: usuarios.map(({ totpSecret, ...u }) => ({ ...u, tieneTotp: Boolean(totpSecret) })),
  });
}

async function crearUsuario(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { password, ...datos } = req.body;

  const repetido = await prisma.usuario.findUnique({ where: { usuario: datos.usuario } });
  if (repetido) {
    return next({
      status: 409,
      codigo: 'usuario_duplicado',
      mensaje: `El usuario ${datos.usuario} ya existe`,
    });
  }

  if (datos.dpi) {
    const dpiRepetido = await prisma.usuario.findUnique({ where: { dpi: datos.dpi } });
    if (dpiRepetido) {
      return next({ status: 409, codigo: 'dpi_duplicado', mensaje: 'Ese DPI ya esta registrado' });
    }
  }

  const usuario = await prisma.usuario.create({
    data: { ...datos, establecimientoId, passwordHash: await hashearPassword(password) },
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'usuario',
    entidadId: usuario.id,
    detalle: `Usuario ${usuario.usuario} con rol ${usuario.rol}${usuario.esDirector ? ' (director)' : ''}`,
  });

  res.status(201).json({ usuario: usuarioPublico(usuario) });
}

// Desactivar un usuario exige autorizacion del director, igual que los signos.
async function cambiarEstadoUsuario(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  const usuario = await prisma.usuario.findFirst({
    where: { id: req.params.id, establecimientoId },
  });

  if (!usuario) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Usuario no encontrado' });
  }

  // Un director no puede desactivarse a si mismo: dejaria el sistema sin
  // forma de autorizar cambios protegidos.
  if (usuario.id === req.director.id && req.body.activo === false) {
    return next({
      status: 409,
      codigo: 'autodesactivacion',
      mensaje: 'El director no puede desactivarse a si mismo',
    });
  }

  const actualizado = await prisma.usuario.update({
    where: { id: usuario.id },
    data: { activo: req.body.activo },
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'usuario',
    entidadId: usuario.id,
    detalle: `Usuario ${usuario.usuario} ${req.body.activo ? 'activado' : 'desactivado'}. Autorizo el director ${req.director.nombre}`,
  });

  res.json({ usuario: usuarioPublico(actualizado) });
}

// --- Establecimiento -------------------------------------------------------

async function obtenerEstablecimiento(req, res) {
  const establecimiento = await prisma.establecimiento.findUnique({
    where: { id: req.usuario.establecimientoId },
  });

  res.json({ establecimiento });
}

async function actualizarEstablecimiento(req, res) {
  const anterior = await prisma.establecimiento.findUnique({
    where: { id: req.usuario.establecimientoId },
  });

  const cambios = Object.keys(req.body)
    .filter((c) => anterior[c] !== req.body[c])
    .map((c) => `${c}: "${anterior[c]}" a "${req.body[c]}"`)
    .join('; ');

  const establecimiento = await prisma.establecimiento.update({
    where: { id: anterior.id },
    data: req.body,
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'establecimiento',
    entidadId: establecimiento.id,
    detalle: `${cambios || 'sin cambios efectivos'}. Autorizo el director ${req.director.nombre}`,
  });

  res.json({ establecimiento, cambios });
}

// --- 2FA del administrador -------------------------------------------------

/**
 * Inicia el alta de TOTP. El secreto no se guarda hasta que el usuario
 * confirma un codigo valido: asi no queda a medias si abandona el proceso.
 */
async function iniciarTotp(req, res, next) {
  if (req.usuario.rol !== 'admin') {
    return next({
      status: 403,
      codigo: 'sin_permiso',
      mensaje: 'El segundo factor solo aplica al rol administrador',
    });
  }

  const secreto = generarSecreto();
  const qr = await codigoQr(req.usuario.usuario, secreto);

  res.json({
    secreto,
    qr,
    instrucciones:
      'Escanee el código con su aplicacion de autenticacion y confirme con el código de 6 digitos.',
  });
}

async function confirmarTotp(req, res, next) {
  const { codigo, secreto } = req.body;

  if (!secreto) {
    return next({
      status: 400,
      codigo: 'secreto_requerido',
      mensaje: 'Falta el secreto generado al iniciar el alta',
    });
  }

  if (!verificarCodigo(codigo, secreto)) {
    return next({
      status: 400,
      codigo: 'codigo_invalido',
      mensaje: 'El código no es válido. Verifique la hora de su dispositivo',
    });
  }

  await prisma.usuario.update({
    where: { id: req.usuario.id },
    data: { totpSecret: secreto },
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'usuario',
    entidadId: req.usuario.id,
    detalle: 'Segundo factor TOTP activado',
  });

  res.json({ mensaje: 'Segundo factor activado' });
}

module.exports = {
  listarSignosPeligro,
  crearSignoPeligro,
  actualizarSignoPeligro,
  listarUsuarios,
  crearUsuario,
  cambiarEstadoUsuario,
  obtenerEstablecimiento,
  actualizarEstablecimiento,
  iniciarTotp,
  confirmarTotp,
};
