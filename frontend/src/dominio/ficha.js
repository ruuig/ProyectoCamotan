/**
 * Apoyo de la pantalla "Completar ficha".
 *
 * Las reglas de verdad están en el servidor (fichaSecciones.service.js); aquí
 * se repite solo lo necesario para que la pantalla responda mientras se
 * llena: qué campos se muestran, cuánto lleva cada sección y cómo leer un
 * valor en el historial.
 */

export const lleno = (v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

/** El campo se muestra para este paciente (sexo, edad, respuesta previa). */
export function aplica(campo, perfil, datos = {}) {
  if (campo.soloSexo && perfil.sexo && campo.soloSexo !== perfil.sexo) return false;
  if (campo.edadMeses && perfil.edadMeses !== null && perfil.edadMeses !== undefined) {
    const { desde = 0, hasta = Infinity } = campo.edadMeses;
    if (perfil.edadMeses < desde || perfil.edadMeses >= (hasta ?? Infinity)) return false;
  }
  if (campo.mostrarSi && datos[campo.mostrarSi.campo] !== campo.mostrarSi.igual) return false;
  return true;
}

/** Claves de datos de un campo (una lista tiene una por casilla). */
export function clavesDe(campo) {
  switch (campo.tipo) {
    case 'lista': return campo.items.map((i) => i.clave);
    case 'siNoEspecifique':
    case 'siNoNumero': return [campo.clave, `${campo.clave}Detalle`];
    case 'libraOnza': return [`${campo.clave}Lb`, `${campo.clave}Onz`];
    case 'seleccion':
      return campo.opciones.some((o) => o.valor === 'otro') ? [campo.clave, `${campo.clave}Otro`] : [campo.clave];
    case 'calculado':
    case 'archivo': return [];
    default: return [campo.clave];
  }
}

/** Avance de una sección con lo que está en pantalla. */
export function avance(seccion, datos, perfil, sensiblesRegistrados = []) {
  const registrado = (k) => lleno(datos[k]) || sensiblesRegistrados.includes(k);
  let total = 0;
  let respondidas = 0;
  for (const c of seccion.campos) {
    if (!aplica(c, perfil, datos) || c.tipo === 'calculado') continue;
    if (c.tipo === 'archivo') {
      total += 1;
      if (seccion.estado === 'registrado') respondidas += 1;
    } else if (c.tipo === 'lista') {
      total += c.items.length;
      respondidas += c.items.filter((i) => registrado(i.clave)).length;
    } else {
      total += 1;
      if (registrado(c.tipo === 'libraOnza' ? `${c.clave}Lb` : c.clave)) respondidas += 1;
    }
  }
  return { respondidas, total };
}

/**
 * "Marcar el resto como No": solo las preguntas Sí/No sin registrar, nunca
 * las que ya tienen respuesta ni las sensibles.
 */
export function marcarRestoComoNo(seccion, datos, perfil, sensiblesRegistrados = []) {
  const salida = { ...datos };
  const libre = (k) => !lleno(salida[k]) && !sensiblesRegistrados.includes(k);
  for (const c of seccion.campos) {
    if (!aplica(c, perfil, salida)) continue;
    if (c.tipo === 'lista') {
      c.items.forEach((i) => { if (!i.sensible && libre(i.clave)) salida[i.clave] = false; });
    } else if (['siNo', 'siNoEspecifique', 'siNoNumero'].includes(c.tipo) && !c.sensible && libre(c.clave)) {
      salida[c.clave] = false;
    }
  }
  return salida;
}

/** Cuántas preguntas Sí/No quedan sin registrar (para el botón). */
export function siNoPendientes(seccion, datos, perfil, sensiblesRegistrados = []) {
  const antes = marcarRestoComoNo(seccion, datos, perfil, sensiblesRegistrados);
  return Object.keys(antes).filter((k) => antes[k] === false && !lleno(datos[k])).length;
}

/** Etiqueta legible de cada clave de dato, para el historial. */
export function etiquetas(campos) {
  const salida = {};
  for (const c of campos) {
    if (c.tipo === 'lista') {
      c.items.forEach((i) => { salida[i.clave] = { etiqueta: `${c.etiqueta}: ${i.etiqueta}` }; });
      continue;
    }
    salida[c.clave] = { etiqueta: c.etiqueta, opciones: c.opciones };
    if (c.tipo === 'siNoEspecifique') salida[`${c.clave}Detalle`] = { etiqueta: `${c.etiqueta} (especifique)` };
    if (c.tipo === 'siNoNumero') salida[`${c.clave}Detalle`] = { etiqueta: `${c.etiqueta} (${c.unidad})` };
    if (c.tipo === 'libraOnza') {
      salida[`${c.clave}Lb`] = { etiqueta: `${c.etiqueta} (lb)` };
      salida[`${c.clave}Onz`] = { etiqueta: `${c.etiqueta} (onz)` };
    }
    if (c.tipo === 'seleccion') salida[`${c.clave}Otro`] = { etiqueta: `${c.etiqueta} (otro)` };
    if (c.especifique) salida[c.especifique.clave] = { etiqueta: `${c.etiqueta}: ${c.especifique.etiqueta.toLowerCase()}` };
  }
  return salida;
}

/** Un valor tal como se lee en pantalla. */
export function valorLegible(valor, info) {
  if (valor === null || valor === undefined || valor === '') return 'sin registrar';
  if (valor === true) return 'Sí';
  if (valor === false) return 'No';
  const opcion = info?.opciones?.find((o) => o.valor === valor);
  if (opcion) return opcion.etiqueta;
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) {
    return new Date(valor).toLocaleDateString('es-GT', { timeZone: 'UTC' });
  }
  return String(valor);
}

const formatoFecha = new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long' });

/** "Registrado el 2 de octubre por Ana López". */
export function registradoPor(fecha, usuario) {
  if (!fecha) return null;
  return `Registrado el ${formatoFecha.format(new Date(fecha))}${usuario ? ` por ${usuario}` : ''}`;
}

/**
 * Clasificación del peso al nacer con los cortes impresos en la ficha:
 * 5 lb 4 onz y 8 lb. La misma regla que el servidor.
 */
export function clasificacionPesoNacer(libras, onzas) {
  if (libras === null || libras === undefined || libras === '') return null;
  const total = Number(libras) * 16 + Number(onzas || 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (total < 84) return 'Menor de 2,500 g';
  if (total <= 128) return 'De 2,500 a 4,000 g';
  return 'Mayor de 4,000 g';
}
