-- Bodega del centro: ubicaciones, traslados a servicios, reporte mensual de
-- los servicios y los parametros del BRES del centro (MD/Bodega.md).

-- --- Catalogo de insumos ------------------------------------------------------
-- Las categorias con el color que ya usa el centro. "Para eliminar" (negro)
-- no es categoria: es un insumo inactivo.
ALTER TABLE insumo DROP CONSTRAINT IF EXISTS insumo_categoria_check;
UPDATE insumo SET categoria = CASE categoria
  WHEN 'medicamento' THEN 'medicamentos'
  WHEN 'biologico' THEN 'medicamentos'
  WHEN 'material_curacion' THEN 'medico_quirurgico'
  WHEN 'uso_unico' THEN 'medico_quirurgico'
  ELSE categoria END;
ALTER TABLE insumo ADD CONSTRAINT insumo_categoria_check CHECK (categoria IN (
  'medicamentos', 'suplementos', 'planificacion_familiar', 'medico_quirurgico', 'laboratorio', 'tuberculosis'
));

ALTER TABLE insumo ADD COLUMN codigo_barras VARCHAR(40);
ALTER TABLE insumo ADD COLUMN costo_referencia DECIMAL(12, 4);
-- Unidades de entrega que trae una presentacion completa (caja, paquete):
-- la propuesta de distribucion redondea a multiplos de esto.
ALTER TABLE insumo ADD COLUMN unidades_por_empaque INTEGER NOT NULL DEFAULT 1;
ALTER TABLE insumo ADD CONSTRAINT insumo_unidades_empaque_check CHECK (unidades_por_empaque >= 1);

-- Nombres con que el insumo aparece en los Excel viejos, para migrar el
-- historial sin perder meses.
CREATE TABLE insumo_alias (
  id                 SERIAL PRIMARY KEY,
  insumo_id          INTEGER NOT NULL REFERENCES insumo(id) ON DELETE CASCADE,
  alias              VARCHAR(200) NOT NULL,
  alias_normalizado  VARCHAR(200) NOT NULL
);
CREATE UNIQUE INDEX insumo_alias_unico ON insumo_alias (alias_normalizado);
CREATE INDEX insumo_alias_insumo ON insumo_alias (insumo_id);

-- --- Lote -----------------------------------------------------------------------
ALTER TABLE lote ADD COLUMN fecha_fabricacion DATE;
ALTER TABLE lote ADD CONSTRAINT lote_fabricacion_check
  CHECK (fecha_fabricacion IS NULL OR fecha_fabricacion <= fecha_vence);

-- --- Ubicaciones: la bodega y los servicios ---------------------------------------
CREATE TABLE ubicacion (
  id                  SERIAL PRIMARY KEY,
  establecimiento_id  INTEGER NOT NULL REFERENCES establecimiento(id),
  nombre              VARCHAR(120) NOT NULL,
  tipo                VARCHAR(30) NOT NULL,
  comunidad           VARCHAR(120),
  orden               INTEGER NOT NULL DEFAULT 0,
  activo              BOOLEAN NOT NULL DEFAULT true,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ubicacion_tipo_check CHECK (tipo IN ('bodega', 'centro_salud', 'puesto_salud', 'centro_comunitario')),
  CONSTRAINT ubicacion_nombre_unico UNIQUE (establecimiento_id, nombre)
);

