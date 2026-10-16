/**
 * Encabezado de los formularios del MSPAS: Área de Salud, Distrito de Salud,
 * municipio y servicio. El área y el distrito se configuran en
 * Administración > Centro; mientras no se llenen, se usan el departamento y
 * el municipio, que en la mayoría de los casos coinciden.
 */
function encabezadoEstablecimiento(est) {
  if (!est) return { areaSalud: '', distrito: '', municipio: '', servicio: '' };
  return {
    areaSalud: est.areaSalud || est.departamento,
    distrito: est.distritoSalud || est.municipio,
    municipio: est.municipio,
    servicio: est.nombre,
  };
}

module.exports = { encabezadoEstablecimiento };
