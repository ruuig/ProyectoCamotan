-- Unidad en la que se peso, y notas de correccion sobre lo ya cerrado.

-- ---------------------------------------------------------------------------
-- 1. Unidad de captura del peso
-- ---------------------------------------------------------------------------

-- El peso siempre se guarda en kilogramos, pero no todas las basculas del
-- centro son de kilogramos: el formulario oficial de ninez trae casillas
-- separadas de "Peso (Kg)" y "Peso (Lb)".
--
-- Guardar en que unidad se capturo permite mostrar la equivalencia junto al
-- valor, para que quien peso en libras pueda verificar lo que quedo grabado
-- sin tener que confiar en una conversion que no vio.
ALTER TABLE preconsulta ADD COLUMN unidad_peso VARCHAR(2) NOT NULL DEFAULT 'kg';
ALTER TABLE antropometria ADD COLUMN unidad_peso VARCHAR(2) NOT NULL DEFAULT 'kg';

ALTER TABLE preconsulta ADD CONSTRAINT preconsulta_unidad_peso_check
  CHECK (unidad_peso IN ('kg', 'lb'));
ALTER TABLE antropometria ADD CONSTRAINT antropometria_unidad_peso_check
  CHECK (unidad_peso IN ('kg', 'lb'));

-- ---------------------------------------------------------------------------
-- 2. Notas de correccion sobre una consulta cerrada
-- ---------------------------------------------------------------------------

-- Al cerrar una consulta sus datos quedan fijos. Una correccion posterior no
-- sobrescribe el dato original: se registra aparte que se corrigio, quien y
-- cuando. Es el mismo principio que la trazabilidad de inventario, y por la
-- misma razon: el expediente tiene que poder reconstruirse tal como estaba.
CREATE TABLE nota_correccion (
  id            SERIAL PRIMARY KEY,
  atencion_id   INTEGER NOT NULL REFERENCES atencion(id) ON DELETE CASCADE,
  campo         VARCHAR(40) NOT NULL,
  valor_anterior TEXT,
  valor_nuevo   TEXT,
  motivo        TEXT NOT NULL,
  registrada_por INTEGER NOT NULL REFERENCES usuario(id),
  registrada_en TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT nota_motivo_check CHECK (length(btrim(motivo)) >= 5)
);

CREATE INDEX nota_correccion_atencion_idx ON nota_correccion (atencion_id, registrada_en);
