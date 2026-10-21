/**
 * Unidad de medida de un insumo a partir de su nombre, como lo escribe el
 * catálogo del MSPAS: «Acetaminofén 500mg. Tableta» -> tableta,
 * «Amoxicilina 250mg/5ml Susp. Fco 120ml» -> frasco. Los insumos se cargaron
 * del Excel con «unidad» en todos; la requisición y el BRES deben decir en qué
 * se cuenta cada uno. Si el nombre no dice la presentación, queda «unidad».
 */

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// En orden: gana la primera que aparece en el nombre.
const REGLAS = [
  [/\b(unidad|uni\.)\s*$/, 'unidad'],
  [/\brollo\b|\bbobina\b/, 'rollo'],
  [/\bcaja\b/, 'caja'],
  [/\bgalon\b/, 'galón'],
  [/\blitro\b/, 'litro'],
  [/\blibra\b/, 'libra'],
  [/\bpar(es)?\b/, 'par'],
  [/\bpa?quete\b/, 'paquete'],
  [/\bpieza\b/, 'pieza'],
  [/\btalonario\b/, 'talonario'],
  [/\bkit\b/, 'kit'],
  [/\bblister\b/, 'blíster'],
  [/\bbolsa\b/, 'bolsa'],
  [/\bsobre\b/, 'sobre'],
  [/\btablet(a|as)\b|\btab\b|\bcomprimidos?\b/, 'tableta'],
  [/\bcapsulas?\b/, 'cápsula'],
  [/\bperla\b/, 'perla'],
  [/\bovulo\b/, 'óvulo'],
  [/\bvial\b/, 'vial'],
  [/\bampolla\b|\bamp\b/, 'ampolla'],
  [/\btubo\b(?! conector)|\bcrema\b|\bunguento\b|\bgel topico\b/, 'tubo'],
  [/\bbote\b|\btarro\b/, 'bote'],
  [/\bfrasco\b|\bfco\b|\bjarabe\b|\bjbe\b|\bsusp(ension)?\b|\blocion\b|\bgranulado\b|\bgotero\b|\bgotas (oftalmicas|oticas)\b/, 'frasco'],
  [/\byardas?\b/, 'yarda'],
];

// Nombres que empiezan con el objeto mismo («Bolsas rojas…», «Tubos al vacío…»,
// «Frascos para muestras…»): esa primera palabra no es la presentación.
const OBJETO = /^(bolsas?|tubos?|frascos)\s+/;

function unidadDesdeNombre(nombre) {
  const texto = sinTildes(String(nombre ?? '')).replace(/[.,;()]/g, (c) => (c === '.' ? '. ' : ' ')).replace(/\s+/g, ' ').trim();
  const resto = texto.replace(OBJETO, '');
  for (const [regla, unidad] of REGLAS) {
    if (regla.test(unidad === 'unidad' ? texto : resto)) return unidad;
  }
  return 'unidad';
}

module.exports = { unidadDesdeNombre };
