/**
 * Texto de la lista CIE-10 de la OPS para leerlo en pantalla.
 *
 * La lista oficial viene en MAYÚSCULAS y casi sin tildes ("INFECCION DE VIAS
 * URINARIAS"). Aquí se pasa a tipo oración y se le ponen las tildes:
 * "Infección de vías urinarias". El texto oficial se guarda aparte, sin tocar.
 *
 * Funciones puras.
 */

// Siglas que se quedan en mayúscula.
const SIGLAS = new Set([
  'VIH', 'SIDA', 'ACTH', 'ADN', 'ARN', 'BCG', 'DPT', 'SPR', 'MMR', 'LSD', 'DHL', 'RH', 'HTLV', 'OMS', 'OMSK',
  'XX', 'XY', 'XXX', 'XXY', 'XYY', 'XO', 'CK', 'ST', 'DIU', 'SARS', 'MERS', 'HELLP', 'TORCH', 'ABO', 'EB', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
]);

// Apellidos y lugares que dan nombre a enfermedades.
const NOMBRES = [
  'Alzheimer', 'Chagas', 'Kaposi', 'Hodgkin', 'Crohn', 'Cushing', 'Klinefelter', 'Huntington', 'Parkinson', 'Turner', 'Down',
  'Edwards', 'Patau', 'Lyme', 'Creutzfeldt-Jakob', 'Burkitt', 'Meckel', 'Paget', 'Hansen', 'Waterhouse-Friderichsen', 'Pontiac',
  'Brill', 'Oropouche', 'Colorado', 'Lassa', 'Marburg', 'Ebola', 'Sezary', 'Waldenstrom', 'Letterer-Siwe', 'Von', 'Nezelof',
  'Wiskott-Aldrich', 'George', 'Epstein-Barr', 'Nelson', 'Wernicke', 'Korsakov', 'Lesch-Nyhan', 'Gilbert', 'Crigler-Najjar', 'Pick',
  'Rett', 'Asperger', 'Hallervorden-Spatz', 'Bell', 'Melkersson', 'Refsum', 'Guillain-Barré', 'Eaton-Lambert', 'Riley-Day',
  'Horner', 'Reye', 'Meniere', 'Dressler', 'Moyamoya', 'Raynaud', 'Budd-Chiari', 'Macleod', 'Mendelson', 'Reiter', 'Felty',
  'Still', 'Kaschin-Beck', 'Behcet', 'Kienbock', 'Erb', 'Klumpke', 'Wilson-Mikity', 'Arnold-Chiari', 'Fallot', 'Ebstein',
  'Hirschsprung', 'Potter', 'Klippel-Feil', 'Ehlers-Danlos', 'Marfan', 'Wilson', 'Addison', 'Graves', 'Basedow', 'Hashimoto',
  'Wilms', 'Ewing', 'Kawasaki', 'Barrett', 'Zollinger-Ellison', 'Mallory-Weiss', 'Plummer-Vinson', 'Sjogren', 'Tourette',
  'Bowen', 'Peyronie', 'Dupuytren', 'Perthes', 'Osgood-Schlatter', 'Legg-Calve-Perthes', 'Scheuermann', 'Kienböck', 'Gaucher',
  'Tay-Sachs', 'Niemann-Pick', 'Hurler', 'Hunter', 'Morquio', 'Fabry', 'Pompe', 'Duchenne', 'Becker', 'Friedreich', 'Charcot-Marie-Tooth',
  'Charcot', 'Lennox-Gastaut', 'West', 'Brown-Sequard', 'Arnold', 'Chiari', 'Dandy-Walker', 'Hartnup', 'Menkes', 'Bartter', 'Conn',
  'Sheehan', 'Simmonds', 'Kallmann', 'Laron', 'Prader-Willi', 'Angelman', 'Noonan', 'Pierre', 'Robin', 'Treacher', 'Collins',
  'Apert', 'Crouzon', 'Goldenhar', 'Moebius', 'Poland', 'Sturge-Weber', 'Hippel-Lindau', 'Peutz-Jeghers', 'Gardner', 'Cowden',
  'Bourneville', 'Recklinghausen', 'Kimmelstiel-Wilson', 'Goodpasture', 'Wegener', 'Churg-Strauss', 'Takayasu', 'Buerger',
  'Henoch', 'Schonlein', 'Schönlein', 'Kasabach-Merritt', 'Evans', 'Fanconi', 'Diamond-Blackfan', 'Glanzmann', 'Bernard-Soulier',
  'Willebrand', 'Christmas', 'Hageman', 'Stuart', 'Waardenburg', 'Usher', 'Alport', 'Lowe', 'Liddle', 'Gitelman', 'Cogan', 'Adie',
  'Argyll', 'Robertson', 'Duane', 'Brown', 'Stevens-Johnson', 'Lyell', 'Kawasaki', 'Rocosas', 'Rift', 'Nilo', 'Kyasanur', 'Junin',
  'Machupo', 'Hanta', 'Murray', 'Venezuela', 'Rocio', 'Rocío', 'Bancroft', 'Malasia', 'Loa', 'Calabar', 'Madura', 'Vincent',
  'Ludwig', 'Bartholin', 'Skene', 'Cowper', 'Meibomio', 'Tenon', 'Descemet', 'Bowman', 'Schlemm', 'Eustaquio', 'Falopio',
  'Douglas', 'Morgagni', 'Bochdalek', 'Spiegel', 'Richter', 'Littre', 'Colles', 'Smith', 'Barton', 'Monteggia', 'Galeazzi',
  'Bennett', 'Jefferson', 'Hangman', 'Volkmann', 'Sudeck', 'Tietze', 'Osler', 'Weber', 'Rendu', 'Klippel', 'Trenaunay', 'Maffucci',
  'Ollier', 'Albright', 'Mccune', 'Jaffe', 'Lichtenstein', 'Hand-Schuller-Christian', 'Langerhans', 'Rosai-Dorfman', 'Castleman',
  'Kikuchi', 'Mikulicz', 'Heerfordt', 'Lofgren', 'Kveim', 'Whipple', 'Hirschsprung', 'Menetrier', 'Ménétrier', 'Dieulafoy', 'Boerhaave',
  'Zenker', 'Killian', 'Treitz', 'Meckel', 'Oddi', 'Vater', 'Caroli', 'Mirizzi', 'Courvoisier', 'Wernicke', 'Broca', 'Korsakoff',
];
const sinTilde = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const NOMBRE = new Map(NOMBRES.map((n) => [sinTilde(n.toLowerCase()), n]));
const nombrePropio = (minuscula) => NOMBRE.get(sinTilde(minuscula));

