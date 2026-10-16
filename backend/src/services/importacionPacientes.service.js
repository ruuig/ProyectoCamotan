/**
 * Importacion de la base de pacientes que el centro llevaba en Excel.
 *
 * El libro tiene una hoja por anio (2023 a 2026), escrita a mano por personas
 * distintas: el mismo paciente aparece en varios anios, los nombres vienen a
 * veces con los apellidos primero y a veces al final, la edad se escribe de
 * muchas formas ("1 mes", "9m", "6a", "2 años 7 meses") y la comunidad tiene
 * cientos de variantes de escritura.
 *
 * Aqui solo hay funciones puras: reciben filas y devuelven datos limpios. El
 * script que escribe en la base esta en scripts/importarPacientes.js.
 *
 * Regla general: no se inventa nada. Lo que no se puede leer con seguridad se
 * deja fuera y se informa, para que alguien lo corrija a mano.
 */

const { normalizarTexto, similitud } = require('./pacientes.service');

const MS_POR_ANIO = 365.25 * 86400000;

// Filas que son encabezados repetidos dentro de las hojas.
const ENCABEZADOS = new Set(['nombres y apellidos', 'nombre', 'columna3', 'nombres']);

// Las hojas sin fecha por fila se fechan a mitad del periodo que cubren. La de
// 2026 cubre de enero a octubre.
const FECHA_REFERENCIA = {
  2023: '2023-07-01',
  2024: '2024-07-01',
  2025: '2025-07-01',
  2026: '2026-05-15',
};

// --- Utilidades de texto ----------------------------------------------------

/** Distancia de edicion entre dos textos. */
function distancia(a, b) {
  if (a === b) return 0;
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temporal = fila[j];
      fila[j] = Math.min(
        fila[j] + 1,
        fila[j - 1] + 1,
        previo + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previo = temporal;
    }
  }
  return fila[b.length];
}

/** Quita signos sueltos y espacios repetidos, conservando tildes y eñes. */
function limpiar(texto) {
  return String(texto ?? '')
    .replace(/[^\p{L}\d\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// En nombres de persona: "Teresa de Jesús", "Amador de García".
const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);
// En nombres de lugar el articulo es parte del nombre: "Roblarcito La Lima".
const MINUSCULAS_LUGAR = new Set(['de', 'del', 'y']);

/**
 * Pone mayuscula inicial a cada palabra. Las tildes que trae el texto se
 * respetan; las que no trae solo se ponen si el diccionario de acentos las
 * conoce (sale del catalogo oficial, no de memoria).
 */
function enTitulo(texto, acentos = {}, minusculas = MINUSCULAS) {
  return limpiar(texto)
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((palabra, i) => {
      if (i > 0 && minusculas.has(palabra)) return palabra;
      if (/^(i|ii|iii|iv|vi)$/.test(palabra)) return palabra.toUpperCase();
      const conocida = acentos[normalizarTexto(palabra)];
      const base = conocida && normalizarTexto(palabra) === palabra ? conocida.toLowerCase() : palabra;
      return base.charAt(0).toUpperCase() + base.slice(1);
    })
    .join(' ');
}

/** Diccionario palabra-sin-tilde → palabra-con-tilde a partir de textos oficiales. */
function diccionarioAcentos(textos) {
  const salida = {};
  for (const texto of textos) {
    for (const palabra of String(texto ?? '').split(/\s+/)) {
      const clave = normalizarTexto(palabra);
      if (clave && clave !== palabra.toLowerCase()) salida[clave] = palabra;
    }
  }
  return salida;
}

// --- Campos sueltos ---------------------------------------------------------

function esEncabezado(fila) {
  return ENCABEZADOS.has(normalizarTexto(fila.nombre));
}

/**
 * Codigo del expediente en papel: letra del apellido y numero ("M-01").
 * Acepta las variantes de escritura ("R= 483", "M.562", "G-1,047", "0-01" con
 * cero en lugar de O). Devuelve null si no se reconoce.
 */
function normalizarCodigo(valor) {
  let texto = String(valor ?? '').trim().toUpperCase();
  if (!texto) return null;

  // Un cero seguido de separador es una O mal escrita.
  texto = texto.replace(/^0(?=\s*[-_.=\s]\s*\d)/, 'O');

  const coincide = /^([A-ZÑ]{1,2})[^A-ZÑ\d]*([\d,]+)[^\d]*$/u.exec(texto);
  if (!coincide) return null;

  const numero = Number(coincide[2].replace(/,/g, ''));
  if (!Number.isInteger(numero) || numero <= 0) return null;
  return `${coincide[1]}-${numero}`;
}

/** Letra(s) del codigo, para saber con que inicial empieza el apellido. */
function letraDelCodigo(codigo) {
  return codigo ? codigo.split('-')[0] : null;
}

/**
 * Edad escrita a mano → { anios, meses, dias }.
 *
 * Un numero solo son años. Las unidades se reconocen por su inicial: "a",
 * "año", "años" son años; "m", "mes", "meses" (y "mese", "mee") son meses;
 * "d", "dia", "dias" son dias.
 */
function parsearEdad(valor) {
  if (valor === null || valor === undefined || valor === '') return null;

  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0 || valor > 110) return null;
    const anios = Math.floor(valor);
    return { anios, meses: Math.round((valor - anios) * 12), dias: 0 };
  }

  const texto = normalizarTexto(valor);
  const partes = [...texto.matchAll(/(\d+)\s*([a-z]*)/g)];
  if (partes.length === 0) return null;

  const edad = { anios: 0, meses: 0, dias: 0 };
  for (const [, numero, unidad] of partes) {
    const n = Number(numero);
    const inicial = unidad.charAt(0);
    if (inicial === 'm') edad.meses += n;
    else if (inicial === 'd') edad.dias += n;
    // "ños" es "años" con la primera letra comida.
    else if (inicial === 'a' || inicial === 'n' || inicial === '') edad.anios += n;
    else return null;
  }

  if (edad.anios > 110 || edad.meses > 60 || edad.dias > 400) return null;
  return edad;
}

