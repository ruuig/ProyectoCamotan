/**
 * Requisicion Despacho de Almacen (FOR-ASB-01): reglas que no tocan la base.
 *
 * Funciones puras.
 */

const TIPOS_REQUISICION = [
  ['suministros', 'Suministros'],
  ['equipo', 'Equipo'],
  ['reactivos', 'Reactivos'],
  ['medicamentos', 'Medicamentos'],
  ['equipo_medico', 'Equipo médico'],
  ['equipo_quirurgico', 'Equipo quirúrgico'],
  ['equipo_laboratorio', 'Equipo de laboratorio'],
  ['otros', 'Otros'],
];
const CLAVES_TIPO = TIPOS_REQUISICION.map(([k]) => k);

// Tipo del formulario que corresponde a cada categoria del catalogo.
const TIPO_DE_CATEGORIA = {
  medicamentos: 'medicamentos',
  suplementos: 'medicamentos',
  planificacion_familiar: 'medicamentos',
  tuberculosis: 'medicamentos',
  medico_quirurgico: 'suministros',
  laboratorio: 'reactivos',
};

/** Como se escribe el articulo en el renglon del formulario. */
function descripcionInsumo(insumo) {
  return [insumo.nombreGenerico, insumo.concentracion, insumo.formaFarmaceutica].filter(Boolean).join(' ');
}

/** Tipos que se marcan segun lo que se pide, si no se indicaron. */
function tiposSugeridos(insumos) {
  const tipos = new Set(insumos.map((i) => TIPO_DE_CATEGORIA[i.categoria]).filter(Boolean));
  return tipos.size ? CLAVES_TIPO.filter((t) => tipos.has(t)) : ['medicamentos'];
}

/**
 * Lo que se despacha de cada renglon: lo indicado, o lo autorizado, o lo
 * solicitado. Nunca mas de lo autorizado.
 */
function cantidadADespachar(renglon, indicada) {
  const tope = renglon.cantidadAutorizada ?? renglon.cantidadSolicitada;
  const cantidad = indicada ?? tope;
  if (cantidad > tope) {
    return { error: `${renglon.descripcion}: se autorizaron ${tope}, no se despachan ${cantidad}` };
  }
  return { cantidad };
}

const ESTADOS_EDITABLES = ['solicitada', 'autorizada'];

module.exports = {
  TIPOS_REQUISICION, CLAVES_TIPO, descripcionInsumo, tiposSugeridos, cantidadADespachar, ESTADOS_EDITABLES,
};
