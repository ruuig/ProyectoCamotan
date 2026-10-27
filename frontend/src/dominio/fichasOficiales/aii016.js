/**
 * Ficha clínica para adolescente y joven (AII_016), sobre el formulario
 * oficial. Cada dato va en su casilla: x, y en puntos desde la esquina
 * superior izquierda de la página (oficio, 612 × 936), tomados del PDF.
 *
 * t: texto · m: círculo marcado · x: equis junto a una etiqueta · area: texto de varias líneas.
 */
import { t, m, x, area, digitos, fechaPartes, fechaTexto, sec, cajas, cifras } from './piezas';

// Sí/No en dos círculos: el de la izquierda es Sí.
const par = (cxSi, cy, valor, separacion = 12.6) => [
  m(cxSi, cy, (d) => valor(d) === true),
  m(cxSi + separacion, cy, (d) => valor(d) === false),
];

const MEDICOS_IZQ = [['anemia', 663.4], ['alergias', 675.7], ['asma', 687.1], ['its', 699.1], ['itu', 711.2], ['violencia', 723.9], ['crecimiento', 735.3], ['nutricionales', 747.8], ['diabetes', 760.1], ['tb', 771.8]];
const MEDICOS_DER = [['trastornosAlimentarios', 663.4], ['hipertension', 675.7], ['medicamentos', 687.1], ['discapacidad', 699.1], ['intoxicaciones', 711.2], ['accidentes', 723.9], ['traumas', 735.3], ['cirugias', 747.8], ['hospitalizaciones', 760.1]];
const FAMILIARES_IZQ = [['diabetes', 806.0], ['hipertension', 816.6], ['cancer', 829.1], ['transmisibles', 841.1], ['its', 852.4], ['tb', 863.1]];
const FAMILIARES_DER = [['violencia', 806.0], ['psicologicos', 816.6], ['judiciales', 829.1], ['sustancias', 841.1], ['padreAusente', 852.4]];
const RIESGO = [['individuales', 834.6], ['familia', 848.4], ['amigos', 861.6], ['escuela', 874.6], ['comunidad', 887.3]];

const CATEGORIAS = [['CCS', 342.2], ['PS', 389.3], ['CS', 436.3], ['CAP', 482.8], ['CAIMI', 528.8]];
const categoria = (e) => {
  const tipo = String(e?.tipo ?? 'CS').toUpperCase();
  return CATEGORIAS.find(([c]) => tipo === c)?.[0] ?? (tipo.includes('CENTRO') ? 'CS' : 'OTRO');
};

const pers = (d) => sec(d, 'personales_adolescente');
const med = (d) => sec(d, 'medicos_adolescente');
const psi = (d) => sec(d, 'psicosociales_adolescente');
const est = (d) => sec(d, 'estilos_vida_adolescente');
const fam = (d) => sec(d, 'familiares_adolescente');
const vac = (d) => sec(d, 'vacunacion_adolescente');
const rie = (d) => sec(d, 'factores_riesgo_adolescente');
const pub = (d) => sec(d, 'desarrollo_puberal_adolescente');
const detalle = (s, k) => (d) => (s(d)[k] === true ? s(d)[`${k}Detalle`] ?? '' : '');

