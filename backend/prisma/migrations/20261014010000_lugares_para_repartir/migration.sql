-- Entre cuantos lugares se reparte la existencia de bodega, como la columna
-- "Saldo Actual / 32" del inventario de cierre del centro: cuanto le toca a
-- cada lugar. Son 32 aunque hoy reporten 30 servicios; lo que no se reparte
-- se queda en bodega.
ALTER TABLE "configuracion_logistica" ADD COLUMN "lugares_reparto" INTEGER NOT NULL DEFAULT 32;
ALTER TABLE "configuracion_logistica" ADD CONSTRAINT "configuracion_logistica_lugares_reparto_check"
  CHECK ("lugares_reparto" BETWEEN 1 AND 200);