-- Los servicios del balance del centro (MD/Bodega.md seccion 3), en su orden.
-- Post-consulta es la farmacia del propio centro: entrega desde los lotes de
-- la bodega, asi que no recibe traslados.
INSERT INTO ubicacion (establecimiento_id, nombre, tipo, comunidad, orden)
SELECT e.id, s.nombre, s.tipo, s.comunidad, s.orden
FROM establecimiento e
CROSS JOIN (VALUES
  ('Bodega', 'bodega', NULL, 0),
  ('Post-consulta (Centro de Salud)', 'centro_salud', NULL, 1),
  ('P/S Caparjá', 'puesto_salud', 'Caparjá', 2),
  ('C/C Anicillo', 'centro_comunitario', 'Anicillo', 3),
  ('P/S Shalaguá', 'puesto_salud', 'Shalaguá', 4),
  ('C/C Chapulín', 'centro_comunitario', 'Chapulín', 5),
  ('P/S Lantiquín', 'puesto_salud', 'Lantiquín', 6),
  ('C/C Marimba', 'centro_comunitario', 'Marimba', 7),
  ('C/C Chaguitón', 'centro_comunitario', 'Chaguitón', 8),
  ('C/C Cañón Tisipe', 'centro_comunitario', 'Cañón Tisipe', 9),
  ('Centro Comunitario Tierra Blanca', 'centro_comunitario', 'Tierra Blanca', 10),
  ('C/C Nuevo Porvenir Tesoro', 'centro_comunitario', 'Nuevo Porvenir Tesoro', 11),
  ('Centro Comunitario Morola', 'centro_comunitario', 'Morola', 12),
  ('Centro Comunitario Volcán', 'centro_comunitario', 'Volcán', 13),
  ('Centro Comunitario Roblarcito', 'centro_comunitario', 'Roblarcito', 14),
  ('C/C Pententá Nearar', 'centro_comunitario', 'Pententá Nearar', 15),
  ('C/C Nearar Pitahaya', 'centro_comunitario', 'Nearar Pitahaya', 16),
  ('Centro Comunitario Nearar Cumbre', 'centro_comunitario', 'Nearar Cumbre', 17),
  ('C/C Muyurcó', 'centro_comunitario', 'Muyurcó', 18),
  ('Centro Comunitario Plan Tular', 'centro_comunitario', 'Plan Tular', 19),
  ('Centro Comunitario Limón Timoté', 'centro_comunitario', 'Limón Timoté', 20),
  ('C/C Plan del Morro', 'centro_comunitario', 'Plan del Morro', 21),
  ('Centro Comunitario Despoblado', 'centro_comunitario', 'Despoblado', 22),
  ('Centro Comunitario Pashapa', 'centro_comunitario', 'Pashapa', 23),
  ('Centro Comunitario Rodeo', 'centro_comunitario', 'Rodeo', 24),
  ('C/C Cajón del Río', 'centro_comunitario', 'Cajón del Río', 25),
  ('Centro Comunitario Filincas', 'centro_comunitario', 'Filincas', 26),
  ('Centro Comunitario Guayabo', 'centro_comunitario', 'Guayabo', 27),
  ('C/C San Antonio', 'centro_comunitario', 'San Antonio', 28),
  ('Centro Comunitario Shupa', 'centro_comunitario', 'Shupa', 29),
  ('Centro Comunitario Calichal', 'centro_comunitario', 'Calichal', 30),
  ('Centro Comunitario Tizamarté', 'centro_comunitario', 'Tizamarté', 31)
) AS s(nombre, tipo, comunidad, orden);

-- --- Traslados de la bodega a los servicios ------------------------------------------
CREATE TABLE traslado (
  id                  SERIAL PRIMARY KEY,
  establecimiento_id  INTEGER NOT NULL REFERENCES establecimiento(id),
  numero              VARCHAR(20) NOT NULL,
  ubicacion_id        INTEGER NOT NULL REFERENCES ubicacion(id),
  entregado_por       INTEGER NOT NULL REFERENCES usuario(id),
  recibido_por        VARCHAR(160) NOT NULL,
  observacion         VARCHAR(500),
  registrado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT traslado_numero_unico UNIQUE (establecimiento_id, numero)
);
CREATE INDEX traslado_ubicacion_fecha ON traslado (ubicacion_id, registrado_en);

