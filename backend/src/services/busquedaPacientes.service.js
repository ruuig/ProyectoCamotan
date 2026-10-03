// Busqueda de pacientes.
//
// En el establecimiento no se busca como en un sistema: se escribe sin tildes,
// con errores, y muchas veces se pregunta por la madre en vez de por la nina.
// Esta busqueda tolera eso y ademas dice por que encontro cada resultado.
//
// La parte pura (decidir que se busca y como se ordena) esta aqui y tiene
// pruebas; la consulta vive en el controlador.

// Umbral de similitud por trigramas. Por debajo, los resultados son ruido.
const SIMILITUD_MINIMA = 0.25;

const ETAPAS_MESES = {
  lactante_ninez: { desde: 0, hasta: 120 },
  adolescente_joven: { desde: 120, hasta: 360 },
  adulto: { desde: 360, hasta: 720 },
  persona_mayor: { desde: 720, hasta: Infinity },
};

function sinTildes(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Decide como interpretar lo que se escribio.
 *
 * Si son solo digitos, primero se buscan identificadores: CUI, expediente,
 * telefono y DPI. Nadie escribe trece digitos esperando una coincidencia
 * aproximada de nombre.
 */
function interpretarTexto(texto) {
  const limpio = String(texto ?? '').trim();
  if (limpio === '') return { tipo: 'vacio', valor: '' };

  const soloDigitos = /^[0-9]+$/.test(limpio.replace(/[\s-]/g, ''));
  if (soloDigitos) return { tipo: 'numero', valor: limpio.replace(/[\s-]/g, '') };

  // Un expediente tiene la forma 2026-00123.
  if (/^\d{4}-\d{3,6}$/.test(limpio)) return { tipo: 'expediente', valor: limpio };

  return { tipo: 'texto', valor: sinTildes(limpio) };
}

/**
 * Rango de edad en meses a partir de los filtros de anios y etapa de vida.
 * Devuelve null cuando no hay filtro por edad.
 */
function rangoEdadMeses({ edadMinima, edadMaxima, etapa }) {
  if (etapa && ETAPAS_MESES[etapa]) return ETAPAS_MESES[etapa];

  if (edadMinima == null && edadMaxima == null) return null;

  return {
    desde: edadMinima == null ? 0 : edadMinima * 12,
    hasta: edadMaxima == null ? Infinity : (edadMaxima + 1) * 12,
  };
}

/**
 * Convierte un rango de edad en un rango de fechas de nacimiento.
 * Alguien de 5 anios nacio entre hace 6 anios (exclusivo) y hace 5.
 */
function rangoNacimiento(rango, ahora = new Date()) {
  if (!rango) return null;

  const restarMeses = (meses) => {
    if (!Number.isFinite(meses)) return null;
    const f = new Date(ahora);
    f.setUTCMonth(f.getUTCMonth() - meses);
    return f;
  };

  return {
    // Mayor edad => fecha mas antigua.
    desde: restarMeses(rango.hasta),
    hasta: restarMeses(rango.desde),
  };
}

/**
 * Explica por que un paciente aparecio en los resultados.
 *
 * Sin esto, encontrar a una nina buscando "María López" resulta desconcertante
 * para quien esta en el mostrador.
 */
function razonDeCoincidencia(paciente, interpretado) {
  const { tipo, valor } = interpretado;
  if (tipo === 'vacio') return null;

  if (tipo === 'numero' || tipo === 'expediente') {
    if (paciente.cui === valor) return `Coincide el CUI: ${valor}`;
    if (paciente.expediente === valor) return `Coincide el expediente: ${valor}`;
    if (paciente.expedientePapel === valor) {
      return `Coincide el expediente en papel: ${valor}`;
    }
    if (paciente.telefono && paciente.telefono.replace(/[\s-]/g, '') === valor) {
      return 'Coincide el teléfono';
    }
    if (paciente.responsableDpi === valor) {
      return `Coincide el DPI del responsable: ${paciente.responsableNombre ?? ''}`.trim();
    }
    return null;
  }

  const nombre = sinTildes(`${paciente.apellidos} ${paciente.nombres}`);
  if (nombre.includes(valor)) return null; // coincidencia obvia, no hace falta explicarla

  const responsable = sinTildes(paciente.responsableNombre ?? '');
  if (responsable && responsable.includes(valor)) {
    return `Coincide con el responsable: ${paciente.responsableNombre}`;
  }

  return 'Coincidencia aproximada del nombre';
}

module.exports = {
  SIMILITUD_MINIMA,
  ETAPAS_MESES,
  sinTildes,
  interpretarTexto,
  rangoEdadMeses,
  rangoNacimiento,
  razonDeCoincidencia,
};
