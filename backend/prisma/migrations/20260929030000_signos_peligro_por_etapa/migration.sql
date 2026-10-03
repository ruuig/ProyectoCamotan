-- Signos de peligro por etapa de vida.
--
-- Cada ficha del MSPAS trae su propia lista. Hasta ahora la tabla tenia una
-- sola, mezclada, asi que a un adulto se le ofrecian signos de nineza.
--
-- Fuentes: AII_015 (ninez) y AII_017 (persona adulta y mayor), publicadas por
-- la USAC. La lista de la ficha de adolescente (AII_016) no esta en la capa
-- de texto del PDF y NO se inventa: esa etapa queda sin lista propia y usa la
-- de adulto hasta que se confirme con el establecimiento.

ALTER TABLE signo_peligro ADD COLUMN etapa VARCHAR(30);

COMMENT ON COLUMN signo_peligro.etapa IS
  'Etapa de vida a la que aplica el signo. NULL = aplica a todas.';

-- Los signos que ya existian aplican a la ninez, que es de donde salieron
-- (protocolo AIEPI).
UPDATE signo_peligro
SET etapa = 'lactante_ninez'
WHERE grupo_etario IN ('menor_5', 'todos') AND etapa IS NULL;

UPDATE signo_peligro SET etapa = NULL WHERE grupo_etario = 'embarazada';

-- Signos de la ficha de persona adulta y persona mayor (AII_017).
INSERT INTO signo_peligro
  (establecimiento_id, codigo, descripcion, grupo_etario, gravedad_sugerida, etapa, activo, orden)
SELECT e.id, v.codigo, v.descripcion, 'todos', 'urgente', 'adulto', TRUE, v.orden
FROM establecimiento e
CROSS JOIN (VALUES
  ('ad_dificultad_resp', 'Dificultad respiratoria', 1),
  ('ad_confusion',       'Confusión mental', 2),
  ('ad_precordial',      'Dolor u opresión precordial', 3),
  ('ad_dolor_abdominal', 'Dolor abdominal', 4),
  ('ad_cefalea',         'Cefalea o dolor de cabeza intenso', 5),
  ('ad_vomitos',         'Vómitos', 6),
  ('ad_deshidratacion',  'Deshidratación', 7),
  ('ad_inconciencia',    'Inconciencia', 8),
  ('ad_hipotermia',      'Hipotermia', 9)
) AS v(codigo, descripcion, orden)
ON CONFLICT (establecimiento_id, codigo) DO NOTHING;

-- Los mismos aplican a la persona mayor: es la misma ficha.
INSERT INTO signo_peligro
  (establecimiento_id, codigo, descripcion, grupo_etario, gravedad_sugerida, etapa, activo, orden)
SELECT establecimiento_id, 'pm_' || SUBSTRING(codigo FROM 4), descripcion,
       grupo_etario, gravedad_sugerida, 'persona_mayor', activo, orden
FROM signo_peligro
WHERE etapa = 'adulto'
ON CONFLICT (establecimiento_id, codigo) DO NOTHING;

CREATE INDEX signo_peligro_etapa_idx ON signo_peligro (establecimiento_id, etapa, activo);
