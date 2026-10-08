-- Tipos de movimiento nuevos:
--   paso_farmacia: entre la bodega y la farmacia; sale de una (negativo) y
--     entra a la otra (positivo), asi que lleva los dos signos.
--   devolucion: lo de una entrega anulada que vuelve a su lote (positivo).
--     Antes la anulacion usaba un tipo que la base no aceptaba.
ALTER TABLE "movimiento_insumo" DROP CONSTRAINT "movimiento_tipo_check";
ALTER TABLE "movimiento_insumo" ADD CONSTRAINT "movimiento_tipo_check"
  CHECK ("tipo" IN ('ingreso', 'entrega', 'consumo_interno', 'traslado', 'reajuste', 'baja', 'paso_farmacia', 'devolucion'));
ALTER TABLE "movimiento_insumo" DROP CONSTRAINT "movimiento_signo_check";
ALTER TABLE "movimiento_insumo" ADD CONSTRAINT "movimiento_signo_check" CHECK (
  ("tipo" IN ('ingreso', 'devolucion') AND "cantidad" > 0)
  OR ("tipo" IN ('entrega', 'consumo_interno', 'traslado', 'baja') AND "cantidad" < 0)
  OR "tipo" IN ('reajuste', 'paso_farmacia')
);
