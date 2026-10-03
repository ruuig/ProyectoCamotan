/**
 * Resumen de los antecedentes del paciente para la consulta del medico.
 *
 * El medico no llena la ficha, pero tiene que ver de un vistazo lo que
 * importa: lo marcado como Si y lo que se escribio. Los "No" se cuentan, no
 * se listan; lo que sigue sin registrar se dice como tal.
 *
 * Funcion pura.
 */

const { estructuraIdentificacion } = require('./fichaIdentificacion.service');
const { seccionesDe, clavesSensibles, calculados, aplica } = require('./fichaSecciones.service');
const { calcularEdad } = require('./pacientes.service');

const lleno = (v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

function opcion(campo, valor, otro) {
  if (valor === 'otro' && otro) return `Otro: ${otro}`;
  return campo.opciones.find((o) => o.valor === valor)?.etiqueta ?? valor;
}

/** Lo que dice una seccion, en frases cortas. */
function leerSeccion(seccion, datos, perfil) {
  const positivos = [];
  const datosEscritos = [];
  let negativos = 0;

  for (const c of seccion.campos) {
    if (!aplica(c, perfil, datos)) continue;
    switch (c.tipo) {
      case 'lista':
        for (const i of c.items) {
          if (datos[i.clave] === true) positivos.push(i.etiqueta);
          else if (datos[i.clave] === false) negativos += 1;
        }
        break;
      case 'siNo':
        if (datos[c.clave] === true) positivos.push(c.etiqueta);
        else if (datos[c.clave] === false) negativos += 1;
        break;
      case 'siNoEspecifique':
      case 'siNoNumero': {
        const detalle = datos[`${c.clave}Detalle`];
        if (datos[c.clave] === true) {
          const extra = lleno(detalle) ? ` (${detalle}${c.tipo === 'siNoNumero' ? ` ${c.unidad}` : ''})` : '';
          positivos.push(`${c.etiqueta}${extra}`);
        } else if (datos[c.clave] === false) {
          negativos += 1;
        }
        break;
      }
      case 'seleccion':
        if (lleno(datos[c.clave])) datosEscritos.push(`${c.etiqueta}: ${opcion(c, datos[c.clave], datos[`${c.clave}Otro`])}`);
        break;
      case 'libraOnza':
        if (lleno(datos[`${c.clave}Lb`])) {
          datosEscritos.push(`${c.etiqueta}: ${datos[`${c.clave}Lb`]} lb ${datos[`${c.clave}Onz`] ?? 0} onz`);
        }
        break;
      case 'numero':
        if (lleno(datos[c.clave])) datosEscritos.push(`${c.etiqueta}: ${datos[c.clave]}${c.unidad ? ` ${c.unidad}` : ''}`);
        break;
      case 'calculado': {
        const v = calculados(seccion, datos)[c.clave];
        if (v) datosEscritos.push(`${c.etiqueta}: ${v}`);
        break;
      }
      case 'archivo':
        if (lleno(datos[c.clave])) datosEscritos.push('Familiograma adjunto');
        break;
      default:
        if (lleno(datos[c.clave])) datosEscritos.push(`${c.etiqueta}: ${datos[c.clave]}`);
    }
  }

  return { positivos, datos: datosEscritos, negativos };
}

/**
 * Resumen de todas las secciones de la ficha del paciente.
 * Devuelve tambien que datos sensibles se mostraron, para la bitacora.
 */
function resumenAntecedentes(paciente, filas) {
  const ficha = estructuraIdentificacion(paciente.fechaNacimiento).ficha;
  const perfil = { sexo: paciente.sexo, edadMeses: calcularEdad(paciente.fechaNacimiento).edadMeses };
  const porClave = new Map(filas.map((f) => [f.seccion, f]));
  const sensibles = [];

  const secciones = seccionesDe(ficha.clave, perfil).map((s) => {
    const fila = porClave.get(s.clave);
    if (!fila) return { clave: s.clave, titulo: s.titulo, registrada: false };
    const datos = fila.datos ?? {};
    for (const k of clavesSensibles(s)) if (lleno(datos[k])) sensibles.push(`${s.clave}.${k}`);
    return { clave: s.clave, titulo: s.titulo, registrada: true, actualizadoEn: fila.actualizadoEn, ...leerSeccion(s, datos, perfil) };
  });

  return { ficha, secciones, sensibles };
}

module.exports = { leerSeccion, resumenAntecedentes };