/** "F", "f", "#F", "Femenino" → "F". Lo que no se reconoce queda en null. */
function normalizarSexo(valor) {
  const primera = normalizarTexto(valor).split(' ')[0];
  if (['f', 'femenino', 'mujer'].includes(primera)) return 'F';
  if (['m', 'masculino', 'hombre'].includes(primera)) return 'M';
  return null;
}

const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * Datos que quedaron en la columna equivocada.
 *
 * En algunas filas el sexo se escribio pegado al nombre ("Perez Garcia F",
 * "MendozaF"), la edad dentro del nombre ("de Aldana 41 años") o la comunidad
 * en la columna del sexo. Solo se mueve el dato cuando su columna esta vacia:
 * nunca se sobrescribe lo que si estaba en su lugar.
 */
function repararFila(fila) {
  let nombre = String(fila.nombre ?? '').trim();
  let { sexo, edad, comunidad } = fila;

  if (vacio(edad)) {
    const m = /\s(\d+\s*(?:años|anos|año|ano|a|meses|mes|m|dias|días|d)?)\.?$/iu.exec(nombre);
    if (m) {
      edad = m[1];
      nombre = nombre.slice(0, m.index).trim();
    }
  }

  if (vacio(sexo)) {
    const separado = /\s([FM])$/i.exec(nombre);
    const pegado = /(\p{Ll})([FM])$/u.exec(nombre);
    if (separado) {
      sexo = separado[1].toUpperCase();
      nombre = nombre.slice(0, separado.index).trim();
    } else if (pegado) {
      sexo = pegado[2];
      nombre = nombre.slice(0, -1).trim();
    }
  } else if (vacio(comunidad)) {
    // "f      peña Blanca aldea el limon": el sexo y despues la comunidad.
    const m = /^\s*([FfMm])\s{2,}(.+)$/.exec(String(sexo));
    if (m) {
      sexo = m[1];
      comunidad = m[2];
    }
  }

  return { ...fila, nombre, sexo, edad, comunidad };
}

/** Fecha en que se anoto la fila: la suya, o la de referencia de su hoja. */
function fechaDeLaFila(fila) {
  const referencia = FECHA_REFERENCIA[fila.anio] ?? `${fila.anio}-07-01`;
  // Una fecha fuera del anio de su hoja es un error de dedo ("2052"): se usa
  // la de referencia de la hoja.
  const propia = fila.fecha && Number(fila.fecha.slice(0, 4)) === fila.anio ? fila.fecha : null;
  return new Date(`${propia ?? referencia}T12:00:00Z`);
}

