-- Catalogos oficiales del formulario FOR-SIGSA-3CS version 3.0 (noviembre 2017).
--
-- Los codigos son los del formulario, no una numeracion propia: asi la
-- exportacion a SIGSA no tiene que traducir nada.
--
-- Ojo con escolaridad: su catalogo empieza en 1 para "No aplica", mientras que
-- los demas usan 0. No se puede asumir que 0 siempre significa "no aplica".

CREATE TABLE catalogo_sigsa (
  id       SERIAL PRIMARY KEY,
  catalogo VARCHAR(40)  NOT NULL,
  codigo   VARCHAR(30)  NOT NULL,
  etiqueta VARCHAR(120) NOT NULL,
  orden    INTEGER      NOT NULL DEFAULT 0,
  activo   BOOLEAN      NOT NULL DEFAULT TRUE,
  CONSTRAINT catalogo_sigsa_unico UNIQUE (catalogo, codigo)
);

CREATE INDEX catalogo_sigsa_orden_idx ON catalogo_sigsa (catalogo, orden);

INSERT INTO catalogo_sigsa (catalogo, codigo, etiqueta, orden) VALUES
  -- Sexo
  ('sexo', 'M', 'Masculino', 1),
  ('sexo', 'F', 'Femenino', 2),

  -- Pueblo
  ('pueblo', '1', 'Mestizo o ladino', 1),
  ('pueblo', '2', 'Maya', 2),
  ('pueblo', '3', 'Garífuna', 3),
  ('pueblo', '4', 'Xinca', 4),
  ('pueblo', '5', 'Otros', 5),
  ('pueblo', '6', 'No indica', 6),

  -- Comunidad linguistica (aplica solo cuando el pueblo es Maya)
  ('comunidad_linguistica', '1', 'Achi''', 1),
  ('comunidad_linguistica', '2', 'Akateka', 2),
  ('comunidad_linguistica', '3', 'Awakateka', 3),
  ('comunidad_linguistica', '4', 'Ch''orti''', 4),
  ('comunidad_linguistica', '5', 'Chalchiteka', 5),
  ('comunidad_linguistica', '6', 'Chuj', 6),
  ('comunidad_linguistica', '7', 'Itza''', 7),
  ('comunidad_linguistica', '8', 'Ixil', 8),
  ('comunidad_linguistica', '9', 'Jakalteka', 9),
  ('comunidad_linguistica', '10', 'Kaqchikel', 10),
  ('comunidad_linguistica', '11', 'K''iche''', 11),
  ('comunidad_linguistica', '12', 'Mam', 12),
  ('comunidad_linguistica', '13', 'Mopan', 13),
  ('comunidad_linguistica', '14', 'Poqomam', 14),
  ('comunidad_linguistica', '15', 'Poqomchi''', 15),
  ('comunidad_linguistica', '16', 'Q''anjob''al', 16),
  ('comunidad_linguistica', '17', 'Q''eqchi''', 17),
  ('comunidad_linguistica', '18', 'Sakapulteka', 18),
  ('comunidad_linguistica', '19', 'Sipakapensa', 19),
  ('comunidad_linguistica', '20', 'Tektiteka', 20),
  ('comunidad_linguistica', '21', 'Tz''utujil', 21),
  ('comunidad_linguistica', '22', 'Uspanteka', 22),
  ('comunidad_linguistica', '23', 'No indica', 23),

  -- Discapacidad
  ('discapacidad', '0', 'No aplica', 1),
  ('discapacidad', '1', 'Física', 2),
  ('discapacidad', '2', 'Mental', 3),
  ('discapacidad', '3', 'Visual', 4),
  ('discapacidad', '4', 'Auditiva', 5),
  ('discapacidad', '5', 'Otro', 6),

  -- Orientacion sexual
  ('orientacion_sexual', '0', 'No aplica', 1),
  ('orientacion_sexual', '1', 'Heterosexual', 2),
  ('orientacion_sexual', '2', 'Bisexual', 3),
  ('orientacion_sexual', '3', 'Homosexual', 4),
  ('orientacion_sexual', '4', 'Trans', 5),
  ('orientacion_sexual', '5', 'Otro', 6),

  -- Escolaridad: este catalogo empieza en 1 para "No aplica"
  ('escolaridad', '1', 'No aplica', 1),
  ('escolaridad', '2', 'Preprimaria', 2),
  ('escolaridad', '3', 'Primaria', 3),
  ('escolaridad', '4', 'Básicos', 4),
  ('escolaridad', '5', 'Diversificado', 5),
  ('escolaridad', '6', 'Universidad', 6),
  ('escolaridad', '7', 'Ninguno', 7),
  ('escolaridad', '8', 'Otro', 8),
  ('escolaridad', '9', 'No indica', 9),

  -- Profesion, oficio o condicion
  ('profesion_oficio', '0', 'No aplica', 1),
  ('profesion_oficio', '1', 'Ama de casa', 2),
  ('profesion_oficio', '2', 'Mujer trabajadora sexual', 3),
  ('profesion_oficio', '3', 'Hombre trabajador sexual', 4),
  ('profesion_oficio', '4', 'Persona privada de libertad', 5),
  ('profesion_oficio', '5', 'Joven en riesgo social', 6),
  ('profesion_oficio', '6', 'Uniformados', 7),
  ('profesion_oficio', '7', 'Migrantes', 8),
  ('profesion_oficio', '8', 'Otros', 9),

  -- Tipo de consulta
  ('tipo_consulta', '1', 'Primera consulta', 1),
  ('tipo_consulta', '2', 'Reconsulta', 2),
  ('tipo_consulta', '3', 'Interconsulta', 3),
  ('tipo_consulta', '4', 'Emergencia', 4),

  -- Control
  ('control', '0', 'No aplica', 1),
  ('control', '1', 'Prenatal', 2),
  ('control', '2', 'Puerperio', 3),
  ('control', '3', 'Planificación familiar', 4),
  ('control', '4', 'Profilaxia sexual', 5),
  ('control', '5', 'Papanicolaou', 6),
  ('control', '6', 'IVAA', 7),

  -- Referencia: viene
  ('referencia_viene', '0', 'No aplica', 1),
  ('referencia_viene', '1', 'Viene referido', 2),
  ('referencia_viene', '2', 'Viene contrarreferido', 3),

  -- Referencia: fue
  ('referencia_fue', '0', 'No aplica', 1),
  ('referencia_fue', '1', 'Fue referido', 2),
  ('referencia_fue', '2', 'Fue contrarreferido', 3),

  -- Lugar de notificacion
  ('lugar_notificacion', '0', 'No aplica', 1),
  ('lugar_notificacion', '1', 'Ministerio Público', 2),
  ('lugar_notificacion', '2', 'Procuraduría General de la Nación', 3),
  ('lugar_notificacion', '3', 'Policía Nacional Civil', 4),

  -- Categoria del establecimiento
  ('categoria_establecimiento', 'CCS', 'CCS', 1),
  ('categoria_establecimiento', 'PS', 'PS', 2),
  ('categoria_establecimiento', 'CS', 'CS', 3),
  ('categoria_establecimiento', 'CAP', 'CAP', 4),
  ('categoria_establecimiento', 'CAIMI', 'CAIMI', 5),
  ('categoria_establecimiento', 'OTRO', 'Otro', 6),

  -- Estado civil (el formulario no le asigna codigo numerico)
  ('estado_civil', 'soltero', 'Soltero/a', 1),
  ('estado_civil', 'casado', 'Casado/a', 2),
  ('estado_civil', 'unido', 'Unido/a', 3),
  ('estado_civil', 'viudo', 'Viudo/a', 4),
  ('estado_civil', 'otro', 'Otro', 5),

  -- Parentesco del responsable
  ('parentesco', 'madre', 'Madre', 1),
  ('parentesco', 'padre', 'Padre', 2),
  ('parentesco', 'abuelo', 'Abuelo/a', 3),
  ('parentesco', 'hermano', 'Hermano/a', 4),
  ('parentesco', 'tio', 'Tío/a', 5),
  ('parentesco', 'otro_familiar', 'Otro familiar', 6),
  ('parentesco', 'tutor_legal', 'Tutor legal', 7),
  ('parentesco', 'otro', 'Otro', 8),

  -- Categoria de lugar poblado
  ('categoria_lugar', 'aldea', 'Aldea', 1),
  ('categoria_lugar', 'caserio', 'Caserío', 2),
  ('categoria_lugar', 'barrio', 'Barrio', 3),
  ('categoria_lugar', 'colonia', 'Colonia', 4),
  ('categoria_lugar', 'otro', 'Otro', 5);

-- Lugares poblados del municipio.
CREATE TABLE lugar_poblado (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER      NOT NULL REFERENCES establecimiento (id),
  nombre             VARCHAR(120) NOT NULL,
  categoria          VARCHAR(20)  NOT NULL,
  territorio         VARCHAR(80),
  sector             VARCHAR(80),
  activo             BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT lugar_poblado_unico UNIQUE (establecimiento_id, nombre),
  CONSTRAINT lugar_poblado_categoria_check
    CHECK (categoria IN ('aldea', 'caserio', 'barrio', 'colonia', 'otro'))
);

CREATE INDEX lugar_poblado_activo_idx ON lugar_poblado (establecimiento_id, activo);

-- Se siembra solo con las comunidades que ya existen en los pacientes, tal
-- como estan escritas. No se inventan nombres, categorias, territorios ni
-- sectores del municipio: eso se carga por CSV desde Administracion.
INSERT INTO lugar_poblado (establecimiento_id, nombre, categoria)
SELECT DISTINCT establecimiento_id, comunidad, 'otro'
FROM paciente
WHERE comunidad IS NOT NULL AND TRIM(comunidad) <> ''
ON CONFLICT (establecimiento_id, nombre) DO NOTHING;
