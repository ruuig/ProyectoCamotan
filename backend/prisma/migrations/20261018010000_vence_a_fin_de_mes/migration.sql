-- En las cajas y en los Excel del centro el vencimiento viene como mes y año
-- (10/2026): el producto sirve hasta el ultimo dia de ese mes. Al importarlo
-- se guardo como el dia 1, y el sistema lo daba por vencido un mes antes.
UPDATE "lote"
SET "fecha_vence" = DATE_TRUNC('month', "fecha_vence") + INTERVAL '1 month' - INTERVAL '12 hours'
WHERE EXTRACT(DAY FROM "fecha_vence") = 1;

-- Los que quedaron marcados vencidos por esa fecha y en realidad no lo estan.
UPDATE "lote"
SET "estado" = 'disponible', "motivo_estado" = NULL, "estado_en" = CURRENT_TIMESTAMP
WHERE "estado" = 'vencido' AND "fecha_vence" >= CURRENT_TIMESTAMP AND "cantidad_actual" > 0;
