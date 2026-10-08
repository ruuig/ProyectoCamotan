// Cliente HTTP base. Usa fetch nativo: axios no esta en el stack obligatorio.
import { guardarCache, leerCache } from './almacenLocal';

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const CLAVE_TOKEN = 'camotan_token';
export const CLAVE_USUARIO = 'camotan_usuario';

// Se lee de localStorage y no del store de Pinia a proposito: si este modulo
// importara el store y el store importara este modulo, quedaria un ciclo.
function obtenerToken() {
  return localStorage.getItem(CLAVE_TOKEN);
}

// Permite que el store reaccione a un 401 sin que este modulo lo conozca.
let alExpirarSesion = null;
export function registrarManejadorSesionExpirada(manejador) {
  alExpirarSesion = manejador;
}

async function solicitar(ruta, opciones = {}) {
  const token = obtenerToken();
  let respuesta;

  try {
    respuesta = await fetch(`${BASE_URL}${ruta}`, {
      ...opciones,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opciones.headers,
      },
    });
  } catch {
    // fetch solo rechaza cuando la peticion no llego al servidor.
    const error = new Error('No se pudo conectar con el servidor');
    error.codigo = 'error_red';
    throw error;
  }

  const cuerpo = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    if (respuesta.status === 401 && alExpirarSesion) {
      alExpirarSesion();
    }
    // Sin cuerpo de error del servidor: la peticion no llego al backend (el
    // proxy no pudo conectar). No es un error de la aplicacion.
    const sinServidor = !cuerpo?.error && respuesta.status >= 500;
    const error = new Error(cuerpo?.error?.mensaje || (sinServidor ? 'No se pudo conectar con el servidor' : 'Ocurrio un error inesperado'));
    error.codigo = cuerpo?.error?.codigo || (sinServidor ? 'error_red' : 'error');
    error.estado = respuesta.status;
    error.detalles = cuerpo?.error?.detalles || null;
    throw error;
  }

  return cuerpo;
}

/**
 * Lectura con respaldo en cache. Si la red falla, devuelve lo ultimo que se
 * vio, marcando cuantos minutos tiene, en lugar de dejar la pantalla vacia.
 */
async function getConCache(ruta) {
  try {
    const datos = await solicitar(ruta);
    guardarCache(ruta, datos);
    return { datos, desdeCache: false, minutosDeAntiguedad: 0 };
  } catch (error) {
    if (error.codigo !== 'error_red') throw error;

    const cache = await leerCache(ruta);
    if (!cache) throw error;

    return { datos: cache.datos, desdeCache: true, minutosDeAntiguedad: cache.minutosDeAntiguedad };
  }
}

function conCuerpo(metodo) {
  return (ruta, datos, headers) =>
    solicitar(ruta, { method: metodo, body: JSON.stringify(datos ?? {}), headers });
}

/**
 * Envia un archivo tal cual (foto o PDF), sin envolverlo en JSON.
 */
function subirArchivo(ruta, archivo) {
  return solicitar(ruta, {
    method: 'POST',
    body: archivo,
    headers: {
      'Content-Type': archivo.type,
      'X-Nombre-Archivo': encodeURIComponent(archivo.name),
    },
  });
}

/**
 * Descarga un archivo protegido. El navegador no manda el token en un enlace
 * simple, asi que se pide con fetch y se entrega como URL local.
 */
async function descargarArchivo(ruta) {
  const token = obtenerToken();
  const respuesta = await fetch(`${BASE_URL}${ruta}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!respuesta.ok) throw new Error('No se pudo abrir el archivo');
  return URL.createObjectURL(await respuesta.blob());
}

/**
 * Descarga que necesita cuerpo, como la autorizacion del director, y la
 * guarda en el equipo con el nombre que indica el servidor.
 */
async function descargarConCuerpo(ruta, datos) {
  const token = obtenerToken();
  let respuesta;
  try {
    respuesta = await fetch(`${BASE_URL}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(datos ?? {}),
    });
  } catch {
    const error = new Error('No se pudo conectar con el servidor');
    error.codigo = 'error_red';
    throw error;
  }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => null);
    if (respuesta.status === 401 && alExpirarSesion) alExpirarSesion();
    const error = new Error(cuerpo?.error?.mensaje || 'No se pudo descargar el archivo');
    error.codigo = cuerpo?.error?.codigo || 'error';
    throw error;
  }
  const disposicion = respuesta.headers.get('Content-Disposition') ?? '';
  const nombre = decodeURIComponent(disposicion.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? 'descarga');
  const url = URL.createObjectURL(await respuesta.blob());
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return nombre;
}

export default {
  get: (ruta) => solicitar(ruta),
  descargarConCuerpo,
  put: conCuerpo('PUT'),
  subirArchivo,
  descargarArchivo,
  getConCache,
  post: conCuerpo('POST'),
  patch: conCuerpo('PATCH'),
  // Forma generica que usa la cola de sincronizacion.
  request: (metodo, ruta, datos, headers) =>
    metodo === 'GET'
      ? solicitar(ruta, { headers })
      : solicitar(ruta, { method: metodo, body: JSON.stringify(datos ?? {}), headers }),
};