// Palabras que la lista trae sin tilde y que no siguen una regla.
const TILDES = {
  vehiculo: 'vehículo', vehiculos: 'vehículos', transito: 'tránsito', area: 'área', areas: 'áreas', organo: 'órgano', organos: 'órganos',
  multiple: 'múltiple', multiples: 'múltiples', recien: 'recién', peaton: 'peatón', peatones: 'peatones', victima: 'víctima', victimas: 'víctimas',
  region: 'región', utero: 'útero', torax: 'tórax', higado: 'hígado', oido: 'oído', oidos: 'oídos', autonomo: 'autónomo', autonoma: 'autónoma',
  ulcera: 'úlcera', ulceras: 'úlceras', pulmon: 'pulmón', corazon: 'corazón', sintoma: 'síntoma', sintomas: 'síntomas', sindrome: 'síndrome',
  sindromes: 'síndromes', caida: 'caída', caidas: 'caídas', automovil: 'automóvil', autobus: 'autobús', riñon: 'riñón', periodo: 'período',
  sifilis: 'sífilis', embrion: 'embrión', rubeola: 'rubéola', tetanos: 'tétanos', cesarea: 'cesárea', prostata: 'próstata', hipofisis: 'hipófisis',
  vomito: 'vómito', vomitos: 'vómitos', nauseas: 'náuseas', nausea: 'náusea', varices: 'várices', paralisis: 'parálisis', epifisis: 'epífisis',
  diafisis: 'diáfisis', apofisis: 'apófisis', perone: 'peroné', calcaneo: 'calcáneo', coccix: 'cóccix', esternon: 'esternón', omoplato: 'omóplato',
  femur: 'fémur', craneo: 'cráneo', decubito: 'decúbito', apendice: 'apéndice', pancreas: 'páncreas', maleolo: 'maléolo', oseo: 'óseo', osea: 'ósea',
  oseos: 'óseos', oseas: 'óseas', aereo: 'aéreo', aerea: 'aérea', aereos: 'aéreos', aereas: 'aéreas', subcutaneo: 'subcutáneo', subcutanea: 'subcutánea',
  subcutaneos: 'subcutáneos', subcutaneas: 'subcutáneas', sanguineo: 'sanguíneo', sanguinea: 'sanguínea', sanguineos: 'sanguíneos', sanguineas: 'sanguíneas',
  espontaneo: 'espontáneo', espontanea: 'espontánea', cutaneo: 'cutáneo', cutanea: 'cutánea', cutaneos: 'cutáneos', cutaneas: 'cutáneas',
  mucocutaneo: 'mucocutáneo', mucocutanea: 'mucocutánea', carbon: 'carbón', monoxido: 'monóxido', dioxido: 'dióxido', oxido: 'óxido', segun: 'según',
  despues: 'después', tambien: 'también', asi: 'así', ultimo: 'último', ultima: 'última', dia: 'día', dias: 'días', rio: 'río', tendon: 'tendón',
  tendones: 'tendones', talon: 'talón', nucleo: 'núcleo', nucleos: 'núcleos', cardiaca: 'cardíaca', cardiaco: 'cardíaco', cardiacas: 'cardíacas',
  cardiacos: 'cardíacos', ileon: 'íleon', deficit: 'déficit', conyuge: 'cónyuge', huesped: 'huésped', genero: 'género', numero: 'número',
  cornea: 'córnea', corneas: 'córneas', linea: 'línea', lineas: 'líneas', via: 'vía', vias: 'vías', anomalia: 'anomalía', anomalias: 'anomalías',
  cirugia: 'cirugía', neumonia: 'neumonía', neumonias: 'neumonías', pais: 'país', paises: 'países', raiz: 'raíz', maiz: 'maíz', baul: 'baúl',
  esofago: 'esófago', estomago: 'estómago', petroleo: 'petróleo', organico: 'orgánico', heroina: 'heroína', cocaina: 'cocaína', cafeina: 'cafeína',
  proteina: 'proteína', proteinas: 'proteínas', hemoglobina: 'hemoglobina', vitamina: 'vitamina', insulina: 'insulina', biceps: 'bíceps',
  triceps: 'tríceps', cuadriceps: 'cuádriceps', abdomen: 'abdomen', acaros: 'ácaros', acaro: 'ácaro', acido: 'ácido', acidos: 'ácidos',
  arbol: 'árbol', arboles: 'árboles', angulo: 'ángulo', organulo: 'orgánulo', hematico: 'hemático', limite: 'límite', limites: 'límites',
  lagrima: 'lágrima', lagrimas: 'lágrimas', parpado: 'párpado', parpados: 'párpados', menisco: 'menisco', craneal: 'craneal', capitulo: 'capítulo',
  capitulos: 'capítulos', heroe: 'héroe', huerfano: 'huérfano', farmaco: 'fármaco', farmacos: 'fármacos', cancer: 'cáncer', torsion: 'torsión',
  tuneles: 'túneles', tunel: 'túnel', esteril: 'estéril', esteriles: 'estériles', fragil: 'frágil', util: 'útil', debil: 'débil', facil: 'fácil',
  dificil: 'difícil', movil: 'móvil', moviles: 'móviles', fertil: 'fértil', pubis: 'pubis', trigemino: 'trigémino', coledoco: 'colédoco',
  acetabulo: 'acetábulo', infundibulo: 'infundíbulo', hipotalamo: 'hipotálamo', talamo: 'tálamo', fosforo: 'fósforo', sodio: 'sodio', calcio: 'calcio',
  maxilar: 'maxilar', malar: 'malar', reflujo: 'reflujo', huesos: 'huesos', glucosido: 'glucósido', glucosidos: 'glucósidos', alcaloide: 'alcaloide',
  hongo: 'hongo', bacilo: 'bacilo', aboveda: 'abóveda', boveda: 'bóveda', regimen: 'régimen', examen: 'examen', origen: 'origen', virus: 'virus',
  dosis: 'dosis', crisis: 'crisis', rodilla: 'rodilla', menopausica: 'menopáusica', menopausico: 'menopáusico', etmoides: 'etmoides', esfenoides: 'esfenoides',
  hioides: 'hioides', tiroides: 'tiroides', paratiroides: 'paratiroides', mas: 'más', cronicamente: 'crónicamente', unicamente: 'únicamente',
  rapidamente: 'rápidamente', minimo: 'mínimo', minima: 'mínima', maximo: 'máximo', maxima: 'máxima', optimo: 'óptimo', proximo: 'próximo',
  proxima: 'próxima', comun: 'común', insipida: 'insípida', insipido: 'insípido', parasito: 'parásito', parasitos: 'parásitos', acaro: 'ácaro', comunes: 'comunes', unico: 'único', unica: 'única', unicos: 'únicos', unicas: 'únicas', vertice: 'vértice', vertices: 'vértices',
  pretermino: 'pretérmino', preterminos: 'pretérminos', antrax: 'ántrax', postermino: 'postérmino', termino: 'término', proximal: 'proximal', esofagico: 'esofágico', lumbago: 'lumbago', ganglio: 'ganglio', ganglionar: 'ganglionar',
};

