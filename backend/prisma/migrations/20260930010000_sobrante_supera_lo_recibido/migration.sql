-- El saldo de un lote puede superar lo que se recibio.
--
-- La regla anterior (cantidad_actual <= cantidad_inicial) tenia sentido
-- mientras el unico ajuste posible era "llevar el saldo al valor contado":
-- no se podia tener mas de lo que habia llegado.
--
-- Con el catalogo del MSPAS deja de ser cierta. "Sobrante en inventario
-- fisico" y "sobrante en recepcion" son causas oficiales que suben el saldo
-- justamente porque lo registrado estaba por debajo de lo que hay. Con la
-- regla vieja, el reajuste que la normativa manda hacer fallaba.
--
-- Lo que si se conserva es que nunca haya existencia negativa: eso sigue
-- siendo imposible.

ALTER TABLE lote DROP CONSTRAINT lote_cantidad_actual_check;

ALTER TABLE lote ADD CONSTRAINT lote_cantidad_actual_check
  CHECK (cantidad_actual >= 0);
