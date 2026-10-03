-- Campos de identificacion que piden las fichas clinicas oficiales y que el
-- registro no tenia. Transcritos de las fichas fisicas del centro (ver
-- MD/fichas.md). Ninguno es obligatorio en la base: la ficha se completa por
-- partes, cuando hay oportunidad.

-- Todas las fichas separan el departamento de residencia del municipio.
ALTER TABLE paciente ADD COLUMN departamento_residencia VARCHAR(40);

-- La ficha de adulto tiene "No. de telefono" y "No. de celular" por separado,
-- y la de neonato pide el celular de la madre.
ALTER TABLE paciente ADD COLUMN celular VARCHAR(20);

-- Neonato: el recien nacido todavia no inscrito en RENAP no tiene CUI propio.
ALTER TABLE paciente ADD COLUMN no_inscrito_renap BOOLEAN;

-- Neonato: edad de la madre, en anos.
ALTER TABLE paciente ADD COLUMN edad_madre INTEGER;
ALTER TABLE paciente ADD CONSTRAINT paciente_edad_madre_check
  CHECK (edad_madre IS NULL OR edad_madre BETWEEN 9 AND 65);

-- Adulto: la escolaridad se pregunta con cinco opciones propias (analfabeta,
-- primaria, basicos, diversificado, universitaria). Se guarda lo que pide la
-- ficha; el codigo SIGSA se deriva de aqui y no se pregunta dos veces.
ALTER TABLE paciente ADD COLUMN nivel_escolar VARCHAR(20);
ALTER TABLE paciente ADD CONSTRAINT paciente_nivel_escolar_check
  CHECK (nivel_escolar IS NULL OR nivel_escolar IN
    ('analfabeta', 'primaria', 'basicos', 'diversificado', 'universitaria'));

-- Adulto: "Trabaja: Si/No + especifique" es un campo distinto de "Profesion
-- u oficio o condicion".
ALTER TABLE paciente ADD COLUMN trabajo_especifique VARCHAR(120);
