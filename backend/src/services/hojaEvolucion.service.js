/**
 * Hoja de evolucion del medico y datos del SIGSA 3CS de cada visita.
 *
 * El medico no llena la ficha: llena lo que hoy escribe en papel en cada
 * visita (MC, HE, EF, IC, Tx) y los datos que pide el SIGSA 3CS, con los
 * codigos del formulario (MD/01-pacientes.md seccion 3).
 *
 * Funciones puras.
 */

const { normalizarTexto } = require('./pacientes.service');
const { partirLinea } = require('./csvLugares.service');

// --- Catalogos del SIGSA 3CS de la visita -------------------------------------

const TIPO_CONSULTA = [
  { valor: 1, etiqueta: 'Primera consulta' },
  { valor: 2, etiqueta: 'Reconsulta' },
  { valor: 3, etiqueta: 'Interconsulta' },
  { valor: 4, etiqueta: 'Emergencia' },
];

const CONTROL = [
  { valor: 0, etiqueta: 'No aplica' },
  { valor: 1, etiqueta: 'Prenatal' },
  { valor: 2, etiqueta: 'Puerperio' },
  { valor: 3, etiqueta: 'Planificación familiar' },
  { valor: 4, etiqueta: 'Profilaxia sexual' },
  { valor: 5, etiqueta: 'Papanicolaou' },
  { valor: 6, etiqueta: 'IVAA' },
];

const REFERENCIA_VIENE = [
  { valor: 0, etiqueta: 'No aplica' },
  { valor: 1, etiqueta: 'Viene referido' },
  { valor: 2, etiqueta: 'Viene contrarreferido' },
];

const REFERENCIA_FUE = [
  { valor: 0, etiqueta: 'No aplica' },
  { valor: 1, etiqueta: 'Fue referido' },
  { valor: 2, etiqueta: 'Fue contrarreferido' },
];

// [Sensible]: el lugar donde se notifico un caso de violencia.
const LUGAR_NOTIFICACION = [
  { valor: 0, etiqueta: 'No aplica' },
  { valor: 1, etiqueta: 'MP' },
  { valor: 2, etiqueta: 'PGN' },
  { valor: 3, etiqueta: 'PNC' },
];

const CATALOGOS_3CS = {
  tipoConsulta: TIPO_CONSULTA,
  controlSigsa: CONTROL,
  referenciaViene: REFERENCIA_VIENE,
  referenciaFue: REFERENCIA_FUE,
  lugarNotificacion: LUGAR_NOTIFICACION,
};

// --- Diagnosticos -------------------------------------------------------------

/** Categoria CIE-10 (las tres primeras posiciones): J06.9 → J06. */
function categoriaCie(codigo) {
  return codigo ? String(codigo).trim().toUpperCase().slice(0, 3) : null;
}

/**
 * Dos diagnosticos son "el mismo" para el tipo de consulta si comparten
 * categoria CIE-10, o, sin codigo, si se escribieron igual.
 */
function mismoDiagnostico(a, b) {
  if (a.cie && b.cie) return categoriaCie(a.cie) === categoriaCie(b.cie);
  return Boolean(a.descripcion) && normalizarTexto(a.descripcion) === normalizarTexto(b.descripcion);
}

/**
 * Tipo de consulta sugerido segun el historial del mismo diagnostico.
 *
 * Primera consulta si el paciente no tuvo ese diagnostico en el anio en
 * curso; reconsulta si ya lo tuvo. El SIGSA cuenta por anio, por eso el corte
 * es el 1 de enero. Interconsulta y emergencia no se pueden deducir: las
 * marca el medico.
 *
 * previos: [{ cie, descripcion, fecha }] de consultas cerradas del paciente.
 */
