import http from '../services/http';

/**
 * Apoyo de los documentos impresos de la bodega: establecimiento para el
 * encabezado, constancia en bitácora y páginas de unos 20 insumos, como el
 * formato del centro.
 */

export async function establecimiento() {
  try {
    return (await http.get('/admin/establecimiento')).establecimiento;
  } catch {
    return null;
  }
}

/** Toda impresión queda en bitácora. Si falla el registro, el documento igual sale. */
export async function registrarImpresion(documento, referencia, enBlanco = false) {
  try {
    await http.post('/impresiones', { documento, referencia, enBlanco });
  } catch {
    // La constancia no debe impedir imprimir.
  }
}

/** Parte una lista en páginas. */
export function paginas(lista, porPagina = 20) {
  const salida = [];
  for (let i = 0; i < lista.length; i += porPagina) salida.push(lista.slice(i, i + porPagina));
  return salida.length ? salida : [[]];
}

/** Renglones vacíos para el formato en blanco. */
export function renglonesEnBlanco(n = 20) {
  return Array.from({ length: n }, (_, i) => ({ vacio: true, insumoId: `v${i}` }));
}

export function textoInsumo(r) {
  return [r.nombre, r.formaFarmaceutica, r.concentracion].filter(Boolean).join(' ');
}
