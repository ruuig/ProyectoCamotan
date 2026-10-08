const prisma = require('../config/db');

// Tipos de documento que se pueden imprimir. El nombre viaja a la bitacora.
const DOCUMENTOS = {
  ficha_atencion: 'Ficha clínica de la atención',
  ficha_blanco: 'Ficha en blanco',
  resumen_expediente: 'Resumen del expediente',
  boleta_referencia: 'Boleta de referencia',
  bres: 'BRES',
  balance: 'Balance consolidado',
  inventario_cierre: 'Inventario de cierre',
  hoja_conteo: 'Hoja de conteo del inventario físico',
  semaforo: 'Semáforo de vencimientos',
  comprobante_traslado: 'Comprobante de traslado',
  tarjeta_control: 'Tarjeta de control de apoyo',
  oficio_baja: 'Oficio de baja',
  requisicion: 'Requisición despacho de almacén',
  kardex: 'Kardex de bodega',
  sigsa4: 'SIGSA-4, registro diario de post-consulta',
  sigsa3cs: 'SIGSA-3CS, registro diario de consulta',
};

const DOCUMENTOS_BODEGA = new Set([
  'bres', 'balance', 'inventario_cierre', 'hoja_conteo', 'semaforo', 'comprobante_traslado', 'tarjeta_control', 'oficio_baja', 'requisicion', 'kardex',
]);

/**
 * Deja constancia de que un documento se imprimio o se descargo.
 *
 * La ficha sale del sistema en papel: sin este registro no hay forma de saber
 * quien la saco ni de que paciente.
 */
async function registrar(req, res, next) {
  const { documento, pacienteId, atencionId, referencia, enBlanco } = req.body;

  if (!DOCUMENTOS[documento]) {
    return next({
      status: 400,
      codigo: 'documento_desconocido',
      mensaje: 'Tipo de documento no reconocido',
    });
  }

  // Bodega imprime sus documentos, nunca los de un paciente; farmacia no imprime ninguno de los dos.
  if (req.usuario.rol === 'bodega' && !DOCUMENTOS_BODEGA.has(documento)) {
    return next({ status: 403, codigo: 'sin_permiso', mensaje: 'Ese documento no corresponde a su rol' });
  }
  // Farmacia imprime solo su SIGSA-4.
  if (req.usuario.rol === 'farmacia' && !['sigsa4', 'requisicion'].includes(documento)) {
    return next({ status: 403, codigo: 'sin_permiso', mensaje: 'Los documentos de bodega los imprime bodega' });
  }

  if (pacienteId) {
    const paciente = await prisma.paciente.findFirst({
      where: { id: pacienteId, establecimientoId: req.usuario.establecimientoId },
    });

    if (!paciente) {
      return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
    }
  }

  await req.bitacora({
    accion: 'leer',
    entidad: 'impresion',
    entidadId: pacienteId ?? atencionId ?? null,
    detalle: `${DOCUMENTOS[documento]}`
      + (pacienteId ? `. Paciente ${pacienteId}` : '')
      + (atencionId ? `. Atención ${atencionId}` : '')
      + (referencia ? `. ${referencia}` : '')
      + (enBlanco ? '. Formato en blanco' : ''),
  });

  res.status(201).json({ registrado: true, documento: DOCUMENTOS[documento] });
}

module.exports = { DOCUMENTOS, registrar };
