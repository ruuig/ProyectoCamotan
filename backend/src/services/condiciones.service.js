const { calcularEdad } = require('./pacientes.service');

// Condiciones que el sistema deriva de la edad y mantiene al dia solo.
// Las demas (embarazo, discapacidad) las registra el personal.
const MESES_MENOR_5 = 60;
const ANIOS_ADULTO_MAYOR = 60;
const DERIVADAS_DE_EDAD = ['menor_5', 'adulto_mayor'];

// Funcion pura: dada una fecha de nacimiento, que condiciones por edad aplican.
function condicionesPorEdad(fechaNacimiento, ahora = new Date()) {
  const { anios, edadMeses } = calcularEdad(fechaNacimiento, ahora);
  const tipos = [];

  if (edadMeses < MESES_MENOR_5) tipos.push('menor_5');
  if (anios >= ANIOS_ADULTO_MAYOR) tipos.push('adulto_mayor');

  return tipos;
}

// Abre las condiciones por edad que falten y cierra las que ya no apliquen.
// Recibe el cliente de transaccion para poder usarse dentro de una.
async function sincronizarCondicionesPorEdad(tx, paciente) {
  const aplican = new Set(condicionesPorEdad(paciente.fechaNacimiento));

  const vigentes = await tx.condicionPaciente.findMany({
    where: { pacienteId: paciente.id, tipo: { in: DERIVADAS_DE_EDAD }, vigenteHasta: null },
    select: { tipo: true },
  });
  const yaTiene = new Set(vigentes.map((c) => c.tipo));

  for (const tipo of DERIVADAS_DE_EDAD) {
    if (aplican.has(tipo) && !yaTiene.has(tipo)) {
      await tx.condicionPaciente.create({ data: { pacienteId: paciente.id, tipo } });
    }
    // Un nino que cumple 5 anios deja de tener la condicion, pero el registro
    // se cierra con fecha en lugar de borrarse: el historial explica por que
    // tuvo prioridad en su momento.
    if (!aplican.has(tipo) && yaTiene.has(tipo)) {
      await tx.condicionPaciente.updateMany({
        where: { pacienteId: paciente.id, tipo, vigenteHasta: null },
        data: { vigenteHasta: new Date() },
      });
    }
  }
}

module.exports = {
  MESES_MENOR_5,
  ANIOS_ADULTO_MAYOR,
  DERIVADAS_DE_EDAD,
  condicionesPorEdad,
  sincronizarCondicionesPorEdad,
};
