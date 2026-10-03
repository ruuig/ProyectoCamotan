-- ============================================================================
-- Sistema de gestion clinica - Centro de Salud de Camotan, Chiquimula
-- Script 01: esquema inicial
-- Motor: PostgreSQL 16
--
-- Ejecutar sobre una base de datos VACIA:
--   psql "$DATABASE_URL" -f bd/01_esquema.sql
--
-- Nomenclatura: tablas y columnas en snake_case. Es obligatorio porque la
-- vista materializada consumo_diario definida en la especificacion consulta
-- movimiento_insumo, lote_id y registrado_en. El schema.prisma incluye los
-- @map correspondientes para que Prisma hable con estos nombres.
-- ============================================================================

BEGIN;

-- Necesaria para la deteccion de pacientes duplicados por nombre similar.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- catalogos

CREATE TABLE establecimiento (
  id            SERIAL PRIMARY KEY,
  codigo        TEXT        NOT NULL UNIQUE,
  nombre        TEXT        NOT NULL,
  municipio     TEXT        NOT NULL,
  departamento  TEXT        NOT NULL,
  tipo          TEXT        NOT NULL,
  activo        BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT establecimiento_tipo_check
    CHECK (tipo IN ('centro_salud_a','centro_salud_b','puesto_salud'))
);