/** Fecha de nacimiento aproximada: la fecha de la fila menos la edad. */
function nacimientoDesdeEdad(edad, referencia) {
  const r = new Date(referencia);
  return new Date(Date.UTC(
    r.getUTCFullYear() - edad.anios,
    r.getUTCMonth() - edad.meses,
    r.getUTCDate() - edad.dias,
  ));
}

// --- Nombres y apellidos ----------------------------------------------------

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'san', 'santa', 'vda']);

/**
 * Parte el nombre en unidades: "VASQUEZ AVALOS DE JERONIMO LIDIA" son cuatro
 * (Vasquez, Avalos, De Jeronimo, Lidia). Las particulas van pegadas a la
 * palabra que les sigue.
 */
function unidadesDelNombre(texto) {
  const palabras = limpiar(texto).split(' ').filter(Boolean);
  const unidades = [];
  let prefijo = [];
  for (const palabra of palabras) {
    if (PARTICULAS.has(normalizarTexto(palabra))) {
      prefijo.push(palabra);
      continue;
    }
    unidades.push({
      texto: [...prefijo, palabra].join(' '),
      clave: normalizarTexto(palabra),
      particula: prefijo.length > 0,
    });
    prefijo = [];
  }
  // Una particula al final ("... DE") se pega a la ultima unidad.
  if (prefijo.length && unidades.length) {
    unidades[unidades.length - 1].texto += ` ${prefijo.join(' ')}`;
  }
  return unidades;
}

function empiezaCon(unidad, letra) {
  // "De León" empieza con D aunque la palabra que lo distingue sea "León".
  return Boolean(letra) && normalizarTexto(unidad.texto).startsWith(normalizarTexto(letra));
}

/**
 * Cuantas veces aparece cada palabra como apellido y como nombre.
 *
 * Se aprende del propio libro: en las filas cuyo codigo empieza con la
 * inicial de la primera palabra y que tienen al menos cuatro, las dos
 * primeras son apellidos y el resto nombres. Asi el sistema sabe que
 * "Ramirez" es apellido y "Lidia" nombre sin una lista hecha de memoria.
 */
function construirLexico(filas) {
  const lexico = new Map();
  const sumar = (clave, campo) => {
    const actual = lexico.get(clave) ?? { apellido: 0, nombre: 0 };
    actual[campo] += 1;
    lexico.set(clave, actual);
  };

  for (const { nombre, codigo } of filas) {
    const letra = letraDelCodigo(codigo);
    const u = unidadesDelNombre(nombre);
    if (!letra || u.length < 4) continue;

    if (empiezaCon(u[0], letra)) {
      u.forEach((x, i) => sumar(x.clave, i < 2 ? 'apellido' : 'nombre'));
    } else if (empiezaCon(u[u.length - 2], letra)) {
      u.forEach((x, i) => sumar(x.clave, i >= u.length - 2 ? 'apellido' : 'nombre'));
    }
  }
  return lexico;
}

/** Probabilidad de que una palabra sea apellido. Sin datos, 0.5. */
function probabilidadApellido(lexico, clave) {
  const x = lexico.get(clave) ?? { apellido: 0, nombre: 0 };
  return (x.apellido + 1) / (x.apellido + x.nombre + 2);
}

/**
 * Separa nombres y apellidos.
 *
 * Primero decide el orden (apellidos primero o al final) con dos pistas: la
 * letra del codigo, que es la inicial del primer apellido, y el lexico. Luego
 * corta: con cuatro o mas palabras, dos son apellidos; con tres, depende de
 * si la del medio parece apellido; con dos, una y una. Un "de Jeronimo" de
 * casada se queda con los apellidos.
 */
