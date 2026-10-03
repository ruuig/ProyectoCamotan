const { z } = require('zod');

const crearAtencion = z.object({
  pacienteId: z.coerce.number().int().positive('Debe indicar el paciente'),
  // El motivo se pregunta al tomar los signos vitales, que es el mismo
  // momento en la practica y ahorra un paso con la fila esperando.
  motivoConsulta: z.string().trim().max(500).optional().nullable(),
  gravedad: z.enum(['urgente', 'moderado', 'leve']).default('leve'),
});

const opcionalDecimal = (min, max, mensaje) =>
  z.coerce.number().min(min, mensaje).max(max, mensaje).optional().nullable();

const opcionalEntero = (min, max, mensaje) =>
  z.coerce.number().int().min(min, mensaje).max(max, mensaje).optional().nullable();

const preconsulta = z
  .object({
    // El peso viaja en la unidad en que se capturo. El limite es amplio a
    // proposito: 400 libras son 181 kg, y el rango clinico lo valida despues
    // la conversion, no el esquema.
    peso: opcionalDecimal(0.5, 900, 'Peso fuera de lo posible'),
    unidadPeso: z.enum(['kg', 'lb']).default('kg'),
    talla: opcionalDecimal(20, 250, 'Talla fuera de lo posible'),
    temperatura: opcionalDecimal(25, 45, 'Temperatura fuera de lo posible'),
    presionSis: opcionalEntero(40, 300, 'Presion sistolica fuera de lo posible'),
    presionDia: opcionalEntero(20, 200, 'Presion diastolica fuera de lo posible'),
    frecCardiaca: opcionalEntero(20, 300, 'Frecuencia cardiaca fuera de lo posible'),
    frecRespiratoria: opcionalEntero(5, 120, 'Frecuencia respiratoria fuera de lo posible'),
    satOxigeno: opcionalEntero(0, 100, 'Saturacion fuera de lo posible'),
    // Perimetro braquial (MUAC) y cefalico no viven en preconsulta sino en
    // antropometria. Se capturan aqui porque es el momento en que se miden.
    perimetroBraquial: opcionalDecimal(50, 400, 'Perimetro braquial fuera de lo posible'),
    perimetroCefalico: opcionalDecimal(20, 70, 'Perimetro cefalico fuera de lo posible'),
    // Obligatorio aqui: es la pantalla donde se pregunta.
    motivoConsulta: z.string().trim().min(1, 'El motivo de consulta es obligatorio').max(500),
    signosPeligro: z.array(z.string().trim().min(1)).default([]),
    // Si el personal baja la gravedad que el sistema propuso, debe explicar.
    gravedad: z.enum(['urgente', 'moderado', 'leve']).optional(),
    justificacionGravedad: z.string().trim().min(10).max(500).optional(),
  })
  .refine(
    (datos) => datos.presionSis == null || datos.presionDia == null || datos.presionSis > datos.presionDia,
    { message: 'La presion sistolica debe ser mayor que la diastolica', path: ['presionSis'] },
  );

// Corregir una consulta cerrada exige decir por que: es lo que hace que la
// nota sirva de algo cuando alguien la lea dentro de un ano.
const correccion = z.object({
  campo: z.enum(['diagnosticoCie', 'diagnosticoTxt', 'tratamiento', 'proximaCita']),
  valorNuevo: z.union([z.string().trim().max(1000), z.coerce.date(), z.null()]),
  motivo: z.string().trim().min(5, 'Explique por qué se corrige').max(500),
});

// Correccion de un signo vital. El motivo solo se exige si la consulta ya
// esta en curso, y eso lo decide el servicio.
const correccionSignos = z.object({
  campo: z.enum([
    'peso', 'talla', 'temperatura', 'presionSis', 'presionDia',
    'frecCardiaca', 'frecRespiratoria', 'satOxigeno',
  ]),
  valorNuevo: z.coerce.number().nullable(),
  motivo: z.string().trim().min(5, 'Explique por qué se corrige').max(500).optional(),
});

const parametroId = z.object({
  id: z.coerce.number().int().positive('Identificador de atención invalido'),
});

// Transiciones que el personal puede pedir. El controlador valida que la
// transicion sea legal desde el estado actual.
const cambiarEstado = z.object({
  estado: z.enum(['en_atencion', 'ausente', 'en_espera'], {
    errorMap: () => ({ message: 'Estado no valido' }),
  }),
  motivo: z.string().trim().max(300).optional(),
});

// Formato CIE-10: una letra, dos digitos y opcionalmente un digito decimal.
// No se valida contra un catalogo porque el sistema no lo tiene cargado.
const CIE10 = /^[A-TV-Z][0-9]{2}(\.[0-9]{1,2})?$/;

