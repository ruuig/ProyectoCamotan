-- La OMS publica dos estandares de peso segun como se mide la estatura:
-- acostado (longitud, menores de 2 anios) y de pie (talla, desde los 2).
-- Sus valores difieren en el tramo que comparten, asi que se guardan como
-- indicadores distintos para no clasificar mal la desnutricion.

ALTER TABLE referencia_oms DROP CONSTRAINT IF EXISTS referencia_oms_indicador_check;

ALTER TABLE referencia_oms ADD CONSTRAINT referencia_oms_indicador_check
  CHECK (indicador IN ('peso_edad','talla_edad','peso_talla','peso_longitud','imc_edad'));
