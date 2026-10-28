-- Distancia entre palabras (letras cambiadas, de más o de menos): «jaun»
-- encuentra a Juan y «brneda» a Brenda, cosa que los trigramas no logran.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
