/**
 * Importacion del historial de la bodega desde los Excel del centro
 * (documentacion/Plantillas/): catalogo, alias, informes de los servicios, BRES historicos
 * y existencia inicial con sus lotes.
 *
 * Funciones puras. El script que escribe en la base es
 * scripts/importarBodega.js; lo que no se puede emparejar con seguridad se
 * deja fuera y se informa, no se adivina.
 */

const { normalizarTexto, similitud } = require('./pacientes.service');

// --- Nombres -------------------------------------------------------------------

/** Numeros de un nombre: "Amoxicilina 250mg/5ml 120ml" -> "120|250|5". */
function numerosDe(nombre) {
  // Quita los separadores de miles ("4,000,000"): se repite porque cada
  // reemplazo consume el digito que necesita el siguiente.
  let texto = String(nombre ?? '');
  for (let antes = ''; antes !== texto;) { antes = texto; texto = texto.replace(/(\d),(\d{3})(?!\d)/, '$1$2'); }
  return (texto.match(/\d+(?:[.,]\d+)?/g) ?? [])
    .map((n) => n.replace(',', '.'))
    .sort()
    .join('|');
}

/**
 * Busca a que insumo del catalogo corresponde un nombre escrito en otro Excel.
 *
 * Primero el nombre igual sin tildes ni signos. Si no, el mas parecido, pero
 * solo entre los que tienen exactamente los mismos numeros: "Amoxicilina
 * 250 mg" y "Amoxicilina 500 mg" se parecen mucho y son productos distintos.
 *
 * catalogo: [{ clave, nombre }]. Devuelve { clave, metodo, puntaje } o null.
 */
function emparejar(nombre, catalogo, umbral = 0.55) {
  const n = normalizarTexto(nombre);
  if (!n) return null;
  const exacto = catalogo.find((c) => normalizarTexto(c.nombre) === n);
  if (exacto) return { clave: exacto.clave, metodo: 'exacto', puntaje: 1 };

  const numeros = numerosDe(nombre);
  let mejor = null;
  for (const c of catalogo) {
    if (numerosDe(c.nombre) !== numeros) continue;
    const p = similitud(nombre, c.nombre);
    if (p >= umbral && (!mejor || p > mejor.puntaje)) mejor = { clave: c.clave, metodo: 'parecido', puntaje: Math.round(p * 100) / 100 };
  }
  if (mejor) return mejor;

  // Un nombre al que le falta la concentracion ("Diazepan ampolla" frente a
  // "Diazepan 10mg ampolla") solo se empareja si hay un unico candidato: si
  // existen el de 250 y el de 500, no se adivina cual era.
  const propios = numeros ? numeros.split('|') : [];
  const contiene = (a, b) => a.every((x) => b.includes(x));
  const candidatos = catalogo
    .map((c) => ({ c, otros: numerosDe(c.nombre) ? numerosDe(c.nombre).split('|') : [] }))
    .filter(({ otros }) => contiene(propios, otros) || contiene(otros, propios))
    .map(({ c }) => ({ c, p: similitud(nombre, c.nombre) }))
    .filter(({ p }) => p >= umbral + 0.05);
  if (candidatos.length === 1) {
    return { clave: candidatos[0].c.clave, metodo: 'sin concentración', puntaje: Math.round(candidatos[0].p * 100) / 100 };
  }
  return null;
}

/**
 * Equivalencias escritas a mano por quien conoce los insumos, para los
 * nombres que ninguna regla puede emparejar con seguridad.
 * filas: [{ nombreExcel, nombreCatalogo }].
 */
function aplicarEquivalencias(nombre, filas, catalogo) {
  const fila = filas.find((f) => normalizarTexto(f.nombreExcel) === normalizarTexto(nombre));
  if (!fila) return null;
  const c = catalogo.find((x) => normalizarTexto(x.nombre) === normalizarTexto(fila.nombreCatalogo));
  return c ? { clave: c.clave, metodo: 'equivalencia', puntaje: 1 } : null;
}

// --- Categorias ----------------------------------------------------------------------

/** Secciones del balance y del inventario de cierre -> categoria del centro. */
const CATEGORIA_DE_SECCION = [
  [/micronutriente/, 'suplementos'],
  [/antimalaric/, 'medicamentos'],
  [/otros medicamentos/, 'medicamentos'],
  [/planificacion/, 'planificacion_familiar'],
  [/medico quirurgic/, 'medico_quirurgico'],
  [/tuberculosis/, 'tuberculosis'],
  [/laboratorio/, 'laboratorio'],
];

