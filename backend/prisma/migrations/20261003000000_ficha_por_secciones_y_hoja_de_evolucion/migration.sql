-- Reparto de la ficha clinica entre preconsulta y medico.
--
-- Preconsulta pasa al sistema toda la ficha de papel del paciente: ademas de
-- la identificacion, los antecedentes, la alimentacion y estilos de vida, la
-- vacunacion y el familiograma. El medico llena la hoja de evolucion de cada
-- visita (MC, HE, EF, IC, Tx) y los datos del SIGSA 3CS.

-- --- Secciones de la ficha del paciente ------------------------------------
-- Una fila por paciente y seccion. Los campos de cada seccion estan definidos
-- en el codigo (fichaSecciones.service.js, transcritos de MD/fichas.md) y se
-- validan con Zod al guardar; aqui se guardan como JSONB para que un cambio
-- del formulario del MSPAS no exija una migracion por casilla.
CREATE TABLE seccion_paciente (
  id               SERIAL PRIMARY KEY,
  paciente_id      INTEGER NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  seccion          VARCHAR(40) NOT NULL,
  datos            JSONB NOT NULL DEFAULT '{}'::jsonb,
  actualizado_por  INTEGER NOT NULL REFERENCES usuario(id),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT seccion_paciente_unica UNIQUE (paciente_id, seccion)
);

