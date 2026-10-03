-- Ficha completa del paciente, edad aproximada y episodio de embarazo.
--
-- Tres cambios que van juntos porque tocan el mismo registro:
--   1. El registro se parte en dos momentos: lo minimo para atender, y el
--      resto cuando haya tiempo. Por eso todo lo nuevo es opcional.
--   2. Quien no conoce su fecha de nacimiento declara su edad y el sistema
--      calcula una fecha aproximada, marcada como tal.
--   3. El embarazo deja de ser una casilla permanente del paciente.

-- 1. Comunidad como catalogo, sin perder el texto que ya estaba escrito.
ALTER TABLE paciente ADD COLUMN lugar_poblado_id INTEGER REFERENCES lugar_poblado (id);

-- 2. Edad aproximada.
ALTER TABLE paciente ADD COLUMN fecha_nacimiento_estimada BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Ficha completa. Todo opcional: el registro rapido no lo pide.
ALTER TABLE paciente
  ADD COLUMN departamento_nacimiento VARCHAR(80),
  ADD COLUMN municipio_nacimiento    VARCHAR(80),
  ADD COLUMN domicilio               VARCHAR(200),
  ADD COLUMN municipio_residencia    VARCHAR(80),
  ADD COLUMN pueblo                  VARCHAR(10),
  ADD COLUMN comunidad_linguistica   VARCHAR(10),
  ADD COLUMN migrante                BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN origen_migracion        VARCHAR(120),
  ADD COLUMN escolaridad             VARCHAR(10),
  ADD COLUMN estudia_actualmente     BOOLEAN,
  ADD COLUMN desercion_escolar       BOOLEAN,
  ADD COLUMN ultimo_grado_aprobado   VARCHAR(60),
  ADD COLUMN anios_repetidos         INTEGER,
  ADD COLUMN motivo_no_estudia       VARCHAR(200),
  ADD COLUMN trabaja                 BOOLEAN,
  ADD COLUMN profesion_oficio        VARCHAR(10),
  ADD COLUMN estado_civil            VARCHAR(20),
  ADD COLUMN religion                VARCHAR(80),
  ADD COLUMN correo                  VARCHAR(120),
  ADD COLUMN redes_sociales          VARCHAR(200),
  ADD COLUMN discapacidad            VARCHAR(10),
  ADD COLUMN responsable_nombre      VARCHAR(160),
  ADD COLUMN responsable_parentesco  VARCHAR(20),
  ADD COLUMN responsable_telefono    VARCHAR(20),
  ADD COLUMN responsable_dpi         VARCHAR(20),
  ADD COLUMN orientacion_sexual      VARCHAR(10),
  ADD COLUMN identidad_genero        VARCHAR(40),
  ADD COLUMN antecedente_violencia   TEXT,
  ADD COLUMN antecedente_maltrato    TEXT,
  ADD COLUMN ideas_suicidas          TEXT,
  ADD COLUMN problemas_judiciales    TEXT,
  ADD COLUMN ficha_completa          BOOLEAN NOT NULL DEFAULT FALSE;

-- La comunidad linguistica solo tiene sentido cuando el pueblo es Maya (2).
ALTER TABLE paciente
  ADD CONSTRAINT paciente_comunidad_linguistica_check
  CHECK (comunidad_linguistica IS NULL OR pueblo = '2');

-- 4. Episodio de embarazo.
CREATE TABLE episodio_embarazo (
  id                   SERIAL PRIMARY KEY,
  paciente_id          INTEGER     NOT NULL REFERENCES paciente (id) ON DELETE CASCADE,
  fecha_ultima_regla   DATE,
  semanas_al_registrar INTEGER,
  fecha_probable_parto DATE,
  estado               VARCHAR(20) NOT NULL DEFAULT 'activo',
  abierto_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrado_en           TIMESTAMPTZ,
  motivo_cierre        VARCHAR(200),
  CONSTRAINT episodio_embarazo_estado_check CHECK (estado IN ('activo', 'finalizado')),
  CONSTRAINT episodio_embarazo_semanas_check
    CHECK (semanas_al_registrar IS NULL OR semanas_al_registrar BETWEEN 0 AND 45)
);

CREATE INDEX episodio_embarazo_paciente_idx ON episodio_embarazo (paciente_id, estado);

-- Una paciente no puede tener dos embarazos activos a la vez.
CREATE UNIQUE INDEX episodio_embarazo_activo_unico
  ON episodio_embarazo (paciente_id) WHERE estado = 'activo';

-- 5. Las pacientes con la casilla marcada pasan a un episodio activo con
--    semanas desconocidas, para revisarlas. No se inventa la fecha de ultima
--    regla ni las semanas: no se sabe.
INSERT INTO episodio_embarazo (paciente_id, estado, abierto_en, motivo_cierre)
SELECT DISTINCT c.paciente_id, 'activo', COALESCE(c.vigente_desde, NOW()), NULL
FROM condicion_paciente c
WHERE c.tipo = 'embarazo' AND c.vigente_hasta IS NULL
ON CONFLICT DO NOTHING;

-- La condicion deja de vivir en el paciente: ahora la da el episodio.
UPDATE condicion_paciente
SET vigente_hasta = NOW()
WHERE tipo = 'embarazo' AND vigente_hasta IS NULL;

-- 6. Se enlaza la comunidad escrita a mano con el catalogo, comparando sin
--    tildes ni mayusculas.
UPDATE paciente p
SET lugar_poblado_id = l.id
FROM lugar_poblado l
WHERE l.establecimiento_id = p.establecimiento_id
  AND l.sector IS NULL
  AND LOWER(TRANSLATE(l.nombre, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'))
      = LOWER(TRANSLATE(p.comunidad, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'))
  AND p.lugar_poblado_id IS NULL;

-- 7. Los expedientes que ya existen quedan marcados como incompletos: les
--    falta todo lo de la ficha completa.
UPDATE paciente SET ficha_completa = FALSE;
