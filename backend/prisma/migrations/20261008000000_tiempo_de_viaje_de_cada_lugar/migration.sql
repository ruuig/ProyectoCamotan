-- Tiempo de viaje de cada lugar poblado al centro de salud, en minutos. Lo
-- registra el personal; da peso en la cola a quien viene de lejos.
ALTER TABLE "lugar_poblado" ADD COLUMN "tiempo_viaje_minutos" INTEGER;
ALTER TABLE "lugar_poblado" ADD CONSTRAINT "lugar_poblado_tiempo_viaje_check"
  CHECK ("tiempo_viaje_minutos" IS NULL OR "tiempo_viaje_minutos" BETWEEN 0 AND 1440);