// El bloque "COVID-19" mezcla de todo; se decide por el nombre y se marca
// para revision.
const PISTAS_LABORATORIO = /(reactiv|react\.|prueba|laboratorio|vacutainer|tubo conico|aceite de inmersion|papel ph|frasco.*laboratorio|frascos de 10)/;
const PISTAS_MEDICAMENTO = /(vitamina|sales de rehidratacion|diazepan|tableta|ampolla|jarabe)/;
const PISTAS_SUPLEMENTO = /(alimento complementario|alimento terapeutico)/;

/**
 * Categoria de un insumo a partir de la seccion del Excel donde aparece. Sin
 * seccion (el primer bloque) son medicamentos. Devuelve { categoria, revisar }.
 */
function categoriaDe(seccion, nombre) {
  const s = normalizarTexto(seccion);
  if (!s) return { categoria: 'medicamentos', revisar: false };
  for (const [patron, categoria] of CATEGORIA_DE_SECCION) {
    if (patron.test(s)) return { categoria, revisar: false };
  }
  const n = normalizarTexto(nombre);
  if (PISTAS_SUPLEMENTO.test(n)) return { categoria: 'suplementos', revisar: true };
  if (PISTAS_LABORATORIO.test(n)) return { categoria: 'laboratorio', revisar: true };
  if (PISTAS_MEDICAMENTO.test(n)) return { categoria: 'medicamentos', revisar: true };
  return { categoria: 'medico_quirurgico', revisar: true };
}

// --- Servicios --------------------------------------------------------------------------

/** "CENTRO COMUN. TIERRA BLANCA" y "Centro Comunitario Tierra Blanca" -> "tierra blanca". */
function claveServicio(nombre) {
  return normalizarTexto(nombre)
    .replace(/\b(centro comunitario|centro comun|c c|p s|puesto de salud)\b/g, ' ')
    .replace(/\bpor venir\b/g, 'porvenir')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A que ubicacion del sistema corresponde un servicio del balance. */
function emparejarServicio(nombre, ubicaciones) {
  if (/post\s*consulta/i.test(nombre ?? '')) return ubicaciones.find((u) => u.tipo === 'centro_salud') ?? null;
  const clave = claveServicio(nombre);
  let mejor = null;
  for (const u of ubicaciones) {
    const p = similitud(clave, claveServicio(u.nombre));
    if (p >= 0.6 && (!mejor || p > mejor.p)) mejor = { u, p };
  }
  return mejor?.u ?? null;
}

// --- Lotes ---------------------------------------------------------------------------------

/**
 * Una fecha de vencimiento creible: entre 2020 y 2040. En el semaforo hay
 * fechas como 1900 o 1930 que son errores de captura.
 */
function fechaCreible(fecha) {
  if (!fecha) return false;
  const anio = Number(String(fecha).slice(0, 4));
  return anio >= 2020 && anio <= 2040;
}

/**
 * Reparte la existencia del inventario de cierre entre los lotes que dice el
 * semaforo.
 *
 * El semaforo y el inventario no son del mismo dia, asi que casi nunca
 * cuadran. Por PEPE se fue entregando primero lo que vence primero: lo que
 * queda en bodega son los lotes que vencen ultimo. Se llena desde el lote de
 * vencimiento mas lejano hacia atras hasta completar la existencia.
 *
 * Si los lotes no alcanzan, lo que falta queda "sin lote" para verificar en
 * el inventario fisico. Si sobran, se informa y no se crea.
 */
function conciliarLotes(lotes, existencia) {
  const validos = lotes
    .filter((l) => l.lote && fechaCreible(l.vence) && Number(l.cantidad) > 0)
    .map((l) => ({ lote: String(l.lote), vence: l.vence, cantidad: Number(l.cantidad) }));
  const descartados = lotes.filter((l) => !(l.lote && fechaCreible(l.vence) && Number(l.cantidad) > 0));

  const salida = [];
  let falta = Math.max(0, Number(existencia) || 0);
  for (const l of [...validos].sort((a, b) => String(b.vence).localeCompare(String(a.vence)))) {
    if (falta <= 0) break;
    const toma = Math.min(l.cantidad, falta);
    salida.push({ ...l, cantidad: toma });
    falta -= toma;
  }
  const totalLotes = validos.reduce((s, l) => s + l.cantidad, 0);
  return {
    lotes: salida.sort((a, b) => String(a.vence).localeCompare(String(b.vence))),
    sinLote: falta,
    sobranteSemaforo: Math.max(0, totalLotes - Math.max(0, Number(existencia) || 0)),
    descartados,
  };
}

/** Un numero del Excel (puede venir vacio, como texto o con decimales). */
function entero(v) {
  if (v === null || v === undefined || v === '' || v === '-') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

module.exports = {
  numerosDe,
  emparejar,
  aplicarEquivalencias,
  categoriaDe,
  claveServicio,
  emparejarServicio,
  fechaCreible,
  conciliarLotes,
  entero,
};
