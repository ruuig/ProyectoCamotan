-- Marca de medicion biologicamente improbable.
--
-- En la base habia un nino de dos anos con 60 kg. Ahora el sistema avisa y
-- exige confirmacion; lo que se confirma queda marcado y no se usa para
-- clasificar el estado nutricional ni para generar alertas.

ALTER TABLE antropometria
  ADD COLUMN improbable        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN motivo_improbable TEXT;

-- Una medicion marcada como improbable no puede llevar clasificacion: seria
-- afirmar un estado nutricional a partir de un dato que se sabe erroneo.
ALTER TABLE antropometria
  ADD CONSTRAINT antropometria_improbable_sin_clasificacion_check
  CHECK (NOT improbable OR clasificacion IS NULL);

-- Las mediciones ya guardadas cuyo puntaje Z esta fuera del rango que la OMS
-- considera posible se marcan para revision y pierden su clasificacion.
UPDATE antropometria
SET improbable = TRUE,
    clasificacion = NULL,
    motivo_improbable = 'Puntaje Z fuera del rango -5 a +5; marcada al migrar'
WHERE ABS(COALESCE(z_peso_edad, 0))  > 5
   OR ABS(COALESCE(z_talla_edad, 0)) > 5
   OR ABS(COALESCE(z_peso_talla, 0)) > 5
   OR ABS(COALESCE(z_imc_edad, 0))   > 5;

CREATE INDEX antropometria_improbable_idx ON antropometria (improbable)
  WHERE improbable = TRUE;
