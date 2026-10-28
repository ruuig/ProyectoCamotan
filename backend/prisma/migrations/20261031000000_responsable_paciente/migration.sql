-- El responsable de un niño puede ser también paciente (la madre o el padre
-- con su propia ficha): se enlaza para ir de uno al otro.
ALTER TABLE paciente ADD COLUMN responsable_id INTEGER REFERENCES paciente(id) ON DELETE SET NULL;
CREATE INDEX paciente_responsable_id_idx ON paciente (responsable_id);