const pagina1 = [
  // Encabezado
  ...fechaPartes(28, 142, (d) => d.registradaEn, [0, 20.5, 40], true),
  t(101, 144, (d) => d.hora.slice(0, 2), { s: 8 }),
  t(124, 144, (d) => d.hora.slice(3, 5), { s: 8 }),
  t(445, 145, (d) => d.expediente, { w: 150, s: 11, negrita: true }),

  // Datos del establecimiento
  t(118, 176.5, (d, e) => e?.nombre ?? '', { w: 185 }),
  t(359, 176.5, (d, e) => e?.areaSalud ?? '', { w: 235 }),
  t(84, 194.8, (d, e) => e?.distritoSalud ?? e?.municipio ?? '', { w: 220 }),
  ...CATEGORIAS.map(([c, cx]) => m(cx, 210, (d, e) => categoria(e) === c)),
  m(575.1, 210, (d, e) => categoria(e) === 'OTRO'),

  // Identificación
  t(56, 234.7, (d) => d.id.nombres, { w: 250 }),
  t(346, 234.7, (d) => d.id.apellidos, { w: 250 }),
  t(120, 253, (d) => d.id.departamentoNacimiento, { w: 185 }),
  t(392, 253, (d) => d.id.municipioNacimiento, { w: 200 }),
  t(56, 272, (d) => d.id.domicilio, { w: 250 }),
  t(361, 272, (d) => d.id.departamentoResidencia, { w: 230 }),
  t(56, 289.3, (d) => d.id.municipioResidencia, { w: 250 }),
  t(350, 307, (d) => d.id.lugarPobladoId, { w: 245 }),
  ...fechaPartes(27, 343, (d) => d.paciente.fechaNacimiento, [0, 21, 40]),
  t(103, 343, (d) => (d.edad ? String(d.edad.anios) : ''), { s: 8 }),
  t(125, 343, (d) => (d.edad ? String(d.edad.meses) : ''), { s: 8 }),
  ...digitos(20.4, 371.5, 10.1, 13, (d) => d.paciente.cui),
  m(167.1, 354.8, (d) => d.paciente.sexo === 'F'),
  m(166.6, 379.1, (d) => d.paciente.sexo === 'M'),
  ...par(249.9, 347.6, (d) => d.paciente.estudiaActualmente),
  t(242, 355, (d) => d.id.ultimoGradoAprobado, { w: 46, s: 6 }),
  t(242, 379, (d) => d.id.motivoNoEstudia, { w: 46, s: 6 }),
  m(292.7, 342.4, (d) => d.paciente.pueblo === '2'),
  m(292.7, 352.1, (d) => d.paciente.pueblo === '3'),
  m(292.7, 361.9, (d) => d.paciente.pueblo === '4'),
  m(292.7, 371.6, (d) => d.paciente.pueblo === '1'),
  m(301.1, 381.3, (d) => d.paciente.pueblo === '5'),
  t(330, 352, (d) => (d.paciente.comunidadLinguistica ? `Cod ${d.paciente.comunidadLinguistica}` : ''), { w: 36, s: 8 }),
  ...par(385.5, 353.3, (d) => d.paciente.migrante, 17.3),
  t(381, 371.5, (d) => d.paciente.origenMigracion ?? '', { w: 34, s: 6 }),
  t(424, 337, (d) => d.id.telefono, { w: 90 }),
  ...par(565.8, 336.1, (d) => (d.paciente.redesSociales === 'si' ? true : d.paciente.redesSociales === 'no' ? false : null), 17.3),
  t(424, 367.5, (d) => d.id.religion, { w: 170 }),
  ...par(68.8, 406.4, (d) => d.paciente.trabaja),
  t(51, 416.5, (d) => d.paciente.trabajoEspecifique ?? '', { w: 80, s: 6.5 }),
  t(137, 405, (d) => d.id.profesionOficio, { w: 122, s: 7 }),
  x(247.5, 407, (d) => d.paciente.estadoCivil === 'soltero'),
  x(246.5, 413.9, (d) => d.paciente.estadoCivil === 'casado'),
  x(250.3, 420.7, (d) => d.paciente.estadoCivil === 'viudo'),
  x(257.3, 427.5, (d) => !['soltero', 'casado', 'viudo', null, undefined].includes(d.paciente.estadoCivil)),
  t(274, 431, (d) => (['soltero', 'casado', 'viudo', null, undefined].includes(d.paciente.estadoCivil) ? '' : d.id.estadoCivil), { w: 48, s: 6 }),
  t(328, 403.5, (d) => d.id.responsableNombre, { w: 170 }),
  t(368, 415.5, (d) => d.id.responsableParentesco, { w: 130 }),
  t(503, 403.5, (d) => d.id.celular, { w: 90 }),

  // Signos de peligro, motivo y referencia
  area(22, 459, 182, 118, (d) => d.signosPeligro.map((s) => `• ${s}`).join('\n'), { s: 7 }),
  area(212, 469, 384, 50, (d) => d.atencion.motivoConsulta, { s: 7.5, renglon: 11.5 }),
  ...par(219.3, 542.8, (d) => (d.atencion.referenciaViene == null ? null : d.atencion.referenciaViene > 0)),
  t(300, 521.5, (d) => d.atencion.referidoA, { w: 292 }),
  area(22, 568, 574, 56, (d) => d.atencion.historiaEnfermedad, { s: 7.5 }),

  // Antecedentes personales
  t(80, 658, (d) => pers(d).menarquia ?? '', { w: 30, s: 6.5 }),
  t(80, 668, (d) => pers(d).embarazos ?? '', { w: 50, s: 6.5 }),
  t(80, 678, (d) => pers(d).hijos ?? '', { w: 50, s: 6.5 }),
  t(80, 688, (d) => pers(d).abortos ?? '', { w: 50, s: 6.5 }),
  t(80, 698, (d) => (pers(d).fur ? pers(d).fur.split('-').reverse().join('/') : ''), { w: 60, s: 6.5 }),
  ...par(81.3, 717.5, (d) => pers(d).vidaSexualActiva, 10.6),
  t(131, 712.5, detalle(pers, 'vidaSexualActiva'), { w: 15, s: 6.5 }),
  ...par(81.3, 727.7, (d) => pers(d).conSuVoluntad, 10.6),
  ...par(81.3, 738.3, (d) => pers(d).variasParejas, 10.6),
  ...par(175.5, 678.1, (d) => pers(d).anticonceptivos),
  t(177, 688.5, detalle(pers, 'anticonceptivos'), { w: 45, s: 6 }),
  ...par(175.5, 727.0, (d) => pers(d).ciclosIrregulares),
  ...par(175.5, 765.1, (d) => pers(d).dismenorrea),
  t(80, 760.5, (d) => d.id.orientacionSexual ?? '', { w: 120, s: 6.5 }),
  t(80, 770.5, (d) => d.id.identidadGenero ?? '', { w: 120, s: 6.5 }),

  // Médicos: un círculo por antecedente, se marca si lo tiene
  ...MEDICOS_IZQ.map(([k, cy]) => m(289.5, cy, (d) => med(d)[k] === true)),
  ...MEDICOS_DER.map(([k, cy]) => m(364.8, cy, (d) => med(d)[k] === true)),
  t(357, 768.5, (d) => med(d).otrosMedicos ?? '', { w: 50, s: 6 }),

  // Psicosociales
  m(470.3, 663.0, (d) => psi(d).viveCon === 'familia'),
  m(470.3, 676.0, (d) => psi(d).viveCon === 'conocido'),
  m(470.3, 688.3, (d) => psi(d).viveCon === 'institucion'),
  m(538.1, 663.0, (d) => psi(d).viveCon === 'privado_libertad'),
  m(538.1, 676.0, (d) => psi(d).viveCon === 'situacion_calle'),
  t(531, 684.5, (d) => (psi(d).viveCon === 'otro' ? psi(d).viveConOtro ?? 'Otro' : ''), { w: 65, s: 6 }),
  ...par(486.5, 712.3, (d) => psi(d).comparteCama),
  ...par(486.5, 725.2, (d) => psi(d).educacionSexualidad),
  ...par(486.5, 737.4, (d) => psi(d).trabajoInfantil),
  t(477, 745.5, detalle(psi, 'trabajoInfantil'), { w: 60, s: 6.5 }),
  ...par(486.5, 761.2, (d) => psi(d).alteracionesAnimo),

  // Estilos de vida
  t(165, 795.5, (d) => est(d).comidasDia ?? '', { w: 40, s: 6.5 }),
  ...par(107.3, 815.5, (d) => est(d).actividadFisica, 12.2),
  t(174, 812.5, detalle(est, 'actividadFisica'), { w: 40, s: 6.5 }),
  ...par(107.3, 828.7, (d) => est(d).videojuegos, 12.2),
  t(174, 824.5, (d) => est(d).otrasActividades ?? '', { w: 40, s: 6 }),
  ...par(107.3, 840.2, (d) => est(d).tv, 12.2),
  t(174, 836.5, (d) => est(d).horasSueno ?? '', { w: 40, s: 6.5 }),
  ...par(107.3, 853.5, (d) => est(d).higieneDiaria, 12.2),
  ...par(107.3, 864.9, (d) => est(d).espaciosAmigables, 12.2),
  ...par(107.3, 876.0, (d) => est(d).sustancias, 12.2),
  t(77, 886, (d) => est(d).alcohol ?? '', { w: 37, s: 6 }),
  t(133, 886, (d) => est(d).drogas ?? '', { w: 33, s: 6 }),
  t(185, 886, (d) => est(d).tabaco ?? '', { w: 40, s: 6 }),
  t(100, 896.5, (d) => est(d).otrasSustancias ?? '', { w: 110, s: 6 }),
  ...par(107.3, 911.5, (d) => est(d).conduceVehiculo, 12.2),

  // Familiares
  ...FAMILIARES_IZQ.flatMap(([k, cy]) => par(289.0, cy, (d) => fam(d)[k])),
  ...FAMILIARES_DER.flatMap(([k, cy]) => par(377.8, cy, (d) => fam(d)[k])),

  // Vacunación, suplementación y desparasitación
  ...par(265.0, 887.1, (d) => vac(d).vph),
  ...par(265.0, 897.8, (d) => vac(d).td),
  t(261, 904, (d) => vac(d).otrasVacunas ?? '', { w: 26, s: 5.5 }),
  ...par(309.8, 892.4, (d) => vac(d).suplementacion),
  t(309, 905, detalle(vac, 'suplementacion'), { w: 36, s: 5.5 }),
  ...par(368.1, 892.4, (d) => vac(d).desparasitacion),
  t(368, 905, detalle(vac, 'desparasitacion'), { w: 42, s: 5.5 }),

  // Factores de riesgo
  ...RIESGO.flatMap(([k, cy]) => par(490.5, cy, (d) => rie(d)[k])),
  t(482, 897, (d) => rie(d).especifiqueRiesgo ?? '', { w: 112, s: 6 }),
];

