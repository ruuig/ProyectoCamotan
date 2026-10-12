-- Quien vive en una comunidad del catalogo vive en el municipio del centro:
-- se completa la residencia de los ya registrados, sin tocar lo escrito a mano.
UPDATE paciente p
SET municipio_residencia = COALESCE(p.municipio_residencia, e.municipio),
    departamento_residencia = COALESCE(p.departamento_residencia, e.departamento)
FROM establecimiento e
WHERE e.id = p.establecimiento_id
  AND p.lugar_poblado_id IS NOT NULL
  AND (p.municipio_residencia IS NULL OR p.departamento_residencia IS NULL);