-- --- Historial de cambios de la ficha --------------------------------------
-- Cada cambio de un dato del paciente guarda quien, cuando y el valor
-- anterior. Incluye la identificacion, que vive en columnas de paciente.
CREATE TABLE cambio_ficha (
  id              SERIAL PRIMARY KEY,
  paciente_id     INTEGER NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  seccion         VARCHAR(40) NOT NULL,
  campo           VARCHAR(60) NOT NULL,
  valor_anterior  JSONB,
  valor_nuevo     JSONB,
  sensible        BOOLEAN NOT NULL DEFAULT false,
  usuario_id      INTEGER NOT NULL REFERENCES usuario(id),
  registrado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cambio_ficha_paciente_seccion ON cambio_ficha (paciente_id, seccion, registrado_en DESC);

-- --- Archivos adjuntos del paciente (familiograma) ---------------------------
CREATE TABLE archivo_paciente (
  id          SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  tipo        VARCHAR(30) NOT NULL,
  nombre      VARCHAR(200) NOT NULL,
  tipo_mime   VARCHAR(60) NOT NULL,
  tamano      INTEGER NOT NULL,
  contenido   BYTEA NOT NULL,
  subido_por  INTEGER NOT NULL REFERENCES usuario(id),
  subido_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT archivo_paciente_tipo_check CHECK (tipo IN ('familiograma')),
  CONSTRAINT archivo_paciente_mime_check CHECK (tipo_mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT archivo_paciente_tamano_check CHECK (tamano > 0 AND tamano <= 8388608)
);
CREATE INDEX archivo_paciente_paciente ON archivo_paciente (paciente_id, tipo);

-- --- "Nunca se asume No" -------------------------------------------------------
-- Migrante era Si/No con "No" por defecto: un paciente al que nunca se le
-- pregunto quedaba como no migrante. Ahora vacio es "sin registrar".
ALTER TABLE paciente ALTER COLUMN migrante DROP DEFAULT;
ALTER TABLE paciente ALTER COLUMN migrante DROP NOT NULL;
-- Los que nunca dijeron que si no se sabe si migraron.
UPDATE paciente SET migrante = NULL WHERE migrante = false AND origen_migracion IS NULL;

-- --- Hoja de evolucion del medico ------------------------------------------------
ALTER TABLE atencion ADD COLUMN historia_enfermedad TEXT;
ALTER TABLE atencion ADD COLUMN examen_fisico TEXT;

-- Datos del SIGSA 3CS de la visita, con los codigos del formulario.
ALTER TABLE atencion ADD COLUMN tipo_consulta SMALLINT;
ALTER TABLE atencion ADD CONSTRAINT atencion_tipo_consulta_check CHECK (tipo_consulta IS NULL OR tipo_consulta BETWEEN 1 AND 4);
ALTER TABLE atencion ADD COLUMN control_sigsa SMALLINT;
ALTER TABLE atencion ADD CONSTRAINT atencion_control_sigsa_check CHECK (control_sigsa IS NULL OR control_sigsa BETWEEN 0 AND 6);
ALTER TABLE atencion ADD COLUMN semanas_gestacion SMALLINT;
ALTER TABLE atencion ADD CONSTRAINT atencion_semanas_gestacion_check CHECK (semanas_gestacion IS NULL OR semanas_gestacion BETWEEN 0 AND 45);
ALTER TABLE atencion ADD COLUMN referencia_viene SMALLINT;
ALTER TABLE atencion ADD CONSTRAINT atencion_referencia_viene_check CHECK (referencia_viene IS NULL OR referencia_viene BETWEEN 0 AND 2);
ALTER TABLE atencion ADD COLUMN referencia_fue SMALLINT;
ALTER TABLE atencion ADD CONSTRAINT atencion_referencia_fue_check CHECK (referencia_fue IS NULL OR referencia_fue BETWEEN 0 AND 2);
ALTER TABLE atencion ADD COLUMN referido_a VARCHAR(200);
ALTER TABLE atencion ADD COLUMN lugar_notificacion SMALLINT;
ALTER TABLE atencion ADD CONSTRAINT atencion_lugar_notificacion_check CHECK (lugar_notificacion IS NULL OR lugar_notificacion BETWEEN 0 AND 3);
ALTER TABLE atencion ADD COLUMN numero_notificacion VARCHAR(40);
ALTER TABLE atencion ADD COLUMN acompanante VARCHAR(160);

-- "Mas de la ficha (opcional)": lo que el papel trae y el medico no siempre llena.
ALTER TABLE atencion ADD COLUMN examen_sitios JSONB;
ALTER TABLE atencion ADD COLUMN otros_problemas TEXT;
ALTER TABLE atencion ADD COLUMN laboratorios TEXT;
ALTER TABLE atencion ADD COLUMN orientacion_integral TEXT;

-- --- Impresion clinica: filas repetibles ------------------------------------------
-- El papel tiene espacio para hasta 10 diagnosticos. El primero sigue copiado
-- en atencion.diagnostico_txt/cie, que es lo que leen los informes.
CREATE TABLE diagnostico_atencion (
  id          SERIAL PRIMARY KEY,
  atencion_id INTEGER NOT NULL REFERENCES atencion(id) ON DELETE CASCADE,
  orden       SMALLINT NOT NULL,
  descripcion VARCHAR(300) NOT NULL,
  cie         VARCHAR(10),
  CONSTRAINT diagnostico_atencion_orden UNIQUE (atencion_id, orden),
  CONSTRAINT diagnostico_atencion_orden_check CHECK (orden BETWEEN 0 AND 9)
);
CREATE INDEX diagnostico_atencion_cie ON diagnostico_atencion (cie);

-- Los diagnosticos ya registrados pasan a ser la fila principal.
INSERT INTO diagnostico_atencion (atencion_id, orden, descripcion, cie)
SELECT id, 0, diagnostico_txt, diagnostico_cie
FROM atencion
WHERE diagnostico_txt IS NOT NULL;

-- --- Catalogo CIE-10 ---------------------------------------------------------------
-- Vacio: se carga por CSV desde Administracion cuando el centro tenga el
-- catalogo oficial. Mientras tanto el buscador usa los diagnosticos ya
-- registrados en el centro.
CREATE TABLE cie10 (
  codigo      VARCHAR(10) PRIMARY KEY,
  descripcion VARCHAR(300) NOT NULL,
  sinonimos   TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true
);
