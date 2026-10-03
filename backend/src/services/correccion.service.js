const prisma = require('../config/db');

/**
 * Correcciones sobre una consulta ya cerrada.
 *
 * Al cerrar una consulta sus datos quedan fijos. Eso no significa que no se
 * puedan corregir: significa que corregir deja rastro. El dato original no se
 * borra, se registra que se corrigio, quien y por que.
 *
 * Es el mismo principio que la trazabilidad de inventario, y por la misma
 * razon: un expediente clinico tiene que poder reconstruirse tal como estaba
 * el dia que se tomo una decision. Si el diagnostico se puede reescribir en
 * silencio, nadie puede saber que leia el medico cuando receto.
 */

// Lo que se puede corregir despues de cerrar. El resto (fechas, estado,
// paciente) no se corrige: se anula la atencion.
const CAMPOS_CORREGIBLES = {
  diagnosticoCie: 'Código CIE-10',
  diagnosticoTxt: 'Diagnóstico',
  tratamiento: 'Tratamiento',
  proximaCita: 'Próxima cita',
};

function fallo(status, codigo, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  error.codigo = codigo;
  error.mensaje = mensaje;
  return error;
}

/** Como se guarda un valor en la nota, cualquiera que sea su tipo. */
function comoTexto(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

/**
 * Aplica una correccion dejando la nota.
 *
 * Devuelve la atencion actualizada y la nota creada, las dos en la misma
 * transaccion: no puede quedar un dato cambiado sin su constancia.
 */
async function corregir(atencion, { campo, valorNuevo, motivo, usuarioId }) {
  if (!Object.keys(CAMPOS_CORREGIBLES).includes(campo)) {
    throw fallo(400, 'campo_no_corregible', `El campo "${campo}" no se corrige de esta forma`);
  }

  if (atencion.estado !== 'atendido') {
    throw fallo(
      409,
      'consulta_abierta',
      'La consulta todavía está abierta: corríjala directamente, sin nota',
    );
  }

  const anterior = atencion[campo];
  if (comoTexto(anterior) === comoTexto(valorNuevo)) {
    throw fallo(400, 'sin_cambio', 'El valor nuevo es igual al que ya estaba');
  }

  return prisma.$transaction(async (tx) => {
    const actualizada = await tx.atencion.update({
      where: { id: atencion.id },
      data: { [campo]: valorNuevo },
    });

    // El diagnostico corregido es el principal: la primera fila de la
    // impresion clinica dice lo mismo.
    const enFila = { diagnosticoTxt: 'descripcion', diagnosticoCie: 'cie' }[campo];
    if (enFila) {
      await tx.diagnosticoAtencion.updateMany({
        where: { atencionId: atencion.id, orden: 0 },
        data: { [enFila]: valorNuevo },
      });
    }

    const nota = await tx.notaCorreccion.create({
      data: {
        atencionId: atencion.id,
        campo,
        valorAnterior: comoTexto(anterior),
        valorNuevo: comoTexto(valorNuevo),
        motivo,
        registradaPor: usuarioId,
      },
    });

    return { atencion: actualizada, nota };
  });
}

/**
 * Deja constancia sin cambiar nada mas.
 *
 * Lo usa la codificacion, que ya escribe el campo por su cuenta: cuando
 * reemplaza un codigo que ya existia, eso es una correccion y debe verse.
 */
async function registrarNota({ atencionId, campo, valorAnterior, valorNuevo, motivo, usuarioId }, tx = prisma) {
  return tx.notaCorreccion.create({
    data: {
      atencionId,
      campo,
      valorAnterior: comoTexto(valorAnterior),
      valorNuevo: comoTexto(valorNuevo),
      motivo,
      registradaPor: usuarioId,
    },
  });
}

/** Como se nombra un campo corregido, venga de la consulta o de preconsulta. */
function etiquetaDe(campo) {
  if (campo.startsWith('preconsulta.')) {
    const propio = campo.slice('preconsulta.'.length);
    return CAMPOS_PRECONSULTA[propio] ?? propio;
  }
  return CAMPOS_CORREGIBLES[campo] ?? campo;
}

/** Las correcciones de una atencion, de la mas reciente a la mas antigua. */
async function historial(atencionId) {
  const notas = await prisma.notaCorreccion.findMany({
    where: { atencionId },
    include: { usuario: { select: { nombre: true } } },
    orderBy: { registradaEn: 'desc' },
  });

  return notas.map((n) => ({
    id: n.id,
    campo: n.campo,
    etiqueta: etiquetaDe(n.campo),
    valorAnterior: n.valorAnterior,
    valorNuevo: n.valorNuevo,
    motivo: n.motivo,
    usuario: n.usuario.nombre,
    registradaEn: n.registradaEn,
  }));
}


// --- Correccion de la preconsulta -----------------------------------------

/**
 * Lo que el medico puede corregir de la toma de signos vitales.
 *
 * Los signos de peligro no entran: cambiarlos cambia la gravedad y el puntaje
 * de la cola, y eso ya no es una correccion de digitacion.
 */
const CAMPOS_PRECONSULTA = {
  peso: 'Peso',
  talla: 'Talla',
  temperatura: 'Temperatura',
  presionSis: 'Presión sistólica',
  presionDia: 'Presión diastólica',
  frecCardiaca: 'Frecuencia cardíaca',
  frecRespiratoria: 'Frecuencia respiratoria',
  satOxigeno: 'Saturación de oxígeno',
};

/**
 * Corrige un dato de la preconsulta.
 *
 * Mientras la atencion esta en espera, preconsulta corrige lo suyo sin mas:
 * nadie ha leido todavia ese dato para decidir nada. En cuanto el medico la
 * llama, el dato queda congelado para preconsulta y solo el medico lo toca,
 * dejando nota: a partir de ahi alguien ya actuo sobre el.
 */
async function corregirPreconsulta(atencion, { campo, valorNuevo, motivo, usuario }) {
  if (!Object.keys(CAMPOS_PRECONSULTA).includes(campo)) {
    throw fallo(400, 'campo_no_corregible', `El campo "${campo}" no se corrige de esta forma`);
  }
  if (!atencion.preconsulta) {
    throw fallo(404, 'sin_preconsulta', 'Esta atención todavía no tiene preconsulta');
  }

  const enEspera = atencion.estado === 'en_espera';
  const esMedico = ['medico', 'admin'].includes(usuario.rol);

  if (!enEspera && !esMedico) {
    throw fallo(
      409,
      'datos_congelados',
      'La consulta ya está en curso: los datos de preconsulta solo los corrige el médico',
    );
  }

  const anterior = atencion.preconsulta[campo];
  if (comoTexto(anterior) === comoTexto(valorNuevo)) {
    throw fallo(400, 'sin_cambio', 'El valor nuevo es igual al que ya estaba');
  }

  // Corregir antes de que nadie lo lea no necesita nota; despues, si.
  const dejaNota = !enEspera;
  if (dejaNota && !motivo) {
    throw fallo(
      400,
      'motivo_requerido',
      'La consulta ya está en curso: explique por qué se corrige',
    );
  }

  return prisma.$transaction(async (tx) => {
    const actualizada = await tx.preconsulta.update({
      where: { atencionId: atencion.id },
      data: { [campo]: valorNuevo },
    });

    const nota = dejaNota
      ? await tx.notaCorreccion.create({
          data: {
            atencionId: atencion.id,
            campo: `preconsulta.${campo}`,
            valorAnterior: comoTexto(anterior),
            valorNuevo: comoTexto(valorNuevo),
            motivo,
            registradaPor: usuario.id,
          },
        })
      : null;

    return { preconsulta: actualizada, nota };
  });
}

module.exports = {
  CAMPOS_CORREGIBLES,
  CAMPOS_PRECONSULTA,
  comoTexto,
  corregir,
  corregirPreconsulta,
  registrarNota,
  historial,
};
