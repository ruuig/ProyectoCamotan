/**
 * Etapas de vida con su color. La etapa decide qué ficha clínica le toca al
 * paciente: por eso es el color de su tarjeta en la lista y de su perfil, y
 * los botones de etapa de la búsqueda sirven de leyenda.
 *
 * Las claves son las del servidor (etapaVida.service); el recién nacido
 * comparte el color de la niñez porque su filtro es el mismo.
 *
 * Colores validados para daltonismo en el orden del anillo (cada etapa contra
 * la siguiente y la última contra la primera).
 */
export const ETAPAS = [
  { valor: 'lactante_ninez', etiqueta: 'Niñez (menor de 10)', corta: 'Niñez', rango: '0 a 9 años', hasta: 10, color: '#3D7BE0', fondo: '#E3EDFC', tinta: '#1F4FA8' },
  { valor: 'adolescente_joven', etiqueta: 'Adolescencia y juventud (10 a 29)', corta: 'Adolescencia y juventud', rango: '10 a 29 años', hasta: 30, color: '#C2489A', fondo: '#FBE7F3', tinta: '#8E2A6C' },
  { valor: 'adulto', etiqueta: 'Adultez (30 a 59)', corta: 'Adultez', rango: '30 a 59 años', hasta: 60, color: '#B7791F', fondo: '#F8EEDB', tinta: '#7A4E0F' },
  { valor: 'persona_mayor', etiqueta: 'Persona mayor (60 y más)', corta: 'Persona mayor', rango: '60 años y más', hasta: Infinity, color: '#17A08A', fondo: '#DDF4EF', tinta: '#0F6E5E' },
];

/** Variables CSS de una etapa (--et, --et-fondo, --et-tinta). */
export const estiloEtapa = (e) => (e ? { '--et': e.color, '--et-fondo': e.fondo, '--et-tinta': e.tinta } : {});

/** Etapa por la edad en años, o por la clave que manda el servidor. */
export function etapaDe(paciente) {
  const clave = paciente.etapa?.clave;
  if (clave) return ETAPAS.find((e) => e.valor === clave) ?? (clave === 'recien_nacido' ? ETAPAS[0] : null);
  const anios = paciente.edad?.anios;
  if (anios == null) return null;
  return ETAPAS.find((e) => anios < e.hasta);
}

export function iniciales(p) {
  const primera = (t) => (t ?? '').trim().charAt(0).toUpperCase();
  return `${primera(p.nombres)}${primera(p.apellidos)}`;
}
