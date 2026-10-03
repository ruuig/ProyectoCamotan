import http from './http';

export default {
  panel: (rol, periodo) =>
    http.get(`/indicadores/panel/${rol}${periodo ? `?periodo=${periodo}` : ''}`),
  series: () => http.get('/indicadores/series'),
  alertas: (filtros = {}) => {
    const query = new URLSearchParams(
      Object.entries(filtros).filter(([, v]) => v !== '' && v != null),
    );
    return http.get(`/indicadores/alertas?${query}`);
  },
  // Registrar la gestion no cierra la alerta: solo deja constancia de que
  // alguien ya actuo. La cierra el sistema cuando la causa desaparece.
  gestionarAlerta: (id, accion) =>
    http.patch(`/indicadores/alertas/${id}/gestion`, { accion }),
  codificar: (id, diagnosticoCie) =>
    http.patch(`/atenciones/${id}/codificacion`, { diagnosticoCie }),
  consolidado: (mes) => http.get(`/indicadores/consolidado${mes ? `?mes=${mes}` : ''}`),
};
