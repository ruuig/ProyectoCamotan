/**
 * Tokens visuales del sistema.
 *
 * Única fuente de verdad del color: de aquí salen las variables CSS que se
 * publican en :root y también los colores que Tailwind compila. Ningún
 * componente debe escribir un hexadecimal suelto; las gráficas de Chart.js,
 * que necesitan el valor y no la clase, importan este archivo.
 *
 * Regla de significado: el azul dice "mejoró" y el naranja "empeoró o es
 * crítico". No se usa verde ni rojo para eso, porque una persona con
 * daltonismo rojo-verde no los distingue entre sí. El color depende de lo que
 * significa el indicador, nunca de si el número sube o baja.
 */
export const COLOR = {
  fondo: '#F2F4F7',
  superficie: '#FFFFFF',

  tinta: '#14244A',
  tinta2: '#3B4760',
  apagado: '#5B6478',

  linea: '#DFE4EC',
  lineaSuave: '#EDF0F5',

  marino: '#172A5A',
  marinoApagado: '#A9B4CC',

  mejora: '#1D5FBF',
  empeora: '#C2410C',
  empeoraClaro: '#E07A3F',
  advertencia: '#9A5B00',
  advertenciaMarca: '#D98A1C',
};

/**
 * Nombre de cada token como variable CSS. Se usa para publicarlas en :root y
 * para poder leerlas desde JavaScript cuando haga falta.
 */
export const VARIABLES_CSS = {
  '--fondo': COLOR.fondo,
  '--superficie': COLOR.superficie,
  '--tinta': COLOR.tinta,
  '--tinta-2': COLOR.tinta2,
  '--apagado': COLOR.apagado,
  '--linea': COLOR.linea,
  '--linea-suave': COLOR.lineaSuave,
  '--marino': COLOR.marino,
  '--marino-apagado': COLOR.marinoApagado,
  '--mejora': COLOR.mejora,
  '--empeora': COLOR.empeora,
  '--empeora-claro': COLOR.empeoraClaro,
  '--advertencia': COLOR.advertencia,
  '--advertencia-marca': COLOR.advertenciaMarca,
};

export default COLOR;