function partirNombre(texto, codigo, lexico) {
  const u = unidadesDelNombre(texto);
  const n = u.length;
  if (n < 2) return null;

  const letra = letraDelCodigo(codigo);
  const p = (x) => probabilidadApellido(lexico, x.clave);
  const BONO_LETRA = 0.3;

  let inicio = p(u[0]) + (n >= 4 ? p(u[1]) : 0);
  let fin = p(u[n - 1]) + (n >= 4 ? p(u[n - 2]) : 0);
  if (empiezaCon(u[0], letra)) inicio += BONO_LETRA;
  const indiceLetra = u.findIndex((x, i) => i > 0 && empiezaCon(x, letra) && p(x) >= 0.5);
  if (indiceLetra > 0) fin += BONO_LETRA;

  const apellidosPrimero = inicio >= fin;

  // Cuantas unidades son apellidos.
  let k;
  if (n >= 4) k = 2;
  else if (n === 3) k = p(u[1]) >= 0.5 ? 2 : 1;
  else k = 1;

  // Si la letra del codigo marca donde empiezan los apellidos, manda ella.
  if (!apellidosPrimero && indiceLetra > 0) k = n - indiceLetra;

  let nombres;
  let apellidos;
  if (apellidosPrimero) {
    // El apellido de casada ("de Jeronimo") va despues de los dos apellidos.
    while (k < n - 1 && u[k].particula && normalizarTexto(u[k].texto).startsWith('de ')) k += 1;
    apellidos = u.slice(0, k);
    nombres = u.slice(k);
  } else {
    k = Math.min(k, n - 1);
    nombres = u.slice(0, n - k);
    apellidos = u.slice(n - k);
  }

  const unir = (lista) => lista.map((x) => x.texto).join(' ');
  const apellidosTexto = enTitulo(unir(apellidos));
  return {
    nombres: enTitulo(unir(nombres)),
    // Un apellido que empieza con particula la lleva en mayuscula: "De León".
    apellidos: apellidosTexto.charAt(0).toUpperCase() + apellidosTexto.slice(1),
  };
}

// --- Comunidades --------------------------------------------------------------

const PREFIJOS_COMUNIDAD = /^(aldea|ald|caserio|cas|canton|sector|comunidad)\s+/;
const ARTICULOS = new Set(['el', 'la', 'los', 'las', 'de', 'del']);
const SIN_PESO = new Set(['barrio', 'camotan']);

/** Texto de la comunidad listo para mostrar, sin abreviaturas. */
function textoComunidad(valor) {
  let texto = limpiar(String(valor ?? '').replace(/\./g, ' '));
  if (!texto || normalizarTexto(texto) === 'none') return null;
  texto = texto
    .replace(/^(bo|b)\s+/i, 'Barrio ')
    .replace(/^(col)\s+/i, 'Colonia ')
    .replace(/^(aldea|ald|caser[ií]o|cas)\s+/i, '');
  return texto || null;
}

/** Clave para reconocer variantes: sin tildes, articulos ni orden. */
function claveComunidad(valor) {
  const texto = textoComunidad(valor);
  if (!texto) return null;
  const palabras = normalizarTexto(texto)
    .replace(PREFIJOS_COMUNIDAD, '')
    .split(' ')
    .filter((p) => p && !ARTICULOS.has(p));
  // "Barrio La Barrera Camotán", "Barrio Barrera" y "La Barrera" son el mismo
  // barrio: el centro esta en Camotán, asi que nombrar el municipio o la
  // palabra "barrio" no distingue un lugar de otro. Otro municipio si
  // distingue ("Tierra Blanca Jocotán"), y "Camotán" solo es el pueblo.
  const distintivas = palabras.filter((p) => !SIN_PESO.has(p));
  return (distintivas.length ? distintivas : palabras).sort().join(' ');
}

/** Dos claves son la misma comunidad mal escrita. */
function mismaComunidad(a, b) {
  if (a === b) return true;
  const largo = Math.min(a.length, b.length);
  if (largo < 5) return false;
  const tolerancia = largo >= 10 ? 2 : 1;
  return distancia(a, b) <= tolerancia;
}

function categoriaComunidad(nombre) {
  const n = normalizarTexto(nombre);
  if (n.startsWith('barrio ')) return 'barrio';
  if (n.startsWith('colonia ')) return 'colonia';
  return 'otro';
}

/**
 * Agrupa las formas de escribir cada comunidad y elige un nombre por grupo.
 *
 * Las variantes con la misma clave son la misma comunidad. Despues, cada
 * grupo pequeño se une al grupo mas grande que solo se diferencia por una
 * letra (o dos, en nombres largos): "GAYABO" es "GUAYABO". El nombre elegido
 * es la forma mas usada, con las tildes del catalogo oficial cuando las hay.
 *
 * Devuelve { comunidades, comunidadDe } donde comunidadDe(texto) da el nombre
 * final de cualquier variante.
 */
