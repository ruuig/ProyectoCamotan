// Funciones puras de apoyo al modulo de pacientes.
// Sin acceso a base de datos: reciben datos y devuelven datos.

// Quita tildes, signos y espacios repetidos para poder comparar nombres
// escritos de formas distintas ("Jose Ramirez" vs "JOSE  RAMÍREZ").
function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Tras la descomposicion NFD la ñ ya quedo como n: "Munoz" y "Muñoz"
    // se comparan como el mismo nombre, que es lo que se busca.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Trigramas al estilo de pg_trgm: el texto se rellena en los extremos para que
// el inicio y el fin de la cadena tambien pesen en la comparacion.
function trigramas(texto) {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return new Set();

  const relleno = `  ${normalizado} `;
  const conjunto = new Set();
  for (let i = 0; i <= relleno.length - 3; i += 1) {
    conjunto.add(relleno.slice(i, i + 3));
  }
  return conjunto;
}

// Indice de Jaccard sobre trigramas. Devuelve entre 0 y 1.
function similitud(a, b) {
  const ta = trigramas(a);
  const tb = trigramas(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let comunes = 0;
  for (const tri of ta) {
    if (tb.has(tri)) comunes += 1;
  }

  return comunes / (ta.size + tb.size - comunes);
}

function nombreCompleto(persona) {
  return `${persona?.apellidos ?? ''} ${persona?.nombres ?? ''}`.trim();
}

function mismaFecha(a, b) {
  if (!a || !b) return false;
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

// A partir de este puntaje se le advierte al usuario. Por debajo, el parecido
// es demasiado debil y la advertencia seria ruido.
const UMBRAL_DUPLICADO = 0.55;

// Compara un paciente por registrar contra los candidatos ya existentes.
// No decide nada: solo ordena y explica, la persona confirma si es la misma.
function detectarDuplicados(candidatos, datosNuevos, umbral = UMBRAL_DUPLICADO) {
  const nombreNuevo = nombreCompleto(datosNuevos);

  return candidatos
    .map((candidato) => {
      const razones = [];
      let puntaje = similitud(nombreNuevo, nombreCompleto(candidato));

      if (puntaje > 0) razones.push('nombre similar');

      // El CUI es identificador nacional: si coincide es la misma persona,
      // sin importar como este escrito el nombre.
      if (datosNuevos.cui && candidato.cui && datosNuevos.cui === candidato.cui) {
        puntaje = 1;
        razones.length = 0;
        razones.push('mismo CUI');
      } else {
        if (mismaFecha(datosNuevos.fechaNacimiento, candidato.fechaNacimiento)) {
          puntaje += 0.2;
          razones.push('misma fecha de nacimiento');
        }
        if (
          datosNuevos.comunidad &&
          normalizarTexto(datosNuevos.comunidad) === normalizarTexto(candidato.comunidad)
        ) {
          puntaje += 0.1;
          razones.push('misma comunidad');
        }
      }

      return { paciente: candidato, puntaje: Math.min(1, Number(puntaje.toFixed(3))), razones };
    })
    .filter((resultado) => resultado.puntaje >= umbral)
    .sort((a, b) => b.puntaje - a.puntaje);
}

// Extrae las palabras utiles del nombre para poder buscar candidatos en la
// base sin traer toda la tabla. Descarta particulas que no discriminan.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'san', 'santa']);

function tokensDeBusqueda(texto, minimo = 3) {
  return normalizarTexto(texto)
    .split(' ')
    .filter((palabra) => palabra.length >= minimo && !PARTICULAS.has(palabra));
}

// Edad exacta a la fecha indicada. edadMeses es la que usan los patrones OMS
// y las reglas de rangos por edad.
function calcularEdad(fechaNacimiento, ahora = new Date()) {
  const nacimiento = new Date(fechaNacimiento);
  const referencia = new Date(ahora);

  let anios = referencia.getFullYear() - nacimiento.getFullYear();
  let meses = referencia.getMonth() - nacimiento.getMonth();
  let dias = referencia.getDate() - nacimiento.getDate();

  if (dias < 0) {
    meses -= 1;
    // Dias del mes anterior al de referencia.
    dias += new Date(referencia.getFullYear(), referencia.getMonth(), 0).getDate();
  }
  if (meses < 0) {
    anios -= 1;
    meses += 12;
  }

  return { anios, meses, dias, edadMeses: anios * 12 + meses };
}

module.exports = {
  UMBRAL_DUPLICADO,
  normalizarTexto,
  trigramas,
  similitud,
  nombreCompleto,
  detectarDuplicados,
  tokensDeBusqueda,
  calcularEdad,
};
