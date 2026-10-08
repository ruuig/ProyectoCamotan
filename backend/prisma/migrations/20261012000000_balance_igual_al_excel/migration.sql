-- El historial del balance se guarda tal como lo muestra el Excel del centro.

-- Promedio de cada servicio: algunos llevan decimales (1.5, 83.5).
ALTER TABLE "reporte_servicio_renglon"
  ALTER COLUMN "promedio_anotado" TYPE DECIMAL(12, 3) USING "promedio_anotado"::DECIMAL(12, 3);

-- Totales del balance que faltaban o se redondeaban:
--   saldo x demanda (B + C - D), existencia del mes anterior,
--   meses de existencia sin redondear, y la cantidad maxima y a solicitar con
--   sus decimales. La cantidad a solicitar es negativa cuando sobra.
ALTER TABLE "bres_renglon" ADD COLUMN "saldo_por_demanda" INTEGER;
ALTER TABLE "bres_renglon" ADD COLUMN "existencia_mes_anterior" INTEGER;
ALTER TABLE "bres_renglon" ALTER COLUMN "med" TYPE DECIMAL(14, 6);
ALTER TABLE "bres_renglon"
  ALTER COLUMN "cantidad_maxima" TYPE DECIMAL(14, 3) USING "cantidad_maxima"::DECIMAL(14, 3);
ALTER TABLE "bres_renglon"
  ALTER COLUMN "cantidad_solicitar" TYPE DECIMAL(14, 3) USING "cantidad_solicitar"::DECIMAL(14, 3);
