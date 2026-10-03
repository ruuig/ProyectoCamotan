-- Logistica segun el sistema del MSPAS.
--
-- Lo que habia modelaba "cuanto hay". Lo que el ministerio necesita es
-- "cuanto se movio, por que, y cuanto hay que pedir". Son cosas distintas:
-- el saldo es una consecuencia de los movimientos, no un dato propio, y el
-- nivel minimo de cada insumo sale de su propio consumo y no de un numero
-- fijo igual para todos.

-- ---------------------------------------------------------------------------
-- 1. Configuracion logistica del establecimiento
-- ---------------------------------------------------------------------------

-- El tiempo de solicitud y recepcion y la frecuencia de pedido los define el
-- Area de Salud. Hasta que el centro los confirme quedan marcados como
-- provisionales, y toda cifra derivada de ellos se muestra como provisional.
CREATE TABLE configuracion_logistica (
  establecimiento_id            INTEGER PRIMARY KEY
    REFERENCES establecimiento(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  meses_solicitud_recepcion     NUMERIC(4,2) NOT NULL DEFAULT 1,
  meses_frecuencia_pedido       NUMERIC(4,2) NOT NULL DEFAULT 1,
  dia_corte_bres                INTEGER      NOT NULL DEFAULT 25,
  dia_inventario_fisico         INTEGER      NOT NULL DEFAULT 28,
  dias_maximo_cuarentena        INTEGER      NOT NULL DEFAULT 7,
  provisional                   BOOLEAN      NOT NULL DEFAULT TRUE,
  actualizado_por               INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  actualizado_en                TIMESTAMP(3),
  CONSTRAINT config_meses_positivos_check
    CHECK (meses_solicitud_recepcion > 0 AND meses_frecuencia_pedido > 0),
  CONSTRAINT config_dias_del_mes_check
    CHECK (dia_corte_bres BETWEEN 1 AND 28 AND dia_inventario_fisico BETWEEN 1 AND 28)
);

INSERT INTO configuracion_logistica (establecimiento_id)
SELECT id FROM establecimiento;

-- ---------------------------------------------------------------------------
-- 2. Insumo: identificacion segun la Denominacion Comun Internacional
-- ---------------------------------------------------------------------------

ALTER TABLE insumo ADD COLUMN codigo_interno      VARCHAR(30);
ALTER TABLE insumo ADD COLUMN forma_farmaceutica  VARCHAR(40);
ALTER TABLE insumo ADD COLUMN concentracion       VARCHAR(40);
ALTER TABLE insumo ADD COLUMN unidad_entrega      VARCHAR(30);
ALTER TABLE insumo ADD COLUMN perecedero          BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE insumo ADD COLUMN cadena_frio         BOOLEAN NOT NULL DEFAULT FALSE;

-- La unidad de entrega es con la que se despacha al paciente. Donde no se
-- distinguia, es la misma que la de medida.
UPDATE insumo SET unidad_entrega = unidad_medida WHERE unidad_entrega IS NULL;
ALTER TABLE insumo ALTER COLUMN unidad_entrega SET NOT NULL;

-- Codigo interno correlativo para los que aun no lo tienen.
UPDATE insumo SET codigo_interno = 'INS-' || LPAD(id::text, 5, '0')
WHERE codigo_interno IS NULL;
ALTER TABLE insumo ALTER COLUMN codigo_interno SET NOT NULL;

CREATE UNIQUE INDEX insumo_codigo_interno_key
  ON insumo (establecimiento_id, codigo_interno);

-- Los biologicos siempre exigen cadena de frio.
UPDATE insumo SET cadena_frio = TRUE WHERE categoria = 'biologico';

-- No pueden existir dos insumos activos con el mismo generico, forma y
-- concentracion: serian el mismo producto con dos tarjetas de control.
CREATE UNIQUE INDEX insumo_identidad_key
  ON insumo (
    establecimiento_id,
    lower(nombre_generico),
    lower(coalesce(forma_farmaceutica, '')),
    lower(coalesce(concentracion, ''))
  )
  WHERE activo;

-- ---------------------------------------------------------------------------
-- 3. Lote: procedencia, estado y verificacion de recepcion
-- ---------------------------------------------------------------------------

ALTER TABLE lote ADD COLUMN fabricante          VARCHAR(120);
ALTER TABLE lote ADD COLUMN registro_sanitario  VARCHAR(60);
ALTER TABLE lote ADD COLUMN costo_unitario      NUMERIC(12,4);
ALTER TABLE lote ADD COLUMN origen              VARCHAR(20) NOT NULL DEFAULT 'despacho';
ALTER TABLE lote ADD COLUMN acta_donacion       VARCHAR(60);
ALTER TABLE lote ADD COLUMN ubicacion           VARCHAR(60);
ALTER TABLE lote ADD COLUMN estado              VARCHAR(20) NOT NULL DEFAULT 'disponible';
ALTER TABLE lote ADD COLUMN motivo_estado       TEXT;
ALTER TABLE lote ADD COLUMN estado_en           TIMESTAMP(3);
ALTER TABLE lote ADD COLUMN estado_por          INTEGER REFERENCES usuario(id) ON DELETE SET NULL;

-- Verificacion de recepcion exigida por el procedimiento AL-MFA.
ALTER TABLE lote ADD COLUMN cantidad_documento  INTEGER;
ALTER TABLE lote ADD COLUMN verif_cantidad      BOOLEAN;
ALTER TABLE lote ADD COLUMN verif_etiquetado    BOOLEAN;
ALTER TABLE lote ADD COLUMN verif_empaque       BOOLEAN;
ALTER TABLE lote ADD COLUMN verif_aspecto       BOOLEAN;
ALTER TABLE lote ADD COLUMN observacion_recepcion TEXT;

ALTER TABLE lote ADD CONSTRAINT lote_origen_check
  CHECK (origen IN ('despacho', 'donacion', 'traslado', 'prestamo'));

ALTER TABLE lote ADD CONSTRAINT lote_estado_check
  CHECK (estado IN ('disponible', 'cuarentena', 'retirado', 'vencido', 'agotado', 'dado_de_baja'));

-- Una donacion sin numero de acta no se puede sustentar ante auditoria.
ALTER TABLE lote ADD CONSTRAINT lote_donacion_con_acta_check
  CHECK (origen <> 'donacion' OR acta_donacion IS NOT NULL);

-- Salir de disponible siempre deja constancia de por que.
ALTER TABLE lote ADD CONSTRAINT lote_estado_motivado_check
  CHECK (estado IN ('disponible', 'agotado', 'vencido') OR motivo_estado IS NOT NULL);

-- Los lotes que ya existen se clasifican por lo que son hoy.
UPDATE lote SET estado = 'agotado' WHERE cantidad_actual <= 0;
UPDATE lote SET estado = 'vencido' WHERE cantidad_actual > 0 AND fecha_vence <= CURRENT_DATE;

CREATE INDEX lote_estado_idx ON lote (estado, fecha_vence);

-- ---------------------------------------------------------------------------
-- 4. Movimiento: tipos y causas del catalogo oficial
-- ---------------------------------------------------------------------------

-- Las reglas viejas nombran tipos que estan por desaparecer, asi que se
-- sueltan antes de renombrar y se vuelven a poner al final, ya sobre los
-- tipos nuevos.
ALTER TABLE movimiento_insumo DROP CONSTRAINT movimiento_insumo_tipo_check;
ALTER TABLE movimiento_insumo DROP CONSTRAINT movimiento_insumo_signo_check;

-- "salida" no distinguia entregar a un paciente de usar en una curacion o de
-- mandar a otro servicio. Para el BRES son renglones distintos.
UPDATE movimiento_insumo SET tipo = 'entrega'
WHERE tipo = 'salida' AND dispensacion_id IS NOT NULL;

UPDATE movimiento_insumo SET tipo = 'consumo_interno'
WHERE tipo = 'salida' AND dispensacion_id IS NULL;

UPDATE movimiento_insumo SET tipo = 'reajuste' WHERE tipo = 'ajuste';

ALTER TABLE movimiento_insumo ADD COLUMN causa    VARCHAR(40);
ALTER TABLE movimiento_insumo ADD COLUMN servicio VARCHAR(60);

ALTER TABLE movimiento_insumo ADD CONSTRAINT movimiento_tipo_check
  CHECK (tipo IN ('ingreso', 'entrega', 'consumo_interno', 'traslado', 'reajuste', 'baja'));

-- Causas del catalogo del MSPAS. Un reajuste sin causa no se puede justificar.
ALTER TABLE movimiento_insumo ADD CONSTRAINT movimiento_causa_check
  CHECK (
    causa IS NULL OR causa IN (
      'sobrante_inventario_fisico', 'sobrante_recepcion', 'traslado_recibido',
      'prestamo_recibido', 'correccion_error_registro_positiva',
      'devolucion_nivel_inferior', 'donacion_externa',
      'faltante_inventario_fisico', 'faltante_recepcion', 'traslado_enviado',
      'prestamo_enviado', 'correccion_error_registro_negativa',
      'devolucion_nivel_superior', 'producto_vencido', 'producto_danado'
    )
  );

ALTER TABLE movimiento_insumo ADD CONSTRAINT movimiento_reajuste_con_causa_check
  CHECK (tipo <> 'reajuste' OR causa IS NOT NULL);

-- El signo dice la direccion: lo que entra suma, lo que sale resta, y el
-- reajuste puede ir en cualquiera de las dos segun la causa.
ALTER TABLE movimiento_insumo ADD CONSTRAINT movimiento_signo_check
  CHECK (
    (tipo = 'ingreso' AND cantidad > 0)
    OR (tipo IN ('entrega', 'consumo_interno', 'traslado', 'baja') AND cantidad < 0)
    OR (tipo = 'reajuste')
  );

-- Los reajustes ya registrados no tenian causa del catalogo; se marcan como
-- correccion de registro conservando el motivo escrito original.
UPDATE movimiento_insumo
SET causa = CASE WHEN cantidad >= 0
                 THEN 'correccion_error_registro_positiva'
                 ELSE 'correccion_error_registro_negativa' END
WHERE tipo = 'reajuste' AND causa IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Demanda no atendida
-- ---------------------------------------------------------------------------

-- Sin esto la demanda real es invisible: el sistema solo sabria lo que si se
-- entrego, y pediria de menos justo el insumo que mas falta.
CREATE TABLE demanda_no_atendida (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL REFERENCES establecimiento(id),
  insumo_id          INTEGER NOT NULL REFERENCES insumo(id),
  prescripcion_id    INTEGER REFERENCES prescripcion(id),
  paciente_id        INTEGER REFERENCES paciente(id),
  cantidad           INTEGER NOT NULL,
  registrada_en      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registrada_por     INTEGER NOT NULL REFERENCES usuario(id),
  CONSTRAINT demanda_cantidad_positiva_check CHECK (cantidad > 0)
);

CREATE INDEX demanda_no_atendida_idx
  ON demanda_no_atendida (establecimiento_id, insumo_id, registrada_en);

-- ---------------------------------------------------------------------------
-- 6. Inventario fisico mensual
-- ---------------------------------------------------------------------------

CREATE TABLE inventario_fisico (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL REFERENCES establecimiento(id),
  periodo            CHAR(7) NOT NULL,
  estado             VARCHAR(20) NOT NULL DEFAULT 'abierto',
  iniciado_por       INTEGER NOT NULL REFERENCES usuario(id),
  iniciado_en        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrado_por        INTEGER REFERENCES usuario(id),
  cerrado_en         TIMESTAMP(3),
  autorizado_por     INTEGER REFERENCES usuario(id),
  observaciones      TEXT,
  CONSTRAINT inventario_estado_check CHECK (estado IN ('abierto', 'cerrado')),
  CONSTRAINT inventario_periodo_check CHECK (periodo ~ '^[0-9]{4}-[0-9]{2}$')
);

CREATE UNIQUE INDEX inventario_fisico_periodo_key
  ON inventario_fisico (establecimiento_id, periodo);

-- El conteo es ciego: se guarda lo contado, y el saldo del sistema se
-- congela al cerrar. Si se guardara antes, la hoja podria filtrarlo.
CREATE TABLE conteo_fisico (
  id                  SERIAL PRIMARY KEY,
  inventario_id       INTEGER NOT NULL REFERENCES inventario_fisico(id) ON DELETE CASCADE,
  lote_id             INTEGER NOT NULL REFERENCES lote(id),
  cantidad_contada    INTEGER NOT NULL,
  saldo_sistema       INTEGER,
  diferencia          INTEGER,
  reajuste_aplicado   BOOLEAN NOT NULL DEFAULT FALSE,
  contado_por         INTEGER NOT NULL REFERENCES usuario(id),
  contado_en          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT conteo_no_negativo_check CHECK (cantidad_contada >= 0)
);

CREATE UNIQUE INDEX conteo_fisico_lote_key ON conteo_fisico (inventario_id, lote_id);

-- ---------------------------------------------------------------------------
-- 7. BRES: Balance, Requisicion y Envio de Suministros
-- ---------------------------------------------------------------------------

CREATE TABLE bres (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL REFERENCES establecimiento(id),
  periodo            CHAR(7) NOT NULL,
  estado             VARCHAR(20) NOT NULL DEFAULT 'borrador',
  generado_por       INTEGER NOT NULL REFERENCES usuario(id),
  generado_en        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrado_en         TIMESTAMP(3),
  observaciones      TEXT,
  CONSTRAINT bres_estado_check CHECK (estado IN ('borrador', 'cerrado')),
  CONSTRAINT bres_periodo_check CHECK (periodo ~ '^[0-9]{4}-[0-9]{2}$')
);

CREATE UNIQUE INDEX bres_periodo_key ON bres (establecimiento_id, periodo);

-- Las cifras se congelan al generarlo: un BRES que cambia despues de
-- enviarse deja de cuadrar con el que recibio el area de salud.
CREATE TABLE bres_renglon (
  id                 SERIAL PRIMARY KEY,
  bres_id            INTEGER NOT NULL REFERENCES bres(id) ON DELETE CASCADE,
  insumo_id          INTEGER NOT NULL REFERENCES insumo(id),
  saldo_inicial      INTEGER NOT NULL,
  entradas           INTEGER NOT NULL,
  reajustes          INTEGER NOT NULL,
  entregado          INTEGER NOT NULL,
  consumo_interno    INTEGER NOT NULL DEFAULT 0,
  no_entregado       INTEGER NOT NULL,
  demanda_real       INTEGER NOT NULL,
  saldo_final        INTEGER NOT NULL,
  pmdr               NUMERIC(12,3),
  med                NUMERIC(8,2),
  cantidad_minima    INTEGER,
  cantidad_maxima    INTEGER,
  cantidad_solicitar INTEGER,
  meses_historia     INTEGER NOT NULL DEFAULT 0,
  observaciones      TEXT
);

CREATE UNIQUE INDEX bres_renglon_insumo_key ON bres_renglon (bres_id, insumo_id);

-- ---------------------------------------------------------------------------
-- 8. Retiro sanitario
-- ---------------------------------------------------------------------------

CREATE TABLE retiro_sanitario (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL REFERENCES establecimiento(id),
  referencia         VARCHAR(80) NOT NULL,
  motivo             TEXT NOT NULL,
  emitido_en         DATE NOT NULL,
  registrado_por     INTEGER NOT NULL REFERENCES usuario(id),
  registrado_en      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrado_en         TIMESTAMP(3)
);

CREATE TABLE retiro_lote (
  id         SERIAL PRIMARY KEY,
  retiro_id  INTEGER NOT NULL REFERENCES retiro_sanitario(id) ON DELETE CASCADE,
  lote_id    INTEGER NOT NULL REFERENCES lote(id)
);

CREATE UNIQUE INDEX retiro_lote_key ON retiro_lote (retiro_id, lote_id);

-- A quien hay que buscar. La lista se arma sola desde los movimientos.
CREATE TABLE retiro_paciente (
  id             SERIAL PRIMARY KEY,
  retiro_id      INTEGER NOT NULL REFERENCES retiro_sanitario(id) ON DELETE CASCADE,
  paciente_id    INTEGER NOT NULL REFERENCES paciente(id),
  lote_id        INTEGER NOT NULL REFERENCES lote(id),
  cantidad       INTEGER NOT NULL,
  entregado_en   TIMESTAMP(3) NOT NULL,
  localizado     BOOLEAN NOT NULL DEFAULT FALSE,
  notas          TEXT,
  actualizado_en TIMESTAMP(3),
  actualizado_por INTEGER REFERENCES usuario(id)
);

CREATE UNIQUE INDEX retiro_paciente_key ON retiro_paciente (retiro_id, paciente_id, lote_id);

-- ---------------------------------------------------------------------------
-- 9. Oficio de baja
-- ---------------------------------------------------------------------------

-- La baja no la aplica quien la solicita: el procedimiento pide oficio y
-- autorizacion antes de sacar nada del inventario.
CREATE TABLE oficio_baja (
  id                 SERIAL PRIMARY KEY,
  establecimiento_id INTEGER NOT NULL REFERENCES establecimiento(id),
  correlativo        VARCHAR(20) NOT NULL,
  lote_id            INTEGER NOT NULL REFERENCES lote(id),
  cantidad           INTEGER NOT NULL,
  causa              VARCHAR(40) NOT NULL,
  detalle            TEXT,
  numero_tarjeta     VARCHAR(30),
  precio_unitario    NUMERIC(12,4),
  estado             VARCHAR(20) NOT NULL DEFAULT 'borrador',
  solicitado_por     INTEGER NOT NULL REFERENCES usuario(id),
  solicitado_en      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  autorizado_por     INTEGER REFERENCES usuario(id),
  autorizado_en      TIMESTAMP(3),
  aplicado_en        TIMESTAMP(3),
  CONSTRAINT oficio_estado_check CHECK (estado IN ('borrador', 'autorizado', 'aplicado', 'anulado')),
  CONSTRAINT oficio_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT oficio_causa_check CHECK (causa IN ('producto_vencido', 'producto_danado')),
  CONSTRAINT oficio_autorizado_check
    CHECK (estado NOT IN ('autorizado', 'aplicado') OR autorizado_por IS NOT NULL)
);

CREATE UNIQUE INDEX oficio_baja_correlativo_key
  ON oficio_baja (establecimiento_id, correlativo);
