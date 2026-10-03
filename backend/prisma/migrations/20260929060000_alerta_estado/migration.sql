-- Estado de la alerta.
--
-- Hasta ahora una alerta solo podia estar "atendida" o no, y el unico gesto
-- disponible era marcarla atendida a mano. Eso no significa nada en una
-- alerta de existencia o de vencimiento: nadie "atiende" que falte suero, se
-- solicita un despacho y la alerta desaparece cuando el despacho llega.
--
-- Ahora hay tres estados. "nueva" es lo recien detectado; "en_gestion" es que
-- alguien ya actuo y quedo registrado quien y cuando, pero la alerta sigue
-- visible porque la causa continua; "resuelta" la pone el propio proceso que
-- las genera, cuando la condicion desaparece.

ALTER TABLE alerta ADD COLUMN estado      VARCHAR(20) NOT NULL DEFAULT 'nueva';
ALTER TABLE alerta ADD COLUMN estado_por  INTEGER;
ALTER TABLE alerta ADD COLUMN estado_en   TIMESTAMP(3);
-- Que se hizo, no como se llama el boton: la frase visible se arma al leer.
ALTER TABLE alerta ADD COLUMN accion      VARCHAR(40);

-- Las alertas existentes se traen a los estados nuevos. Lo que estaba
-- atendido pasa a resuelto conservando quien lo marco.
UPDATE alerta
SET estado     = 'resuelta',
    estado_por = atendida_por,
    estado_en  = generada_en
WHERE atendida;

ALTER TABLE alerta
  ADD CONSTRAINT alerta_estado_check
  CHECK (estado IN ('nueva', 'en_gestion', 'resuelta'));

-- Salir de "nueva" siempre deja fecha: sin ella la tarjeta no puede decir
-- desde cuando esta en gestion.
ALTER TABLE alerta
  ADD CONSTRAINT alerta_estado_fechado_check
  CHECK (estado = 'nueva' OR estado_en IS NOT NULL);

ALTER TABLE alerta
  ADD CONSTRAINT alerta_estado_por_fk
  FOREIGN KEY (estado_por) REFERENCES usuario(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- La cobertura territorial pasa a ser una alerta como las demas, para que
-- pueda ordenarse junto a las otras y resolverse sola al registrarse una
-- atencion en la comunidad.
ALTER TABLE alerta DROP CONSTRAINT alerta_tipo_check;
ALTER TABLE alerta
  ADD CONSTRAINT alerta_tipo_check
  CHECK (tipo IN ('vencimiento', 'existencia_baja', 'cita_vencida', 'patron_clinico',
                  'desnutricion', 'comunidad_sin_atencion'));

ALTER TABLE alerta DROP CONSTRAINT alerta_entidad_check;
ALTER TABLE alerta
  ADD CONSTRAINT alerta_entidad_check
  CHECK (entidad_tipo IN ('lote', 'insumo', 'paciente', 'lugar_poblado'));

-- Los indices y la unicidad dejan de mirar "atendida" y miran el estado.
DROP INDEX IF EXISTS alerta_abierta_key;
DROP INDEX IF EXISTS alerta_atendida_severidad_idx;
DROP INDEX IF EXISTS alerta_panel_idx;

ALTER TABLE alerta DROP COLUMN atendida;
ALTER TABLE alerta DROP COLUMN atendida_por;

-- Una sola alerta abierta por causa: al correr cada hora no se acumulan.
CREATE UNIQUE INDEX alerta_abierta_key
  ON alerta (establecimiento_id, tipo, entidad_tipo, entidad_id)
  WHERE estado <> 'resuelta';

CREATE INDEX alerta_estado_severidad_idx ON alerta (estado, severidad);
CREATE INDEX alerta_panel_idx
  ON alerta (establecimiento_id, estado, severidad, generada_en DESC);
