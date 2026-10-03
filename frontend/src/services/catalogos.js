import http from './http';

export default {
  // Todos los catalogos del formulario FOR-SIGSA-3CS, o uno solo.
  listar: (catalogo) => http.get(`/catalogos${catalogo ? `?catalogo=${catalogo}` : ''}`),
  lugares: (buscar = '') =>
    http.get(`/catalogos/lugares${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''}`),
  crearLugar: (datos) => http.post('/catalogos/lugares', datos),
  importarLugares: (csv) => http.post('/catalogos/lugares/importar', { csv }),
  importarCie10: (csv) => http.post('/catalogos/cie10/importar', { csv }),
};
