-- El nombre, el municipio y el departamento del establecimiento se muestran
-- en la barra lateral y en el encabezado de toda ficha impresa. Se guardaron
-- sin tildes y asi salian impresos.
UPDATE establecimiento
SET nombre       = 'Centro de Salud de Camotán',
    municipio    = 'Camotán',
    departamento = 'Chiquimula'
WHERE municipio = 'Camotan';
