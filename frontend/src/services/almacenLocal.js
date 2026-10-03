// Almacen en IndexedDB para la tolerancia a desconexion.
// Guarda dos cosas: la cache de lectura y la cola de escrituras pendientes.

const BD = 'camotan';
const VERSION = 1;
const CACHE = 'cache';
const COLA = 'cola';

let promesaBd = null;

function abrir() {
  if (promesaBd) return promesaBd;

  promesaBd = new Promise((resolver, rechazar) => {
    const solicitud = indexedDB.open(BD, VERSION);

    solicitud.onupgradeneeded = () => {
      const bd = solicitud.result;
      if (!bd.objectStoreNames.contains(CACHE)) bd.createObjectStore(CACHE, { keyPath: 'clave' });
      if (!bd.objectStoreNames.contains(COLA)) {
        bd.createObjectStore(COLA, { keyPath: 'idempotencyKey' });
      }
    };

    solicitud.onsuccess = () => resolver(solicitud.result);
    solicitud.onerror = () => rechazar(solicitud.error);
  });

  return promesaBd;
}

// IndexedDB guarda con clonado estructurado, que no sabe copiar los objetos
// reactivos de Vue: lanza "could not be cloned". Todo lo que se guarde pasa
// por aqui para convertirse en datos planos.
function aDatosPlanos(valor) {
  return valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));
}

function operar(almacen, modo, accion) {
  return abrir().then(
    (bd) =>
      new Promise((resolver, rechazar) => {
        const transaccion = bd.transaction(almacen, modo);
        const solicitud = accion(transaccion.objectStore(almacen));
        solicitud.onsuccess = () => resolver(solicitud.result);
        solicitud.onerror = () => rechazar(solicitud.error);
      }),
  );
}

// --- Cache de lectura ------------------------------------------------------

export async function guardarCache(clave, datos) {
  try {
    await operar(CACHE, 'readwrite', (s) =>
      s.put({ clave, datos: aDatosPlanos(datos), guardadoEn: Date.now() }),
    );
  } catch {
    // Sin IndexedDB disponible el sistema sigue funcionando, solo sin cache.
  }
}

export async function leerCache(clave) {
  try {
    const fila = await operar(CACHE, 'readonly', (s) => s.get(clave));
    if (!fila) return null;
    return {
      datos: fila.datos,
      minutosDeAntiguedad: Math.floor((Date.now() - fila.guardadoEn) / 60000),
    };
  } catch {
    return null;
  }
}

// --- Cola de escritura -----------------------------------------------------

export function nuevaClaveIdempotencia() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function encolar(operacion) {
  const registro = {
    idempotencyKey: operacion.idempotencyKey ?? nuevaClaveIdempotencia(),
    metodo: operacion.metodo,
    ruta: operacion.ruta,
    cuerpo: aDatosPlanos(operacion.cuerpo),
    descripcion: operacion.descripcion ?? operacion.ruta,
    encoladaEn: Date.now(),
    intentos: 0,
  };

  await operar(COLA, 'readwrite', (s) => s.put(registro));
  return registro;
}

export function listarCola() {
  return operar(COLA, 'readonly', (s) => s.getAll()).catch(() => []);
}

export function quitarDeCola(idempotencyKey) {
  return operar(COLA, 'readwrite', (s) => s.delete(idempotencyKey)).catch(() => null);
}

export async function marcarIntento(registro, error) {
  await operar(COLA, 'readwrite', (s) =>
    s.put(aDatosPlanos({ ...registro, intentos: (registro.intentos ?? 0) + 1, ultimoError: error ?? null })),
  ).catch(() => null);
}
