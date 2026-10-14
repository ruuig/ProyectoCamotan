import http from './http';

/** Control diario de la farmacia: existencia por lote, resumen del día, cierre y devoluciones. */
export default {
  existencias: () => http.get('/farmacia/existencias'),
  dia: (fecha) => http.get(`/farmacia/dia${fecha ? `?fecha=${fecha}` : ''}`),
  cerrarDia: (datos, clave) => http.post('/farmacia/dia/cierre', datos, clave ? { 'Idempotency-Key': clave } : undefined),
  devolver: (datos, clave) => http.post('/farmacia/devoluciones', datos, clave ? { 'Idempotency-Key': clave } : undefined),
  ponerLote: (datos, clave) => http.post('/farmacia/poner-lote', datos, clave ? { 'Idempotency-Key': clave } : undefined),
};