const VOCAL_TILDE = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };

/** Pone tilde a la última vocal de la raíz (para esdrújulas como crónico, glándula). */
function tildeEnRaiz(raiz, final, vocalFinal = false) {
  if (/[áéíóú]/.test(raiz)) return null;
  if (!vocalFinal && /[aeiou]$/.test(raiz)) return null; // mosaico, laico: no llevan
  // La u de "qu" y "gu" no suena: psíquico, no psiqúico.
  for (let i = raiz.length - 1; i >= 0; i -= 1) {
    const c = raiz[i];
    if (!VOCAL_TILDE[c]) continue;
    if (c === 'u' && i > 0 && (raiz[i - 1] === 'q' || raiz[i - 1] === 'g')) continue;
    return raiz.slice(0, i) + VOCAL_TILDE[c] + raiz.slice(i + 1) + final;
  }
  return null;
}

/** La palabra (ya en minúscula) con su tilde, si la lleva. */
function conTilde(p) {
  if (TILDES[p]) return TILDES[p];
  if (/[áéíóú]/.test(p)) return p;
  let m;
  // -ción, -sión, -xión (en singular; el plural "-ciones" no lleva).
  if ((m = p.match(/^(.+)(c|s|x)ion$/))) return `${m[1]}${m[2]}ión`;
  // Esdrújulas frecuentes en medicina: crónico, glándula, patógeno, esófago.
  if (p.length >= 6 && (m = p.match(/^(.+)(ico|ica|icos|icas|ula|ulo|ulas|ulos|geno|gena|genos|genas|fago|fagos)$/))) {
    // En -geno y -fago la vocal de antes sí lleva tilde: alucinógeno, esófago.
    return tildeEnRaiz(m[1], m[2], /^(geno|gena|genos|genas|fago|fagos)$/.test(m[2])) ?? p;
  }
  // Hiatos en -ía: cardiopatía, lobotomía, radiografía, hemiplejía, miopía.
  if ((m = p.match(/^(.+(?:pat|tom|graf|log|plej|op|scop|ectom|metr|terap|fon|algi?))ia(s?)$/))) {
    if (/(terap|algi|scop)$/.test(m[1])) return p; // terapia, neuralgia, endoscopia: sin tilde
    return `${m[1]}ía${m[2]}`;
  }
  return p;
}

