-- Alertas logisticas del MSPAS.
--
-- Se separan tres situaciones que antes caian todas en "existencia_baja":
--
--   existencia_baja  el saldo bajo del minimo calculado con su propio consumo
--   desabastecimiento  saldo en cero habiendo demanda reciente
--   cuarentena  un lote lleva demasiado tiempo retenido sin resolverse
--
-- Y dos que no existian, porque no nacen de un dato que cambio sino de una
-- fecha que llego: el BRES del mes y el inventario fisico.

ALTER TABLE alerta DROP CONSTRAINT alerta_tipo_check;

ALTER TABLE alerta
  ADD CONSTRAINT alerta_tipo_check
  CHECK (tipo IN (
    'vencimiento', 'existencia_baja', 'desabastecimiento', 'cuarentena',
    'bres_pendiente', 'inventario_pendiente',
    'cita_vencida', 'patron_clinico', 'desnutricion', 'comunidad_sin_atencion'
  ));

-- El BRES y el inventario son obligaciones del establecimiento entero, no de
-- un insumo ni de un lote.
ALTER TABLE alerta DROP CONSTRAINT alerta_entidad_check;

ALTER TABLE alerta
  ADD CONSTRAINT alerta_entidad_check
  CHECK (entidad_tipo IN ('lote', 'insumo', 'paciente', 'lugar_poblado', 'establecimiento'));