CREATE TABLE usuario (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL,
  usuario            TEXT    NOT NULL UNIQUE,
  password_hash      TEXT    NOT NULL,
  nombre             TEXT    NOT NULL,
  dpi                TEXT UNIQUE,
  rol                TEXT    NOT NULL,
  es_director        BOOLEAN NOT NULL DEFAULT FALSE,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  totp_secret        TEXT,
  creado_en          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT usuario_establecimiento_fk
    FOREIGN KEY (establecimiento_id) REFERENCES establecimiento(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT usuario_rol_check
    CHECK (rol IN ('admin','preconsulta','medico','farmacia','bodega')),
  -- El DPI es identificador publico, no secreto: se exige formato, no mas.
  CONSTRAINT usuario_dpi_formato_check
    CHECK (dpi IS NULL OR dpi ~ '^[0-9]{13}$')
);

CREATE INDEX usuario_establecimiento_rol_idx ON usuario (establecimiento_id, rol);

CREATE TABLE clinica (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL,
  nombre             TEXT    NOT NULL,
  disponible         BOOLEAN NOT NULL DEFAULT TRUE,
  activa             BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT clinica_establecimiento_fk
    FOREIGN KEY (establecimiento_id) REFERENCES establecimiento(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX clinica_establecimiento_activa_idx
  ON clinica (establecimiento_id, activa, disponible);

CREATE TABLE signo_peligro (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL,
  codigo             TEXT    NOT NULL,
  descripcion        TEXT    NOT NULL,
  grupo_etario       TEXT    NOT NULL,
  gravedad_sugerida  TEXT    NOT NULL,
  orden              INTEGER NOT NULL DEFAULT 0,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por    INTEGER,
  CONSTRAINT signo_peligro_establecimiento_fk
    FOREIGN KEY (establecimiento_id) REFERENCES establecimiento(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT signo_peligro_actualizado_por_fk
    FOREIGN KEY (actualizado_por) REFERENCES usuario(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT signo_peligro_grupo_check
    CHECK (grupo_etario IN ('todos','menor_5','embarazada','adulto_mayor')),
  CONSTRAINT signo_peligro_gravedad_check
    CHECK (gravedad_sugerida IN ('urgente','moderado'))
);

CREATE UNIQUE INDEX signo_peligro_establecimiento_codigo_key
  ON signo_peligro (establecimiento_id, codigo);
CREATE INDEX signo_peligro_establecimiento_activo_orden_idx
  ON signo_peligro (establecimiento_id, activo, orden);

-- ---------------------------------------------------------------- pacientes

CREATE TABLE paciente (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL,
  cui                TEXT,
  expediente         TEXT    NOT NULL,
  nombres            TEXT    NOT NULL,
  apellidos          TEXT    NOT NULL,
  fecha_nacimiento   TIMESTAMP(3) NOT NULL,
  sexo               TEXT    NOT NULL,
  comunidad          TEXT    NOT NULL,
  telefono           TEXT,
  idioma_materno     TEXT    NOT NULL DEFAULT 'espanol',
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT paciente_establecimiento_fk
    FOREIGN KEY (establecimiento_id) REFERENCES establecimiento(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT paciente_sexo_check CHECK (sexo IN ('M','F')),
  CONSTRAINT paciente_cui_formato_check
    CHECK (cui IS NULL OR cui ~ '^[0-9]{13}$'),
  CONSTRAINT paciente_nacimiento_check
    CHECK (fecha_nacimiento <= CURRENT_TIMESTAMP)
);

-- El numero de expediente es correlativo interno del establecimiento:
-- se hace unico POR establecimiento, no global.
CREATE UNIQUE INDEX paciente_establecimiento_expediente_key
  ON paciente (establecimiento_id, expediente);
-- El CUI si es nacional y unico: se protege globalmente ignorando los nulos.
CREATE UNIQUE INDEX paciente_cui_key ON paciente (cui) WHERE cui IS NOT NULL;

CREATE INDEX paciente_establecimiento_nombre_idx
  ON paciente (establecimiento_id, apellidos, nombres);
CREATE INDEX paciente_establecimiento_comunidad_idx
  ON paciente (establecimiento_id, comunidad);
-- Busqueda difusa para "existe expediente con nombre similar".
CREATE INDEX paciente_nombre_trgm_idx
  ON paciente USING GIN ((lower(apellidos || ' ' || nombres)) gin_trgm_ops);

CREATE TABLE condicion_paciente (
  id             SERIAL PRIMARY KEY,
  paciente_id    INTEGER NOT NULL,
  tipo           TEXT    NOT NULL,
  vigente_desde  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vigente_hasta  TIMESTAMP(3),
  CONSTRAINT condicion_paciente_paciente_fk
    FOREIGN KEY (paciente_id) REFERENCES paciente(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT condicion_paciente_tipo_check
    CHECK (tipo IN ('embarazo','menor_5','adulto_mayor','discapacidad')),
  CONSTRAINT condicion_paciente_vigencia_check
    CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE INDEX condicion_paciente_paciente_idx ON condicion_paciente (paciente_id);
-- Evita dos condiciones del mismo tipo abiertas a la vez para el mismo paciente
-- (duplicaria el peso de condicion en el calculo de puntaje).
CREATE UNIQUE INDEX condicion_paciente_vigente_key
  ON condicion_paciente (paciente_id, tipo) WHERE vigente_hasta IS NULL;

-- ---------------------------------------------------------------- atencion

CREATE TABLE atencion (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL,
  paciente_id        INTEGER NOT NULL,
  clinica_id         INTEGER,
  estado             TEXT    NOT NULL DEFAULT 'en_espera',
  gravedad           TEXT    NOT NULL,
  puntaje            INTEGER NOT NULL DEFAULT 0,
  ausencias          INTEGER NOT NULL DEFAULT 0,
  motivo_consulta    TEXT    NOT NULL,
  registrada_en      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reingreso_en       TIMESTAMP(3),
  llamada_en         TIMESTAMP(3),
  iniciada_en        TIMESTAMP(3),
  cerrada_en         TIMESTAMP(3),
  diagnostico_cie    TEXT,
  diagnostico_txt    TEXT,
  tratamiento        TEXT,
  proxima_cita       TIMESTAMP(3),
  CONSTRAINT atencion_establecimiento_fk
    FOREIGN KEY (establecimiento_id) REFERENCES establecimiento(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT atencion_paciente_fk
    FOREIGN KEY (paciente_id) REFERENCES paciente(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT atencion_clinica_fk
    FOREIGN KEY (clinica_id) REFERENCES clinica(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT atencion_estado_check
    CHECK (estado IN ('en_espera','en_atencion','atendido','ausente')),
  CONSTRAINT atencion_gravedad_check
    CHECK (gravedad IN ('urgente','moderado','leve')),
  CONSTRAINT atencion_ausencias_check CHECK (ausencias BETWEEN 0 AND 2),
  CONSTRAINT atencion_puntaje_check CHECK (puntaje >= 0)
);

CREATE INDEX atencion_cola_idx
  ON atencion (establecimiento_id, estado, puntaje DESC);
CREATE INDEX atencion_registrada_idx ON atencion (registrada_en);
CREATE INDEX atencion_paciente_registrada_idx ON atencion (paciente_id, registrada_en);
-- Soporta la alerta "tercera consulta por el mismo diagnostico en 60 dias".
CREATE INDEX atencion_paciente_diagnostico_idx
  ON atencion (paciente_id, diagnostico_cie, registrada_en)
  WHERE diagnostico_cie IS NOT NULL;
-- Con una sola clinica activa, impide dos atenciones simultaneas en ella.
CREATE UNIQUE INDEX atencion_clinica_ocupada_key
  ON atencion (clinica_id) WHERE estado = 'en_atencion' AND clinica_id IS NOT NULL;

CREATE TABLE preconsulta (
  id                 SERIAL PRIMARY KEY,
  atencion_id        INTEGER NOT NULL UNIQUE,
  peso               DECIMAL(5,2),
  talla              DECIMAL(5,2),
  temperatura        DECIMAL(4,1),
  presion_sis        INTEGER,
  presion_dia        INTEGER,
  frec_cardiaca      INTEGER,
  frec_respiratoria  INTEGER,
  sat_oxigeno        INTEGER,
  signos_peligro     TEXT[] NOT NULL DEFAULT '{}',
  registrada_en      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT preconsulta_atencion_fk
    FOREIGN KEY (atencion_id) REFERENCES atencion(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- Rangos fisiologicamente posibles: atrapan errores de digitacion, no
  -- sustituyen la validacion clinica por edad que hace Zod en el servidor.
  CONSTRAINT preconsulta_peso_check        CHECK (peso IS NULL OR peso BETWEEN 0.5 AND 400),
  CONSTRAINT preconsulta_talla_check       CHECK (talla IS NULL OR talla BETWEEN 20 AND 250),
  CONSTRAINT preconsulta_temperatura_check CHECK (temperatura IS NULL OR temperatura BETWEEN 25 AND 45),
  CONSTRAINT preconsulta_presion_check
    CHECK ((presion_sis IS NULL OR presion_sis BETWEEN 40 AND 300)
       AND (presion_dia IS NULL OR presion_dia BETWEEN 20 AND 200)),
  CONSTRAINT preconsulta_sat_check CHECK (sat_oxigeno IS NULL OR sat_oxigeno BETWEEN 0 AND 100)
);

-- ---------------------------------------------------------- antropometria

CREATE TABLE referencia_oms (
  id        SERIAL PRIMARY KEY,
  indicador TEXT NOT NULL,
  sexo      TEXT NOT NULL,
  x         DECIMAL(6,2)  NOT NULL,
  l         DECIMAL(10,6) NOT NULL,
  m         DECIMAL(10,6) NOT NULL,
  s         DECIMAL(10,6) NOT NULL,
  -- La OMS separa el peso segun se mida al nino acostado (longitud, menores
  -- de 2 anios) o de pie (talla, desde los 2). Los valores difieren.
  CONSTRAINT referencia_oms_indicador_check
    CHECK (indicador IN ('peso_edad','talla_edad','peso_talla','peso_longitud','imc_edad')),
  CONSTRAINT referencia_oms_sexo_check CHECK (sexo IN ('M','F'))
);

CREATE UNIQUE INDEX referencia_oms_key ON referencia_oms (indicador, sexo, x);

CREATE TABLE antropometria (
  id                 SERIAL PRIMARY KEY,
  paciente_id        INTEGER NOT NULL,
  atencion_id        INTEGER,
  fecha              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edad_meses         INTEGER NOT NULL,
  peso               DECIMAL(5,2) NOT NULL,
  talla              DECIMAL(5,2) NOT NULL,
  perimetro_cefalico DECIMAL(4,1),
  perimetro_braquial DECIMAL(4,1),
  z_peso_edad        DECIMAL(4,2),
  z_talla_edad       DECIMAL(4,2),
  z_peso_talla       DECIMAL(4,2),
  z_imc_edad         DECIMAL(4,2),
  clasificacion      TEXT,
  CONSTRAINT antropometria_paciente_fk
    FOREIGN KEY (paciente_id) REFERENCES paciente(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- La especificacion declara atencion_id pero omite la relacion: se agrega.
  -- Es null solo cuando la medicion viene de jornada extramural.
  CONSTRAINT antropometria_atencion_fk
    FOREIGN KEY (atencion_id) REFERENCES atencion(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT antropometria_edad_check CHECK (edad_meses BETWEEN 0 AND 1440),
  CONSTRAINT antropometria_clasificacion_check
    CHECK (clasificacion IS NULL OR clasificacion IN (
      'normal','riesgo','desnutricion_aguda_moderada','desnutricion_aguda_severa',
      'desnutricion_cronica','sobrepeso'))
);

CREATE INDEX antropometria_paciente_fecha_idx ON antropometria (paciente_id, fecha);
CREATE INDEX antropometria_clasificacion_idx ON antropometria (clasificacion);
-- Panel del admin: casos severos sin control en 30 dias.
CREATE INDEX antropometria_seguimiento_idx
  ON antropometria (clasificacion, fecha DESC)
  WHERE clasificacion IN ('desnutricion_aguda_severa','desnutricion_aguda_moderada');

-- ---------------------------------------------------------------- insumos

CREATE TABLE insumo (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL,
  codigo_mspas       TEXT,
  nombre_generico    TEXT    NOT NULL,
  nombre_comercial   TEXT,
  componente         TEXT,
  categoria          TEXT    NOT NULL,
  presentacion       TEXT    NOT NULL,
  unidad_medida      TEXT    NOT NULL,
  stock_minimo       INTEGER NOT NULL DEFAULT 0,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT insumo_establecimiento_fk
    FOREIGN KEY (establecimiento_id) REFERENCES establecimiento(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT insumo_categoria_check
    CHECK (categoria IN ('medicamento','material_curacion','uso_unico','biologico')),
  CONSTRAINT insumo_stock_minimo_check CHECK (stock_minimo >= 0)
);

-- El codigo MSPAS es nacional y se repite entre establecimientos:
-- unico POR establecimiento, no global.
CREATE UNIQUE INDEX insumo_establecimiento_codigo_key
  ON insumo (establecimiento_id, codigo_mspas) WHERE codigo_mspas IS NOT NULL;
CREATE INDEX insumo_establecimiento_nombre_idx ON insumo (establecimiento_id, nombre_generico);
CREATE INDEX insumo_componente_idx ON insumo (componente);

CREATE TABLE lote (
  id               SERIAL PRIMARY KEY,
  insumo_id        INTEGER NOT NULL,
  numero_lote      TEXT    NOT NULL,
  fecha_vence      TIMESTAMP(3) NOT NULL,
  cantidad_inicial INTEGER NOT NULL,
  cantidad_actual  INTEGER NOT NULL,
  recibido_en      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lote_insumo_fk
    FOREIGN KEY (insumo_id) REFERENCES insumo(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT lote_cantidad_inicial_check CHECK (cantidad_inicial > 0),
  -- El saldo nunca baja de cero ni supera lo recibido: blindaje del inventario
  -- ante dispensaciones concurrentes.
  CONSTRAINT lote_cantidad_actual_check
    CHECK (cantidad_actual >= 0 AND cantidad_actual <= cantidad_inicial)
);

CREATE UNIQUE INDEX lote_insumo_numero_key ON lote (insumo_id, numero_lote);
CREATE INDEX lote_fecha_vence_idx ON lote (fecha_vence);
CREATE INDEX lote_insumo_vence_idx ON lote (insumo_id, fecha_vence);
-- FEFO: solo interesan los lotes con saldo.
CREATE INDEX lote_fefo_idx ON lote (insumo_id, fecha_vence) WHERE cantidad_actual > 0;

CREATE TABLE prescripcion (
  id           SERIAL PRIMARY KEY,
  atencion_id  INTEGER NOT NULL,
  insumo_id    INTEGER NOT NULL,
  cantidad     INTEGER NOT NULL,
  indicaciones TEXT,
  creada_en    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prescripcion_atencion_fk
    FOREIGN KEY (atencion_id) REFERENCES atencion(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT prescripcion_insumo_fk
    FOREIGN KEY (insumo_id) REFERENCES insumo(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT prescripcion_cantidad_check CHECK (cantidad > 0)
);

CREATE INDEX prescripcion_atencion_idx ON prescripcion (atencion_id);
CREATE INDEX prescripcion_insumo_idx ON prescripcion (insumo_id);

CREATE TABLE dispensacion (
  id              SERIAL PRIMARY KEY,
  prescripcion_id INTEGER NOT NULL,
  cantidad        INTEGER NOT NULL,
  parcial         BOOLEAN NOT NULL DEFAULT FALSE,
  anulada         BOOLEAN NOT NULL DEFAULT FALSE,
  usuario_id      INTEGER NOT NULL,
  registrada_en   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT dispensacion_prescripcion_fk
    FOREIGN KEY (prescripcion_id) REFERENCES prescripcion(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT dispensacion_usuario_fk
    FOREIGN KEY (usuario_id) REFERENCES usuario(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT dispensacion_cantidad_check CHECK (cantidad > 0)
);

CREATE INDEX dispensacion_prescripcion_idx ON dispensacion (prescripcion_id);
CREATE INDEX dispensacion_registrada_idx ON dispensacion (registrada_en);

CREATE TABLE movimiento_insumo (
  id               SERIAL PRIMARY KEY,
  lote_id          INTEGER NOT NULL,
  tipo             TEXT    NOT NULL,
  cantidad         INTEGER NOT NULL,
  saldo_resultante INTEGER NOT NULL,
  dispensacion_id  INTEGER,
  usuario_id       INTEGER NOT NULL,
  motivo           TEXT,
  registrado_en    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT movimiento_insumo_lote_fk
    FOREIGN KEY (lote_id) REFERENCES lote(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT movimiento_insumo_dispensacion_fk
    FOREIGN KEY (dispensacion_id) REFERENCES dispensacion(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT movimiento_insumo_usuario_fk
    FOREIGN KEY (usuario_id) REFERENCES usuario(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT movimiento_insumo_tipo_check
    CHECK (tipo IN ('ingreso','salida','ajuste','baja')),
  CONSTRAINT movimiento_insumo_cantidad_check CHECK (cantidad <> 0),
  CONSTRAINT movimiento_insumo_saldo_check CHECK (saldo_resultante >= 0),
  -- El signo de la cantidad debe coincidir con el tipo. 'ajuste' puede ir en
  -- cualquier direccion y por eso exige motivo.
  CONSTRAINT movimiento_insumo_signo_check CHECK (
    (tipo = 'ingreso' AND cantidad > 0) OR
    (tipo IN ('salida','baja') AND cantidad < 0) OR
    (tipo = 'ajuste' AND motivo IS NOT NULL)
  )
);

CREATE INDEX movimiento_insumo_lote_fecha_idx ON movimiento_insumo (lote_id, registrado_en);
CREATE INDEX movimiento_insumo_fecha_idx ON movimiento_insumo (registrado_en);
CREATE INDEX movimiento_insumo_tipo_fecha_idx ON movimiento_insumo (tipo, registrado_en);
CREATE INDEX movimiento_insumo_dispensacion_idx ON movimiento_insumo (dispensacion_id);

-- ------------------------------------------------------ alertas y bitacora

CREATE TABLE alerta (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL,
  tipo               TEXT    NOT NULL,
  severidad          TEXT    NOT NULL,
  entidad_tipo       TEXT    NOT NULL,
  entidad_id         INTEGER NOT NULL,
  mensaje            TEXT    NOT NULL,
  atendida           BOOLEAN NOT NULL DEFAULT FALSE,
  atendida_por       INTEGER,
  generada_en        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT alerta_establecimiento_fk
    FOREIGN KEY (establecimiento_id) REFERENCES establecimiento(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT alerta_atendida_por_fk
    FOREIGN KEY (atendida_por) REFERENCES usuario(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT alerta_tipo_check
    CHECK (tipo IN ('vencimiento','existencia_baja','cita_vencida','patron_clinico','desnutricion')),
  CONSTRAINT alerta_severidad_check CHECK (severidad IN ('alta','media','baja')),
  CONSTRAINT alerta_entidad_check CHECK (entidad_tipo IN ('lote','insumo','paciente'))
);

CREATE INDEX alerta_atendida_severidad_idx ON alerta (atendida, severidad);
CREATE INDEX alerta_entidad_idx ON alerta (entidad_tipo, entidad_id);
CREATE INDEX alerta_panel_idx ON alerta (establecimiento_id, atendida, severidad, generada_en DESC);
-- El job horario vuelve a evaluar los mismos umbrales: sin esto acumularia una
-- alerta duplicada por hora. Con esto el job hace un upsert idempotente.
CREATE UNIQUE INDEX alerta_abierta_key
  ON alerta (establecimiento_id, tipo, entidad_tipo, entidad_id) WHERE atendida = FALSE;

CREATE TABLE bitacora (
  id            SERIAL PRIMARY KEY,
  usuario_id    INTEGER NOT NULL,
  accion        TEXT    NOT NULL,
  entidad       TEXT    NOT NULL,
  entidad_id    INTEGER,
  ip            TEXT,
  detalle       TEXT,
  registrada_en TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bitacora_usuario_fk
    FOREIGN KEY (usuario_id) REFERENCES usuario(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT bitacora_accion_check
    CHECK (accion IN ('crear','leer','actualizar','eliminar','exportar',
                      'login','login_fallido','logout',
                      'config_signos','autorizacion_fallida'))
);

CREATE INDEX bitacora_usuario_fecha_idx ON bitacora (usuario_id, registrada_en);
CREATE INDEX bitacora_entidad_idx ON bitacora (entidad, entidad_id);
-- Soporta el limite de 3 intentos de autorizacion fallidos por hora por IP.
CREATE INDEX bitacora_ip_fecha_idx ON bitacora (ip, accion, registrada_en DESC)
  WHERE ip IS NOT NULL;

-- ------------------------------------------- idempotencia de cola offline

-- La seccion TOLERANCIA A DESCONEXION exige un idempotencyKey por operacion
-- reenviada desde IndexedDB. Sin persistirlo del lado del servidor el reenvio
-- si duplica registros. Aqui vive esa garantia.
CREATE TABLE operacion_idempotente (
  clave         TEXT PRIMARY KEY,
  usuario_id    INTEGER NOT NULL,
  endpoint      TEXT    NOT NULL,
  respuesta     JSONB,
  registrada_en TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT operacion_idempotente_usuario_fk
    FOREIGN KEY (usuario_id) REFERENCES usuario(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX operacion_idempotente_fecha_idx ON operacion_idempotente (registrada_en);

COMMIT;
