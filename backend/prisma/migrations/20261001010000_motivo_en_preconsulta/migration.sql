-- El motivo de consulta se captura al tomar los signos vitales.
--
-- Antes habia que escribirlo para poder abrir la atencion, lo que obligaba a
-- un paso previo: entrar al expediente, escribir el motivo, y recien entonces
-- pasar a signos vitales. En una tablet con la fila esperando, ese paso de
-- mas se paga en cada paciente del dia.
--
-- La atencion empieza cuando el paciente llega; el motivo se pregunta
-- mientras se le toman los signos, que es el mismo momento en la practica.
-- Sigue siendo obligatorio, pero en la pantalla donde corresponde.

ALTER TABLE atencion ALTER COLUMN motivo_consulta DROP NOT NULL;
