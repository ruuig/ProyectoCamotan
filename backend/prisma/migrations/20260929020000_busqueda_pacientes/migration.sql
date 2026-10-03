-- Busqueda de pacientes tolerante a como se busca en la vida real.
--
-- Hoy solo encuentra por coincidencia exacta. En el establecimiento se busca
-- "ramires" por "Ramírez", se escribe sin tildes, y muchas veces se pregunta
-- por el nombre de la madre en vez del de la nina.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Columna generada con el nombre normalizado: sin tildes y en minusculas.
-- Se calcula sola en cada escritura, asi no hay que recordar actualizarla.
--
-- unaccent no es IMMUTABLE por defecto (depende del diccionario instalado),
-- y una columna generada lo exige. Se envuelve en una funcion propia marcada
-- como inmutable, que es la practica habitual para este caso.
CREATE OR REPLACE FUNCTION sin_tildes(texto text)
RETURNS text AS $$
  SELECT LOWER(public.unaccent('public.unaccent', COALESCE(texto, '')));
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

ALTER TABLE paciente
  ADD COLUMN nombre_busqueda text
  GENERATED ALWAYS AS (sin_tildes(apellidos || ' ' || nombres)) STORED;

ALTER TABLE paciente
  ADD COLUMN responsable_busqueda text
  GENERATED ALWAYS AS (sin_tildes(COALESCE(responsable_nombre, ''))) STORED;

-- El indice de trigramas que ya existia no quitaba las tildes, asi que
-- "ramires" no encontraba "Ramírez". Se reemplaza por el de la columna
-- normalizada.
DROP INDEX IF EXISTS paciente_nombre_trgm_idx;

-- Indices de trigramas: son los que permiten tolerar errores de escritura.
CREATE INDEX paciente_nombre_trgm_idx
  ON paciente USING GIN (nombre_busqueda gin_trgm_ops);

CREATE INDEX paciente_responsable_trgm_idx
  ON paciente USING GIN (responsable_busqueda gin_trgm_ops);

-- Busqueda por numeros: CUI, expediente, expediente de papel, telefono y DPI
-- del responsable. Son igualdades o prefijos, no similitud.
CREATE INDEX paciente_expediente_papel_idx ON paciente (establecimiento_id, expediente_papel);
CREATE INDEX paciente_telefono_idx ON paciente (establecimiento_id, telefono);
CREATE INDEX paciente_responsable_dpi_idx ON paciente (establecimiento_id, responsable_dpi);