// Una letra sola en mayúscula después de estas palabras: hepatitis B, tipo A.
const ANTES_DE_LETRA = new Set(['fiebre', 'tipo', 'hepatitis', 'vitamina', 'grupo', 'factor', 'virus', 'influenza', 'clase', 'fase', 'grado', 'estadio', 'estreptococo', 'estreptococos', 'cadena', 'forma']);

/** "INFECCION DE VIAS URINARIAS" → "Infección de vías urinarias". */
function legible(oficial) {
  const partes = String(oficial ?? '').trim().split(/([^A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9*'-]+)/);
  let anterior = '';
  const salida = partes.map((parte) => {
    if (!/[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9]/.test(parte)) return parte;
    let resultado;
    if (/\d/.test(parte) || SIGLAS.has(parte.toUpperCase())) {
      resultado = parte.toUpperCase();
    } else if (parte.length === 1 && ANTES_DE_LETRA.has(anterior)) {
      resultado = parte.toUpperCase();
    } else {
      const minuscula = parte.toLowerCase();
      // Nombres compuestos con guion: Guillain-Barré, Creutzfeldt-Jakob.
      const nombre = nombrePropio(minuscula) ?? (minuscula.includes('-') && minuscula.split('-').every((t) => nombrePropio(t))
        ? minuscula.split('-').map(nombrePropio).join('-')
        : null);
      resultado = nombre ?? minuscula.split('-').map(conTilde).join('-');
    }
    anterior = parte.toLowerCase();
    return resultado;
  });
  const texto = salida.join('');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

module.exports = { legible, conTilde };