-- Cada renglon del traslado es un movimiento de su lote.
ALTER TABLE movimiento_insumo ADD COLUMN traslado_id INTEGER REFERENCES traslado(id);
CREATE INDEX movimiento_traslado ON movimiento_insumo (traslado_id);

-- --- Reporte mensual de los servicios ---------------------------------------------------
CREATE TABLE reporte_servicio (
  id               SERIAL PRIMARY KEY,
  ubicacion_id     INTEGER NOT NULL REFERENCES ubicacion(id),
  periodo          CHAR(7) NOT NULL,
  capturado_por    INTEGER NOT NULL REFERENCES usuario(id),
  capturado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revisado         BOOLEAN NOT NULL DEFAULT false,
  observacion      VARCHAR(500),
  CONSTRAINT reporte_servicio_unico UNIQUE (ubicacion_id, periodo)
);

CREATE TABLE reporte_servicio_renglon (
  id                   SERIAL PRIMARY KEY,
  reporte_id           INTEGER NOT NULL REFERENCES reporte_servicio(id) ON DELETE CASCADE,
  insumo_id            INTEGER NOT NULL REFERENCES insumo(id),
  saldo_anterior       INTEGER NOT NULL,
  entradas             INTEGER NOT NULL,
  entradas_reportadas  INTEGER,
  entregado            INTEGER NOT NULL DEFAULT 0,
  no_entregado         INTEGER NOT NULL DEFAULT 0,
  saldo_siguiente      INTEGER NOT NULL,
  saldo_reportado      INTEGER,
  CONSTRAINT reporte_renglon_unico UNIQUE (reporte_id, insumo_id),
  CONSTRAINT reporte_renglon_valores_check CHECK (entregado >= 0 AND no_entregado >= 0 AND entradas >= 0)
);

-- --- Parametros del BRES y del semaforo del centro ------------------------------------
ALTER TABLE configuracion_logistica ADD COLUMN nivel_minimo_meses DECIMAL(4, 2) NOT NULL DEFAULT 2;
ALTER TABLE configuracion_logistica ADD COLUMN nivel_maximo_meses DECIMAL(4, 2) NOT NULL DEFAULT 4;
ALTER TABLE configuracion_logistica ADD COLUMN meses_promedio INTEGER NOT NULL DEFAULT 6;
-- centro: maximo - existencia de bodega. mspas: maximo - saldo total.
ALTER TABLE configuracion_logistica ADD COLUMN formula_pedido VARCHAR(10) NOT NULL DEFAULT 'centro';
ALTER TABLE configuracion_logistica ADD COLUMN semaforo_rojo_meses INTEGER NOT NULL DEFAULT 12;
ALTER TABLE configuracion_logistica ADD COLUMN semaforo_amarillo_meses INTEGER NOT NULL DEFAULT 18;
ALTER TABLE configuracion_logistica ADD COLUMN dia_corte_reportes INTEGER NOT NULL DEFAULT 25;
ALTER TABLE configuracion_logistica ADD COLUMN encargado_bodega VARCHAR(160);
ALTER TABLE configuracion_logistica ADD COLUMN coordinador_municipal VARCHAR(160);
ALTER TABLE configuracion_logistica ADD CONSTRAINT configuracion_formula_check CHECK (formula_pedido IN ('centro', 'mspas'));
ALTER TABLE configuracion_logistica ADD CONSTRAINT configuracion_semaforo_check
  CHECK (semaforo_rojo_meses > 0 AND semaforo_amarillo_meses > semaforo_rojo_meses);
ALTER TABLE configuracion_logistica ADD CONSTRAINT configuracion_niveles_check
  CHECK (nivel_minimo_meses > 0 AND nivel_maximo_meses >= nivel_minimo_meses AND meses_promedio BETWEEN 1 AND 24);

-- --- BRES con las columnas del centro ---------------------------------------------------
-- I: existencia fisica en bodega, aparte del saldo del municipio (H).
ALTER TABLE bres_renglon ADD COLUMN existencia_bodega INTEGER;
