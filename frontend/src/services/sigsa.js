import http from './http';

const consulta = (p) => new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v != null)).toString();

/** Formularios del SIGSA que genera el sistema. */
export default {
  medicos: () => http.get('/sigsa/medicos'),
  tresCs: (p) => http.get(`/sigsa/3cs?${consulta(p)}`),
  excelTresCs: (p) => http.descargarArchivo(`/sigsa/3cs/excel?${consulta(p)}`),
};
