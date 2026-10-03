-- Expediente correlativo legible por establecimiento y anio (AAAA-NNNNN).
--
-- Antes el expediente lo escribia a mano quien registraba, con un sufijo al
-- azar. Ahora lo genera el sistema, y el numero del expediente fisico de los
-- pacientes que ya existian se conserva aparte para poder cruzarlos.

-- 1. Numero del expediente en papel.
ALTER TABLE paciente ADD COLUMN expediente_papel VARCHAR(30);

-- 2. Contador por establecimiento y anio. El incremento atomico sobre esta
--    fila es lo que evita que dos registros simultaneos tomen el mismo numero.
CREATE TABLE correlativo_expediente (
  establecimiento_id INTEGER     NOT NULL REFERENCES establecimiento (id),
  anio               INTEGER     NOT NULL,
  ultimo             INTEGER     NOT NULL DEFAULT 0,
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (establecimiento_id, anio),
  CONSTRAINT correlativo_expediente_anio_check CHECK (anio BETWEEN 2000 AND 2100),
  CONSTRAINT correlativo_expediente_ultimo_check CHECK (ultimo >= 0)
);

-- 3. El expediente anterior pasa a ser el del papel.
UPDATE paciente SET expediente_papel = expediente WHERE expediente_papel IS NULL;

-- 4. Correlativo nuevo, por establecimiento y anio de creacion, en orden de
--    registro. No hay riesgo de choque con el valor viejo: el formato nuevo
--    (2026-00001) no coincide con el anterior.
WITH numerados AS (
  SELECT
    id,
    EXTRACT(YEAR FROM creado_en)::int AS anio,
    ROW_NUMBER() OVER (
      PARTITION BY establecimiento_id, EXTRACT(YEAR FROM creado_en)
      ORDER BY creado_en, id
    ) AS posicion
  FROM paciente
)
UPDATE paciente p
SET expediente = n.anio || '-' || LPAD(n.posicion::text, 5, '0')
FROM numerados n
WHERE p.id = n.id;

-- 5. El contador arranca donde quedo la migracion, para no repetir numeros.
INSERT INTO correlativo_expediente (establecimiento_id, anio, ultimo)
SELECT
  establecimiento_id,
  EXTRACT(YEAR FROM creado_en)::int AS anio,
  COUNT(*)                          AS ultimo
FROM paciente
GROUP BY establecimiento_id, EXTRACT(YEAR FROM creado_en);
