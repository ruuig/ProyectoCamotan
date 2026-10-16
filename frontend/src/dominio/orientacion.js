/**
 * Orientación de post-consulta: lo que la auxiliar le explica al paciente
 * antes de que se vaya. Cuándo regresar de inmediato (signos de alarma) según
 * el diagnóstico, y el horario de cada medicamento en dibujos para quien no
 * lee.
 *
 * Los signos son los de la consejería de AIEPI y de las normas de atención:
 * frases cortas, en palabras del paciente. Se eligen por el código CIE-10.
 */

const GRUPOS = [
  {
    clave: 'respiratoria',
    titulo: 'Tos, gripe o infección respiratoria',
    es: (c) => /^J(0\d|1\d|2[0-2])/.test(c),
    signos: [
      'Respira rápido o se le hunde el pecho al respirar',
      'No puede beber ni mamar, o vomita todo',
      'Está muy dormido o no despierta bien',
      'La fiebre no baja en 2 días',
    ],
  },
  {
    clave: 'diarrea',
    titulo: 'Diarrea o vómitos',
    es: (c) => /^(A0\d|K52|R11)/.test(c),
    signos: [
      'Hace popó muchas veces o vomita todo lo que toma',
      'Hay sangre en la popó',
      'Tiene los ojos hundidos, mucha sed o casi no orina',
      'No puede beber o está muy decaído',
    ],
    consejo: 'Suero oral: un sobre en un litro de agua hervida y fría. Dar a tragos después de cada evacuación.',
  },
  {
    clave: 'dengue',
    titulo: 'Fiebre o dengue',
    es: (c) => /^(A9[0-1]|R50)/.test(c),
    signos: [
      'Dolor fuerte de estómago o vómitos que no paran',
      'Sangra de la nariz o de las encías',
      'Le salen manchas en la piel',
      'Está muy cansado, frío o inquieto',
    ],
    consejo: 'Para la fiebre solo acetaminofén. No dar ibuprofeno ni aspirina.',
  },
  {
    clave: 'orina',
    titulo: 'Infección de orina',
    es: (c) => /^(N39|N30|N10)/.test(c),
    signos: ['Fiebre con escalofríos', 'Dolor en la espalda, a los lados', 'Sangre en la orina'],
  },
  {
    clave: 'presion',
    titulo: 'Presión alta',
    es: (c) => /^I1[0-5]/.test(c),
    signos: [
      'Dolor de cabeza muy fuerte o ve lucecitas',
      'Dolor de pecho o le falta el aire',
      'Se le duerme o no puede mover una parte del cuerpo',
    ],
    consejo: 'Tome la pastilla todos los días aunque se sienta bien. Menos sal en la comida.',
  },
  {
    clave: 'diabetes',
    titulo: 'Diabetes',
    es: (c) => /^E1[0-4]/.test(c),
    signos: ['Mucha sed y orina muchas veces', 'Mareo, sudor frío o temblor', 'Heridas en los pies que no sanan'],
    consejo: 'Tome el medicamento todos los días y revise sus pies.',
  },
  {
    clave: 'embarazo',
    titulo: 'Embarazo',
    es: (c) => /^(O|Z3[3-6])/.test(c),
    signos: [
      'Sangrado o le sale agua',
      'Dolor de cabeza fuerte, ve lucecitas o se le hincha la cara y las manos',
      'El bebé no se mueve',
      'Fiebre o dolor fuerte de estómago',
    ],
  },
  {
    clave: 'nutricion',
    titulo: 'Desnutrición',
    es: (c) => /^E4[0-6]/.test(c),
    signos: ['No quiere comer', 'Se le hinchan los pies', 'Tiene diarrea o fiebre'],
  },
];

const GENERAL = ['Si empeora o aparece algo nuevo', 'Si tiene fiebre que no baja', 'Si no puede comer ni beber'];

/** Signos de alarma para los diagnósticos de la consulta. */
export function orientacionPara(codigos = []) {
  const lista = codigos.filter(Boolean).map((c) => c.toUpperCase());
  const grupos = GRUPOS.filter((g) => lista.some((c) => g.es(c)));
  if (!grupos.length) return [{ clave: 'general', titulo: 'Regrese al centro', signos: GENERAL }];
  return grupos;
}

/**
 * Horario de un medicamento a partir de las indicaciones escritas por el
 * médico: cuántas veces al día y por cuántos días. Si no se entiende, null:
 * se queda el texto del médico, sin adivinar.
 */
export function horarioDe(indicaciones) {
  const t = String(indicaciones ?? '').toLowerCase();
  let veces = null;
  const cada = t.match(/cada\s+(\d{1,2})\s*(h|hora)/);
  const vecesDia = t.match(/(\d)\s*veces?\s*(al|por)\s*d[ií]a/);
  if (cada) veces = Math.round(24 / Number(cada[1]));
  else if (vecesDia) veces = Number(vecesDia[1]);
  else if (/una vez al d[ií]a|cada d[ií]a|diari|al d[ií]a/.test(t)) veces = 1;
  const dias = t.match(/(\d{1,3})\s*d[ií]as/);
  if (!veces || veces > 4) return veces ? { veces, momentos: null, dias: dias ? Number(dias[1]) : null } : null;
  const MOMENTOS = {
    1: ['mañana'],
    2: ['mañana', 'noche'],
    3: ['mañana', 'tarde', 'noche'],
    4: ['mañana', 'mediodía', 'tarde', 'noche'],
  };
  return { veces, momentos: MOMENTOS[veces], dias: dias ? Number(dias[1]) : null };
}
