-- Frases frecuentes que el medico escribe tal cual.
UPDATE "cie10" SET "sinonimos" = "sinonimos" || ', fiebre alta, fiebre de 39' WHERE "codigo" = 'R50.9' AND "sinonimos" NOT LIKE '%fiebre alta%';
UPDATE "cie10" SET "sinonimos" = "sinonimos" || ', dolor de cabeza intenso' WHERE "codigo" = 'R51' AND "sinonimos" NOT LIKE '%intenso%';
