import http from './http';

export default {
  cola: () => http.get('/atenciones/cola'),
  resumenDia: () => http.get('/atenciones/resumen-dia'),
  siguiente: () => http.get('/atenciones/siguiente'),
  obtener: (id) => http.get(`/atenciones/${id}`),
  cambiarEstado: (id, estado, motivo) =>
    http.patch(`/atenciones/${id}/estado`, { estado, ...(motivo ? { motivo } : {}) }),
  cerrarConsulta: (id, datos) => http.patch(`/atenciones/${id}/consulta`, datos),
  // El motivo solo hace falta si se reemplaza un código que ya estaba.
  codificar: (id, diagnosticoCie, motivo) =>
    http.patch(`/atenciones/${id}/codificacion`, {
      diagnosticoCie,
      ...(motivo ? { motivo } : {}),
    }),

  // Corregir algo ya cerrado no sobrescribe: deja constancia.
  corregir: (id, datos) => http.post(`/atenciones/${id}/correcciones`, datos),
  correcciones: (id) => http.get(`/atenciones/${id}/correcciones`),
  corregirSignoVital: (id, datos) => http.patch(`/atenciones/${id}/preconsulta`, datos),
  prescribir: (id, datos) => http.post(`/atenciones/${id}/prescripcion`, datos),
  insumos: () => http.get('/insumos'),
  sugerenciaTipo: (id, { cie, descripcion }) =>
    http.get(`/atenciones/${id}/sugerencia-tipo?${new URLSearchParams(
      Object.entries({ cie, descripcion }).filter(([, v]) => v),
    )}`),
  buscarDiagnostico: (q) => http.get(`/catalogos/cie10?q=${encodeURIComponent(q)}`),
};