// El codigo CIE-10 valida su formato cuando se escribe, pero no es obligatorio
// para cerrar: si no se tiene a mano, la consulta se cierra con el diagnostico
// en texto y queda pendiente de codificar. El diagnostico escrito si es
// obligatorio, porque sin el la consulta no queda registrada.
const codigoCie = z
  .string()
  .trim()
  .toUpperCase()
  .regex(CIE10, 'El código CIE-10 debe tener el formato A00 o A00.0');

const cieOpcional = codigoCie.optional().nullable().or(z.literal('').transform(() => null));
const textoLargo = z.string().trim().max(4000).optional().nullable();
const codigo = (min, max) => z.coerce.number().int().min(min).max(max).optional().nullable();

// Una fila de la impresion clinica: descripcion y, si se tiene, su CIE-10.
const filaDiagnostico = z.object({
  descripcion: z.string().trim().min(1, 'Cada diagnóstico necesita su descripción').max(300),
  cie: cieOpcional,
});

/**
 * Cierre de la consulta: la hoja de evolucion (MC, HE, EF, IC, Tx) y los
 * datos del SIGSA 3CS. Acepta tambien la forma anterior (un solo
 * diagnostico en diagnosticoTxt/diagnosticoCie).
 */
const consulta = z
  .object({
    motivoConsulta: z.string().trim().min(1).max(500).optional(),
    historiaEnfermedad: textoLargo,
    examenFisico: textoLargo,
    diagnosticos: z.array(filaDiagnostico).max(10, 'El papel admite hasta 10 diagnósticos').optional(),
    diagnosticoCie: cieOpcional,
    diagnosticoTxt: z.string().trim().max(300).optional().nullable(),
    tratamiento: z.string().trim().max(4000).optional().nullable(),
    proximaCita: z.coerce.date().optional().nullable(),

    // SIGSA 3CS, con los codigos del formulario.
    tipoConsulta: codigo(1, 4),
    controlSigsa: codigo(0, 6),
    referenciaViene: codigo(0, 2),
    referenciaFue: codigo(0, 2),
    referidoA: z.string().trim().max(200).optional().nullable(),
    lugarNotificacion: codigo(0, 3),
    numeroNotificacion: z.string().trim().max(40).optional().nullable(),
    acompanante: z.string().trim().max(160).optional().nullable(),

    // Mas de la ficha (opcional).
    // Examen fisico por sitio anatomico: cada sitio "Normal" Si/No y, aparte,
    // los hallazgos, como en el papel (MD/fichas.md 0.3).
    examenSitios: z
      .object({
        sitios: z.record(z.boolean().nullable()),
        otrosHallazgos: z.string().trim().max(2000).optional().nullable(),
        hallazgosAnormales: z.string().trim().max(2000).optional().nullable(),
      })
      .optional()
      .nullable(),
    otrosProblemas: textoLargo,
    laboratorios: textoLargo,
    orientacionIntegral: textoLargo,
  })
  .refine(
    (d) => (d.diagnosticos?.length ?? 0) > 0 || Boolean(d.diagnosticoTxt),
    { message: 'Registre al menos un diagnóstico', path: ['diagnosticos'] },
  )
  .refine(
    (d) => !(d.referenciaFue > 0) || Boolean(d.referidoA),
    { message: 'Indique a dónde fue referido', path: ['referidoA'] },
  )
  .refine(
    (d) => !(d.lugarNotificacion > 0) || Boolean(d.numeroNotificacion),
    { message: 'Indique el número de la notificación', path: ['numeroNotificacion'] },
  );

// Asignar el codigo despues, desde la lista de pendientes de codificar.
const codificacion = z.object({
  diagnosticoCie: codigoCie,
  // Solo hace falta cuando se reemplaza un codigo que ya estaba: poner el
  // que faltaba es completar, cambiarlo es corregir. Lo exige el controlador.
  motivo: z.string().trim().min(5, 'Explique por qué se cambia').max(500).optional(),
});

const prescripcion = z.object({
  insumoId: z.coerce.number().int().positive('Debe indicar el insumo'),
  cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero'),
  indicaciones: z.string().trim().max(500).optional().nullable(),
});

const sugerenciaTipo = z.object({
  cie: z.string().trim().max(10).optional(),
  descripcion: z.string().trim().max(300).optional(),
});

module.exports = {
  CIE10,
  sugerenciaTipo,
  crearAtencion,
  preconsulta,
  parametroId,
  cambiarEstado,
  consulta,
  codificacion,
  correccion,
  correccionSignos,
  prescripcion,
};