function agruparComunidades(textos, acentos = {}, oficiales = []) {
  // Si una variante coincide con un nombre del catalogo oficial, se usa la
  // ortografia oficial ("Sesemilito", no "Sesesmilito").
  const estricta = (t) => normalizarTexto(textoComunidad(t) ?? '')
    .split(' ').filter((p) => p && !ARTICULOS.has(p)).join(' ');
  const oficial = oficiales.map((nombre) => ({ nombre, clave: estricta(nombre) })).filter((o) => o.clave);

  const grupos = new Map();
  for (const original of textos) {
    const clave = claveComunidad(original);
    if (!clave) continue;
    const g = grupos.get(clave) ?? { clave, total: 0, formas: new Map() };
    g.total += 1;
    const forma = textoComunidad(original);
    g.formas.set(forma, (g.formas.get(forma) ?? 0) + 1);
    grupos.set(clave, g);
  }

  const ordenados = [...grupos.values()].sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave));
  const destino = new Map();
  const finales = [];
  for (const g of ordenados) {
    const mayor = finales.find((f) => mismaComunidad(f.clave, g.clave));
    if (mayor) {
      mayor.total += g.total;
      for (const [forma, n] of g.formas) mayor.formas.set(forma, (mayor.formas.get(forma) ?? 0) + n);
      mayor.claves.push(g.clave);
      destino.set(g.clave, mayor);
    } else {
      const nuevo = { ...g, formas: new Map(g.formas), claves: [g.clave] };
      finales.push(nuevo);
      destino.set(g.clave, nuevo);
    }
  }

  const porNombre = new Map();
  for (const f of finales) {
    const [masUsada] = [...f.formas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // La ortografia oficial solo corrige letras: la forma mas usada tiene que
    // ser casi igual a un nombre del catalogo, no solo compartir una palabra.
    const clave = estricta(masUsada[0]);
    const deCatalogo = (oficial.find((o) => o.clave === clave)
      ?? oficial.find((o) => Math.min(o.clave.length, clave.length) >= 6 && distancia(o.clave, clave) === 1))?.nombre;
    const nombre = enTitulo(deCatalogo ?? masUsada[0], acentos, MINUSCULAS_LUGAR);
    f.nombre = nombre;
    f.categoria = categoriaComunidad(masUsada[0].replace(/^(bo|b)\s+/i, 'Barrio '));
    f.variantes = [...f.formas.keys()];

    // Dos grupos que terminan con el mismo nombre son el mismo lugar.
    const previo = porNombre.get(normalizarTexto(nombre));
    if (previo) {
      previo.total += f.total;
      previo.variantes.push(...f.variantes);
      f.fusionado = true;
    } else {
      porNombre.set(normalizarTexto(nombre), f);
    }
  }

  return {
    comunidades: finales
      .filter((f) => !f.fusionado)
      .map(({ nombre, categoria, total, variantes }) => ({ nombre, categoria, total, variantes })),
    comunidadDe(texto) {
      const clave = claveComunidad(texto);
      return clave ? destino.get(clave)?.nombre ?? null : null;
    },
  };
}

// --- Codigos que no identifican a nadie ---------------------------------------

/**
 * Codigos copiados por error en muchas filas (en 2024 hay 152 filas con
 * "L-130"). Un expediente familiar puede tener varias personas, pero no
 * decenas: a partir de cierto numero de nombres distintos, el codigo no sirve.
 */
function codigosInvalidos(filas, limite = 12) {
  const nombres = new Map();
  for (const { codigo, nombre } of filas) {
    if (!codigo) continue;
    const conjunto = nombres.get(codigo) ?? new Set();
    conjunto.add(claveNombre(nombre));
    nombres.set(codigo, conjunto);
  }
  return new Set([...nombres].filter(([, c]) => c.size > limite).map(([codigo]) => codigo));
}

// --- La misma persona en varios años ------------------------------------------

/** Clave de nombre que no depende del orden ni de las tildes. */
function claveNombre(texto) {
  return normalizarTexto(texto)
    .split(' ')
    .filter((p) => p && !PARTICULAS.has(p))
    .sort()
    .join(' ');
}

const TOLERANCIA_NACIMIENTO = 2.5 * MS_POR_ANIO;

