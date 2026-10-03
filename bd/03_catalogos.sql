-- ============================================================================
-- Script 03: catalogos iniciales
--   psql "$DATABASE_URL" -f bd/03_catalogos.sql
--
-- Es idempotente: se puede volver a ejecutar sin duplicar filas.
--
-- NO crea usuarios. Las contrasenas se hashean con bcrypt costo 12 y eso se
-- hace en prisma/seed.js, no en SQL. Este script deja lista la parte que no
-- depende de secretos.
-- ============================================================================

BEGIN;

-- ATENCION: el codigo institucional MSPAS es un valor placeholder. Sustituyelo
-- por el codigo real del Centro de Salud de Camotan antes de produccion, y
-- confirma el tipo ('centro_salud_a' o 'centro_salud_b') con el director.
INSERT INTO establecimiento (codigo, nombre, municipio, departamento, tipo)
VALUES ('PENDIENTE-CAMOTAN', 'Centro de Salud de Camotan', 'Camotan', 'Chiquimula', 'centro_salud_b')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO clinica (establecimiento_id, nombre, disponible, activa)
SELECT e.id, 'Clinica 1', TRUE, TRUE
FROM establecimiento e
WHERE e.codigo = 'PENDIENTE-CAMOTAN'
  AND NOT EXISTS (SELECT 1 FROM clinica c WHERE c.establecimiento_id = e.id);

-- Signos de peligro segun la estrategia AIEPI del MSPAS.
INSERT INTO signo_peligro (establecimiento_id, codigo, descripcion, grupo_etario, gravedad_sugerida, orden)
SELECT e.id, s.codigo, s.descripcion, s.grupo_etario, s.gravedad_sugerida, s.orden
FROM establecimiento e
CROSS JOIN (VALUES
  ('conv',             'Convulsiones',                        'todos',        'urgente',   1),
  ('no_bebe',          'No puede beber ni mamar',             'menor_5',      'urgente',   2),
  ('vomita_todo',      'Vomita todo lo que ingiere',          'menor_5',      'urgente',   3),
  ('letargico',        'Letargico o inconsciente',            'todos',        'urgente',   4),
  ('tiraje',           'Tiraje subcostal',                    'menor_5',      'urgente',   5),
  ('estridor',         'Estridor en reposo',                  'menor_5',      'urgente',   6),
  ('deshidratacion',   'Signos de deshidratacion grave',      'todos',        'urgente',   7),
  ('sangrado',         'Sangrado activo',                     'todos',        'urgente',   8),
  ('fiebre_alta',      'Fiebre mayor a 39 grados C',          'todos',        'moderado',  9),
  ('dificultad_resp',  'Dificultad respiratoria',             'todos',        'urgente',  10),
  ('edema',            'Edema en ambos pies',                 'menor_5',      'urgente',  11),
  ('sangrado_vaginal', 'Sangrado vaginal',                    'embarazada',   'urgente',  12),
  ('cefalea_severa',   'Cefalea severa con vision borrosa',   'embarazada',   'urgente',  13),
  ('dolor_pecho',      'Dolor toracico',                      'adulto_mayor', 'urgente',  14)
) AS s(codigo, descripcion, grupo_etario, gravedad_sugerida, orden)
WHERE e.codigo = 'PENDIENTE-CAMOTAN'
ON CONFLICT (establecimiento_id, codigo) DO NOTHING;

COMMIT;

-- Verificacion rapida
SELECT 'establecimientos' AS tabla, COUNT(*) FROM establecimiento
UNION ALL SELECT 'clinicas',  COUNT(*) FROM clinica
UNION ALL SELECT 'signos',    COUNT(*) FROM signo_peligro;
