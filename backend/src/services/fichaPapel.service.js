// Número de la ficha de papel.
//
// En el centro la ficha lleva la inicial del primer apellido y el número que
// sigue al último de esa letra: Juan Pérez P-569, Joaquín Pérez P-570. A
// veces una familia comparte el número, por eso no es único.
//
// En lo ya registrado hay números sueltos muy por encima del resto (P-3198
// cuando la serie va por P-610): son errores de escritura del papel. Si se
// tomara el mayor, la serie saltaría; por eso se ignora un número que queda
// separado de los demás por más de SALTO_MAXIMO.

const prisma = require('../config/db');
const { sinTildes } = require('./busquedaPacientes.service');

const SALTO_MAXIMO = 20;
const FORMATO = /^([A-Z])-(\d+)$/;
// Partículas que no son el apellido: «de León» va con la L.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

/** La letra de la ficha: inicial del primer apellido, sin tilde (Ñ va con N). */
function letraDe(apellidos) {
  const palabras = sinTildes(apellidos).split(/\s+/).filter(Boolean);
  const apellido = palabras.find((p) => !PARTICULAS.has(p)) ?? palabras[0] ?? '';
  const letra = apellido.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(letra) ? letra : null;
}

/**
 * El último número de la serie, saltando los sueltos de arriba.
 * [610, 609, 946, 3198] → 610.
 */
function ultimoDeLaSerie(numeros) {
  const orden = [...new Set(numeros)].sort((a, b) => b - a);
  for (let i = 0; i < orden.length; i += 1) {
    const siguiente = orden[i + 1];
    if (siguiente === undefined || orden[i] - siguiente <= SALTO_MAXIMO) return orden[i];
  }
  return null;
}

const separar = (ficha) => {
  const m = FORMATO.exec(String(ficha ?? '').trim().toUpperCase());
  return m ? { letra: m[1], numero: Number(m[2]) } : null;
};

/** La ficha que le toca a alguien con estos apellidos, y de quién es la última. */
async function siguienteFicha(establecimientoId, apellidos) {
  const letra = letraDe(apellidos);
  if (!letra) return null;
  const filas = await prisma.paciente.findMany({
    where: { establecimientoId, expedientePapel: { startsWith: `${letra}-` } },
    select: { id: true, nombres: true, apellidos: true, expedientePapel: true },
  });
  const conNumero = filas.map((f) => ({ ...f, ...separar(f.expedientePapel) })).filter((f) => f.letra === letra);
  const ultimo = ultimoDeLaSerie(conNumero.map((f) => f.numero));
  const de = conNumero.find((f) => f.numero === ultimo);
  return {
    letra,
    ficha: `${letra}-${(ultimo ?? 0) + 1}`,
    ultima: de ? { ficha: de.expedientePapel, nombre: `${de.nombres} ${de.apellidos}` } : null,
  };
}

/** Quiénes ya tienen esa ficha (una familia puede compartirla). */
async function duenosDeFicha(establecimientoId, ficha, idExcluido = null) {
  const texto = String(ficha ?? '').trim();
  if (!texto) return [];
  return prisma.paciente.findMany({
    where: {
      establecimientoId,
      activo: true,
      expedientePapel: { equals: texto, mode: 'insensitive' },
      ...(idExcluido ? { NOT: { id: idExcluido } } : {}),
    },
    select: { id: true, nombres: true, apellidos: true, fechaNacimiento: true },
    take: 10,
  });
}

/**
 * Nombres o apellidos parecidos a lo que se está escribiendo, de los ya
 * registrados: «Jaun» → Juan, Juana. Los más usados primero.
 */
async function sugerirPalabras(establecimientoId, campo, texto) {
  const palabra = sinTildes(texto).split(/\s+/).pop();
  if (!palabra || palabra.length < 2) return [];
  const columna = campo === 'apellidos' ? 'apellidos' : 'nombres';
  // Letras de diferencia: dos al revés cuentan como una («jaun» → juan).
  // Empezar igual cuenta como 1, para que «Juan», que es muy usado, gane a
  // «Jaunni», que lo tiene una sola persona.
  const ordenada = [...palabra].sort().join('');
  const filas = await prisma.$queryRawUnsafe(
    `SELECT palabra, veces, distancia FROM (
       SELECT palabra, COUNT(*)::int AS veces,
              CASE
                WHEN sin_tildes(palabra) = $2 THEN 0
                WHEN sin_tildes(palabra) LIKE $2 || '%' THEN 1
                WHEN length(palabra) = length($2)
                     AND (SELECT string_agg(c, '' ORDER BY c) FROM regexp_split_to_table(sin_tildes(palabra), '') c) = $3 THEN 1
                ELSE levenshtein(sin_tildes(palabra), $2)
              END AS distancia
         FROM (SELECT initcap(lower(unnest(string_to_array(trim(${columna}), ' ')))) AS palabra
                 FROM paciente WHERE establecimiento_id = $1 AND activo) x
        WHERE length(palabra) > 1
        GROUP BY palabra) y
      WHERE distancia <= $4
      ORDER BY distancia, veces DESC
      LIMIT 15`,
    establecimientoId,
    palabra,
    ordenada,
    palabra.length <= 3 ? 1 : 2,
  );
  // Si lo escrito ya está registrado así, solo se sugiere lo que es mucho más
  // común (alguien escribió «Peres» una vez; «Pérez» lo tienen cientos).
  const exacta = filas.find((f) => f.distancia === 0);
  const vistas = new Set([palabra]);
  return filas
    .filter((f) => f.distancia > 0 && (!exacta || f.veces >= exacta.veces * 5))
    .filter((f) => {
      // Agustin y Agustín son la misma: se queda la más usada (ya va primero).
      const clave = sinTildes(f.palabra);
      if (vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    })
    .slice(0, 5)
    .map((f) => f.palabra);
}

module.exports = { SALTO_MAXIMO, letraDe, ultimoDeLaSerie, siguienteFicha, duenosDeFicha, sugerirPalabras };
