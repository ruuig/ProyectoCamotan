import http from './http';

const consulta = (parametros = {}) => new URLSearchParams(
  Object.entries(parametros).filter(([, v]) => v !== '' && v != null),
).toString();

/**
 * Bodega del centro: ubicaciones, traslados, reportes de los servicios,
 * balance consolidado, semáforo e inventario de cierre (MD/Bodega.md).
 */
export default {
  ubicaciones: (todas = false) => http.get(`/bodega/ubicaciones${todas ? '?todas=true' : ''}`),
  crearUbicacion: (datos) => http.post('/bodega/ubicaciones', datos),
  actualizarUbicacion: (id, datos) => http.patch(`/bodega/ubicaciones/${id}`, datos),

  propuestaLotes: (insumoId, cantidad) => http.get(`/bodega/traslados/propuesta-lotes?${consulta({ insumoId, cantidad })}`),
  distribucion: (parametros) => http.get(`/bodega/distribucion?${consulta(parametros)}`),
  traslados: (parametros) => http.get(`/bodega/traslados?${consulta(parametros)}`),
  traslado: (id) => http.get(`/bodega/traslados/${id}`),
  trasladar: (datos, clave) => http.post('/bodega/traslados', datos, clave ? { 'Idempotency-Key': clave } : undefined),

  estadoReportes: (periodo) => http.get(`/bodega/reportes?${consulta({ periodo })}`),
  reporte: (ubicacionId, periodo) => http.get(`/bodega/reportes/${ubicacionId}/${periodo}`),
  guardarReporte: (ubicacionId, periodo, datos) => http.put(`/bodega/reportes/${ubicacionId}/${periodo}`, datos),
  revisarReporte: (ubicacionId, periodo, observacion) =>
    http.post(`/bodega/reportes/${ubicacionId}/${periodo}/revisar`, { observacion }),

  balance: (parametros) => http.get(`/bodega/balance?${consulta(parametros)}`),
  semaforo: (parametros) => http.get(`/bodega/semaforo?${consulta(parametros)}`),
  inventarioCierre: (parametros) => http.get(`/bodega/inventario-cierre?${consulta(parametros)}`),
  excelBalance: (periodo, orden) => http.descargarArchivo(`/bodega/balance/${periodo}/excel?${consulta({ orden })}`),
  excelBres: (periodo, orden) => http.descargarArchivo(`/bodega/bres/${periodo}/excel?${consulta({ orden })}`),

  ficha: (insumoId) => http.get(`/bodega/insumos/${insumoId}`),
  buscarLotes: (buscar) => http.get(`/bodega/lotes?${consulta({ buscar })}`),
  alias: (insumoId) => http.get(`/bodega/insumos/${insumoId}/alias`),
  agregarAlias: (insumoId, alias) => http.post(`/bodega/insumos/${insumoId}/alias`, { alias }),
  quitarAlias: (insumoId, aliasId) => http.request('DELETE', `/bodega/insumos/${insumoId}/alias/${aliasId}`),
};
