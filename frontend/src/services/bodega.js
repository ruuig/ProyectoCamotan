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

  // Requisición Despacho de Almacén (FOR-ASE-01).
  requisiciones: (parametros) => http.get(`/bodega/requisiciones?${consulta(parametros)}`),
  requisicion: (id) => http.get(`/bodega/requisiciones/${id}`),
  crearRequisicion: (datos, clave) => http.post('/bodega/requisiciones', datos, clave ? { 'Idempotency-Key': clave } : undefined),
  actualizarRequisicion: (id, datos) => http.put(`/bodega/requisiciones/${id}`, datos),
  autorizarRequisicion: (id, renglones) => http.post(`/bodega/requisiciones/${id}/autorizar`, { renglones }),
  despacharRequisicion: (id, datos, clave) => http.post(`/bodega/requisiciones/${id}/despachar`, datos, clave ? { 'Idempotency-Key': clave } : undefined),
  recibirRequisicion: (id, datos, clave) => http.post(`/bodega/requisiciones/${id}/recibir`, datos, clave ? { 'Idempotency-Key': clave } : undefined),
  anularRequisicion: (id, motivo) => http.post(`/bodega/requisiciones/${id}/anular`, { motivo }),
  kardex: (parametros) => http.get(`/bodega/kardex?${consulta(parametros)}`),

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
  // Si el médico lo ve en su lista para recetar.
  cambiarPrescribible: (insumoId, prescribible) => http.patch(`/bodega/insumos/${insumoId}/prescribible`, { prescribible }),
  alias: (insumoId) => http.get(`/bodega/insumos/${insumoId}/alias`),
  agregarAlias: (insumoId, alias) => http.post(`/bodega/insumos/${insumoId}/alias`, { alias }),
  quitarAlias: (insumoId, aliasId) => http.request('DELETE', `/bodega/insumos/${insumoId}/alias/${aliasId}`),
};