function sugerirTipoConsulta(diagnostico, previos, fecha = new Date()) {
  if (!diagnostico || (!diagnostico.cie && !diagnostico.descripcion)) {
    return { valor: 1, razon: 'Sin diagnóstico todavía: se sugiere primera consulta' };
  }
  const anio = new Date(fecha).getFullYear();
  const anterior = previos
    .filter((p) => new Date(p.fecha).getFullYear() === anio && new Date(p.fecha) < new Date(fecha))
    .find((p) => mismoDiagnostico(diagnostico, p));
  if (anterior) {
    return {
      valor: 2,
      razon: `Ya consultó por ${anterior.cie ? categoriaCie(anterior.cie) : 'lo mismo'} este año (${new Date(anterior.fecha).toLocaleDateString('es-GT')})`,
    };
  }
  return { valor: 1, razon: 'No consultó por este diagnóstico en lo que va del año' };
}

/**
 * Diagnosticos de la consulta a partir de lo que llega. Acepta la forma
 * nueva (filas repetibles) o la anterior (un solo diagnostico), para no
 * romper lo que ya se registraba asi.
 */
function diagnosticosDe({ diagnosticos, diagnosticoTxt, diagnosticoCie }) {
  if (Array.isArray(diagnosticos) && diagnosticos.length > 0) {
    return diagnosticos.map((d) => ({ descripcion: d.descripcion, cie: d.cie || null }));
  }
  if (diagnosticoTxt) return [{ descripcion: diagnosticoTxt, cie: diagnosticoCie || null }];
  return [];
}

// --- Catalogo CIE-10 -------------------------------------------------------------

const CIE10 = /^[A-TV-Z][0-9]{2}(\.[0-9]{1,2})?$/;

/**
 * CSV del catalogo CIE-10: codigo, descripcion y, opcional, sinonimos
 * separados por "|" ("catarro|resfriado"). Acepta coma o punto y coma.
 */
function parsearCsvCie10(texto) {
  const lineas = String(texto ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const filas = [];
  const errores = [];
  const vistos = new Set();

  lineas.forEach((linea, i) => {
    if (!linea.trim()) return;
    const [codigoCrudo, descripcion, sinonimos] = partirLinea(linea);
    const codigo = String(codigoCrudo ?? '').trim().toUpperCase();
    // Encabezado opcional.
    if (i === 0 && normalizarTexto(codigo) === 'codigo') return;
    if (!CIE10.test(codigo)) {
      errores.push({ linea: i + 1, mensaje: `Código CIE-10 inválido: "${codigoCrudo}"` });
      return;
    }
    if (!descripcion) {
      errores.push({ linea: i + 1, mensaje: `Falta la descripción de ${codigo}` });
      return;
    }
    if (vistos.has(codigo)) {
      errores.push({ linea: i + 1, mensaje: `Código repetido: ${codigo}` });
      return;
    }
    vistos.add(codigo);
    filas.push({ codigo, descripcion: descripcion.slice(0, 300), sinonimos: sinonimos || null });
  });

  return { filas, errores };
}

/**
 * Ordena las opciones del buscador: primero las que empiezan con lo escrito,
 * luego las que lo contienen; dentro, las mas usadas en el centro.
 */
function ordenarResultados(opciones, consulta) {
  const q = normalizarTexto(consulta);
  const puntaje = (o) => {
    const textos = [o.codigo, o.descripcion, o.sinonimos].filter(Boolean).map(normalizarTexto);
    if (textos.some((t) => t.startsWith(q))) return 0;
    if (textos.some((t) => t.split(' ').some((p) => p.startsWith(q)))) return 1;
    return 2;
  };
  return [...opciones].sort((a, b) => puntaje(a) - puntaje(b) || (b.usos ?? 0) - (a.usos ?? 0));
}

module.exports = {
  TIPO_CONSULTA,
  CONTROL,
  REFERENCIA_VIENE,
  REFERENCIA_FUE,
  LUGAR_NOTIFICACION,
  CATALOGOS_3CS,
  CIE10,
  categoriaCie,
  mismoDiagnostico,
  sugerirTipoConsulta,
  diagnosticosDe,
  parsearCsvCie10,
  ordenarResultados,
};
