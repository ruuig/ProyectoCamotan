import http from './http';

/**
 * Inventario y logística según el MSPAS.
 */
export default {
  // --- Catálogo de insumos -------------------------------------------------
  insumos(parametros = {}) {
    const query = new URLSearchParams(
      Object.entries(parametros).filter(([, v]) => v !== '' && v != null),
    );
    return http.get(`/insumos?${query}`);
  },

  crearInsumo: (datos) => http.post('/insumos', datos),
  cobertura: (id) => http.get(`/insumos/${id}/cobertura`),
  recibirLote: (insumoId, datos) => http.post(`/insumos/${insumoId}/lotes`, datos),

  // --- Catálogos y configuración -------------------------------------------
  catalogos: () => http.get('/inventario/catalogos'),
  configuracion: () => http.get('/inventario/configuracion'),
  guardarConfiguracion: (datos) => http.patch('/inventario/configuracion', datos),

  // --- Abastecimiento ------------------------------------------------------
  abastecimiento(parametros = {}) {
    const query = new URLSearchParams(
      Object.entries(parametros).filter(([, v]) => v !== '' && v != null),
    );
    return http.get(`/inventario/abastecimiento?${query}`);
  },
  detalleAbastecimiento: (id) => http.get(`/inventario/abastecimiento/${id}`),
  verificarSaldos: () => http.get('/inventario/verificar-saldos'),

  // --- Lotes ---------------------------------------------------------------
  trazabilidad: (loteId) => http.get(`/lotes/${loteId}/trazabilidad`),
  cambiarEstadoLote: (loteId, datos) => http.patch(`/lotes/${loteId}/estado`, datos),
  tarjetaControl: (insumoId) => http.get(`/insumos/${insumoId}/tarjeta-control`),
  insumosDePaciente: (pacienteId) => http.get(`/pacientes/${pacienteId}/insumos`),

  // --- Dispensación --------------------------------------------------------
  pendientes: () => http.get('/dispensaciones/pendientes'),
  dispensar: (datos) => http.post('/dispensaciones', datos),
  porFirmar: () => http.get('/dispensaciones/por-firmar'),
  registrarConstancia: (datos) => http.post('/dispensaciones/constancias', datos),
  sigsa4: (periodo) => http.get(`/dispensaciones/sigsa4?periodo=${periodo}`),
  anular: (id) => http.patch(`/dispensaciones/${id}/anular`),

  // --- Movimientos ---------------------------------------------------------
  reajustar: (datos) => http.post('/inventario/reajustes', datos),
  usoInterno: (datos) => http.post('/inventario/uso-interno', datos),
  diferencias: () => http.get('/inventario/diferencias'),

  // --- Inventario físico ---------------------------------------------------

  // --- BRES ----------------------------------------------------------------
  vistaPreviaBres: (periodo) => http.get(`/inventario/bres/${periodo}/vista-previa`),
  bresDe: (periodo) => http.get(`/inventario/bres/${periodo}`),
  generarBres: (datos) => http.post('/inventario/bres', datos),
  cerrarBres: (periodo) => http.post(`/inventario/bres/${periodo}/cerrar`),
  demandaDiaria: (periodo) => http.get(`/inventario/demanda-diaria/${periodo}`),

  // --- Retiro sanitario ----------------------------------------------------
  retiros: () => http.get('/inventario/retiros'),
  registrarRetiro: (datos) => http.post('/inventario/retiros', datos),
  retiro: (id) => http.get(`/inventario/retiros/${id}`),
  marcarLocalizacion: (id, datos) => http.patch(`/inventario/retiros/pacientes/${id}`, datos),
  cerrarRetiro: (id) => http.post(`/inventario/retiros/${id}/cerrar`),

  // --- Oficio de baja ------------------------------------------------------
  candidatosBaja: () => http.get('/inventario/bajas/candidatos'),
  oficiosBaja: () => http.get('/inventario/bajas'),
  solicitarBaja: (datos) => http.post('/inventario/bajas', datos),
  oficioBaja: (id) => http.get(`/inventario/bajas/${id}`),
  autorizarBaja: (id, autorizacion) =>
    http.post(`/inventario/bajas/${id}/autorizar`, { autorizacion }),
  aplicarBaja: (id) => http.post(`/inventario/bajas/${id}/aplicar`),
  anularBaja: (id) => http.post(`/inventario/bajas/${id}/anular`),
};