function compatibles(persona, registro) {
  if (persona.sexo && registro.sexo && persona.sexo !== registro.sexo) return false;
  if (persona.nacimiento && registro.nacimiento
    && Math.abs(persona.nacimiento - registro.nacimiento) > TOLERANCIA_NACIMIENTO) return false;
  // Dos codigos validos distintos son dos expedientes, salvo que vivan en la
  // misma comunidad (el codigo pudo cambiar de un anio a otro).
  if (persona.codigos.size && registro.codigo && !persona.codigos.has(registro.codigo)
    && persona.comunidad !== registro.comunidad) return false;
  return true;
}

/**
 * Junta los registros que son la misma persona.
 *
 * Mismo nombre (sin importar el orden ni las tildes) y edad compatible, o
 * mismo codigo con un nombre casi igual ("Liam Elier" y "Liam Eviel").
 * Cada registro trae { nombre, sexo, nacimiento, codigo, comunidad, fecha }.
 */
function agruparPersonas(registros) {
  const personas = [];
  const porNombre = new Map();
  const porCodigo = new Map();

  const ordenados = [...registros].sort((a, b) => a.fecha - b.fecha);
  for (const r of ordenados) {
    const clave = claveNombre(r.nombre);
    let persona = (porNombre.get(clave) ?? []).find((p) => compatibles(p, r));

    if (!persona && r.codigo) {
      persona = (porCodigo.get(r.codigo) ?? []).find(
        (p) => similitud(p.clave, clave) >= 0.6 && compatibles(p, r),
      );
    }

    if (!persona) {
      persona = { clave, registros: [], codigos: new Set(), sexo: null, nacimiento: null, comunidad: null };
      personas.push(persona);
      porNombre.set(clave, [...(porNombre.get(clave) ?? []), persona]);
    }

    persona.registros.push(r);
    if (r.codigo && !persona.codigos.has(r.codigo)) {
      persona.codigos.add(r.codigo);
      porCodigo.set(r.codigo, [...(porCodigo.get(r.codigo) ?? []), persona]);
    }
    persona.sexo = persona.sexo ?? r.sexo;
    if (r.nacimiento) persona.nacimiento = r.nacimiento;
    if (r.comunidad) persona.comunidad = r.comunidad;
  }

  return personas.map(consolidar);
}

function masFrecuente(valores) {
  const cuenta = new Map();
  valores.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const x = cuenta.get(v) ?? { n: 0, ultimo: i };
    x.n += 1;
    x.ultimo = i;
    cuenta.set(v, x);
  });
  // A igual frecuencia gana el mas reciente.
  return [...cuenta.entries()].sort((a, b) => b[1].n - a[1].n || b[1].ultimo - a[1].ultimo)[0]?.[0] ?? null;
}

/**
 * Un solo paciente a partir de sus registros. La fecha de nacimiento sale del
 * registro mas reciente que tenga edad: es la anotacion mas cercana a hoy.
 */
function consolidar(persona) {
  const regs = persona.registros; // ya vienen del mas antiguo al mas reciente
  const conEdad = regs.filter((r) => r.nacimiento);
  const nombre = masFrecuente(regs.map((r) => `${r.nombres}|${r.apellidos}`));
  const [nombres, apellidos] = nombre.split('|');

  return {
    nombres,
    apellidos,
    sexo: masFrecuente(regs.map((r) => r.sexo)),
    fechaNacimiento: conEdad.length ? conEdad[conEdad.length - 1].nacimiento : null,
    codigo: masFrecuente(regs.map((r) => r.codigo)),
    comunidad: [...regs].reverse().find((r) => r.comunidad)?.comunidad ?? null,
    primeraVez: regs[0].fecha,
    registros: regs.length,
    origen: regs.map((r) => `${r.hoja} fila ${r.fila}`),
  };
}

module.exports = {
  FECHA_REFERENCIA,
  distancia,
  limpiar,
  enTitulo,
  diccionarioAcentos,
  esEncabezado,
  repararFila,
  normalizarCodigo,
  letraDelCodigo,
  parsearEdad,
  normalizarSexo,
  fechaDeLaFila,
  nacimientoDesdeEdad,
  unidadesDelNombre,
  construirLexico,
  probabilidadApellido,
  partirNombre,
  textoComunidad,
  claveComunidad,
  mismaComunidad,
  categoriaComunidad,
  agruparComunidades,
  codigosInvalidos,
  claveNombre,
  agruparPersonas,
};
