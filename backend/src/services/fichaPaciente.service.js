/**
 * Reglas comunes al guardar cualquier seccion de la ficha del paciente:
 * que cambio, quien puede escribir un dato sensible y como se oculta.
 *
 * Datos sensibles (MD/01-pacientes.md seccion 6):
 *   - Preconsulta puede registrarlos al pasar la ficha de papel, porque ya
 *     maneja ese papel fisicamente.
 *   - Una vez guardados, solo el medico y el administrador ven el valor.
 *     Preconsulta ve "registrado", sin el contenido, y no puede cambiarlo.
 *
 * Funciones puras.
 */

const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function iguales(a, b) {
  if (vacio(a) && vacio(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Quita el contenido de los datos sensibles ya registrados.
 * Devuelve los datos sin esos valores y la lista de cuales estan registrados.
 */
function enmascarar(datos, sensibles) {
  const visibles = {};
  const registrados = [];
  for (const [clave, valor] of Object.entries(datos ?? {})) {
    if (sensibles.has(clave) && !vacio(valor)) {
      registrados.push(clave);
    } else {
      visibles[clave] = valor;
    }
  }
  return { datos: visibles, registrados };
}

/**
 * Junta lo que llega con lo que habia y dice que cambio.
 *
 * Solo se tocan las claves que vienen; las demas se conservan. Quien no puede
 * ver los datos sensibles puede escribir uno que esta vacio, pero no cambiar
 * ni borrar uno ya registrado: no sabe que dice.
 *
 * Devuelve { datos, cambios } o { error, campos } si se intento cambiar un
 * sensible ya registrado sin permiso.
 */
function fusionarCambios({ anteriores = {}, nuevos = {}, sensibles = new Set(), puedeVerSensibles }) {
  const bloqueados = Object.keys(nuevos).filter(
    (k) => sensibles.has(k) && !puedeVerSensibles && !vacio(anteriores[k]) && !iguales(anteriores[k], nuevos[k]),
  );
  if (bloqueados.length > 0) {
    return { error: 'sensible_registrado', campos: bloqueados };
  }

  const datos = { ...anteriores };
  const cambios = [];
  for (const [clave, valor] of Object.entries(nuevos)) {
    const normalizado = vacio(valor) ? null : valor;
    if (iguales(anteriores[clave], normalizado)) continue;
    cambios.push({
      campo: clave,
      anterior: vacio(anteriores[clave]) ? null : anteriores[clave],
      nuevo: normalizado,
      sensible: sensibles.has(clave),
    });
    datos[clave] = normalizado;
  }
  return { datos, cambios };
}

/**
 * Historial de cambios tal como lo puede ver cada quien. A quien no ve los
 * datos sensibles se le dice que el dato cambio, no a que.
 */
function historialVisible(cambios, puedeVerSensibles) {
  return cambios.map((c) => (c.sensible && !puedeVerSensibles
    ? { ...c, anterior: c.anterior === null ? null : 'registrado', nuevo: c.nuevo === null ? null : 'registrado', oculto: true }
    : c));
}

function puedeVerSensibles(usuario) {
  return usuario?.rol === 'medico' || usuario?.rol === 'admin';
}

module.exports = {
  vacio,
  iguales,
  enmascarar,
  fusionarCambios,
  historialVisible,
  puedeVerSensibles,
};
