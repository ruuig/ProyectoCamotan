import http from './http';

export default {
  listar(parametros = {}) {
    const query = new URLSearchParams(
      Object.entries(parametros).filter(([, valor]) => valor !== '' && valor != null),
    );
    return http.get(`/pacientes?${query}`);
  },

  obtener: (id) => http.get(`/pacientes/${id}`),
  historial: (id) => http.get(`/pacientes/${id}/historial`),
  crear: (datos) => http.post('/pacientes', datos),
  actualizar: (id, datos) => http.patch(`/pacientes/${id}`, datos),
  abrirEmbarazo: (id, datos) => http.post(`/pacientes/${id}/embarazos`, datos),
  cerrarEmbarazo: (id, motivo) =>
    http.patch(`/pacientes/${id}/embarazos/cerrar`, { motivo }),
  revisarDuplicados: (datos) => http.post('/pacientes/revisar-duplicados', datos),
  // Ficha de papel que sigue (P-570) y quiénes ya tienen una ficha.
  fichaPapel: (parametros) => http.get(`/pacientes/ficha-papel?${new URLSearchParams(Object.entries(parametros).filter(([, v]) => v))}`),
  sugerir: (parametros) => http.get(`/pacientes/sugerir?${new URLSearchParams(parametros)}`),

  // Ficha completa, por secciones.
  ficha: (id) => http.get(`/pacientes/${id}/ficha`),
  guardarSeccion: (id, seccion, datos) => http.put(`/pacientes/${id}/ficha/${seccion}`, { datos }),
  historialSeccion: (id, seccion) => http.get(`/pacientes/${id}/ficha/${seccion}/historial`),
  subirFamiliograma: (id, archivo) => http.subirArchivo(`/pacientes/${id}/archivos/familiograma`, archivo),
  abrirArchivo: (id, archivoId) => http.descargarArchivo(`/pacientes/${id}/archivos/${archivoId}`),

  antropometria: (id) => http.get(`/pacientes/${id}/antropometria`),
  registrarAntropometria: (id, datos) => http.post(`/pacientes/${id}/antropometria`, datos),
  curva: (id, indicador) => http.get(`/pacientes/${id}/curva?indicador=${indicador}`),

  crearAtencion: (datos) => http.post('/atenciones', datos),
  // Una atención abierta por error sale de la cola con su motivo.
  cancelarAtencion: (id, motivo) => http.patch(`/atenciones/${id}/cancelar`, { motivo }),
  registrarPreconsulta: (atencionId, datos) =>
    http.post(`/atenciones/${atencionId}/preconsulta`, datos),

  signosPeligro: () => http.get('/admin/signos-peligro'),

  // Para la preconsulta en la tablet: sin conexion devuelven lo ultimo que se
  // vio en este equipo, en lugar de dejar el formulario con error.
  signosPeligroConCache: async () => (await http.getConCache('/admin/signos-peligro')).datos,
  obtenerConCache: async (id) => (await http.getConCache(`/pacientes/${id}`)).datos,
};