const SITIOS = [
  ['piel', 106.9, 129.7], ['cabeza', 106.9, 140.6], ['ojos', 106.9, 152.6], ['oidos', 106.9, 164.5],
  ['salud_bucal', 234.3, 129.7], ['cuello_tiroides', 234.3, 140.6], ['torax', 234.3, 152.6], ['cardiopulmonar', 234.3, 164.5],
  ['abdomen', 361.8, 129.7], ['genitourinario', 361.8, 140.6], ['columna', 361.8, 152.6], ['cadera', 361.8, 164.5],
  ['extremidades', 489.5, 129.7], ['neurologico', 489.5, 140.6],
];
const FILAS_DX = [300.7, 318.6, 336.4, 354.3, 372.2];
const libras = (kg) => (kg ? (Number(kg) * 2.20462).toFixed(1) : '');
const nutricional = (d) => String(d.clasificacion ?? '').toLowerCase();

const pagina2 = [
  // Signos vitales
  ...cajas([31.1, 42.6, 55.2], 46, 11, (d) => cifras(d.preconsulta.temperatura, 2, true)),
  t(119, 50, (d) => d.preconsulta.frecCardiaca ?? '', { w: 30, s: 8 }),
  t(196, 50, (d) => (d.preconsulta.presionSis ? `${d.preconsulta.presionSis}/${d.preconsulta.presionDia ?? ''}` : ''), { w: 34, s: 8 }),
  t(281, 50, (d) => d.preconsulta.frecRespiratoria ?? '', { w: 30, s: 8 }),
  ...cajas([41.4, 52.9, 64.5, 76.1], 76, 11.5, (d) => cifras(d.preconsulta.peso, 4)),
  ...cajas([138.1, 149.6, 161.2, 172.7], 76, 11.5, (d) => cifras(libras(d.preconsulta.peso), 4)),
  ...cajas([242.3, 253.9, 265.4], 74.5, 11.5, (d) => cifras(d.preconsulta.talla, 3)),
  ...cajas([338.0, 349.5, 361.1, 372.6], 75.5, 11.5, (d) => cifras(d.imc, 3, true)),
  m(529.0, 66.7, (d) => nutricional(d) === 'normal'),
  m(529.0, 77.6, (d) => nutricional(d).includes('moderada')),
  m(529.0, 88.1, (d) => nutricional(d).includes('severa')),
  m(584.3, 66.9, (d) => nutricional(d) === 'sobrepeso'),
  m(584.3, 76.5, (d) => nutricional(d).includes('obesidad')),

  // Examen físico: Sí = normal
  ...SITIOS.flatMap(([k, cx, cy]) => par(cx, cy, (d) => d.atencion.sitios[k] ?? null, 12.2)),
  area(531, 129, 62, 42, (d) => d.atencion.otrosHallazgos, { s: 6 }),
  ...par(106.9, 195.2, (d) => pub(d).tannerAdecuado, 12.2),
  t(246, 187.5, (d) => pub(d).tannerMamas ?? '', { w: 30, s: 7 }),
  t(303, 187.5, (d) => pub(d).tannerGenitales ?? '', { w: 32, s: 7 }),
  t(369, 187.5, (d) => pub(d).tannerVello ?? '', { w: 40, s: 7 }),
  area(24, 212, 436, 54, (d) => d.atencion.hallazgosAnormales, { s: 7 }),
  t(512, 246, (d) => d.atencion.numeroNotificacion, { w: 80, s: 7 }),

  // Impresión clínica: cinco renglones a cada lado
  ...FILAS_DX.flatMap((y, i) => [
    t(19, y + 4.5, (d) => d.atencion.diagnosticos[i]?.descripcion ?? '', { w: 140, s: 6.5 }),
    t(163, y + 4.5, (d) => d.atencion.diagnosticos[i]?.cie ?? '', { w: 50, s: 7 }),
    t(307, y + 4.5, (d) => d.atencion.diagnosticos[i + 5]?.descripcion ?? '', { w: 139, s: 6.5 }),
    t(450, y + 4.5, (d) => d.atencion.diagnosticos[i + 5]?.cie ?? '', { w: 50, s: 7 }),
  ]),
  area(217, 302, 86, 88, (d) => d.atencion.tratamiento, { s: 6, renglon: 7.5 }),

  area(22, 406, 570, 52, (d) => d.atencion.otrosProblemas, { s: 7.5 }),
  area(22, 474, 570, 50, (d) => d.atencion.laboratorios, { s: 7.5 }),
  area(22, 539, 570, 56, (d) => d.atencion.orientacionIntegral, { s: 7.5 }),
  t(25, 612, (d) => d.atencion.proveedor, { w: 330, s: 8.5 }),
  t(430, 599, (d) => (d.atencion.proximaCita ? fechaTexto(d.atencion.proximaCita) : ''), { w: 140, s: 8 }),
];

export default {
  clave: 'adolescente_joven',
  paginas: [
    { fondo: '/fichas/AII_016-1.svg', items: pagina1 },
    { fondo: '/fichas/AII_016-2.svg', items: pagina2 },
  ],
};

