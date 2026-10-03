-- Dos correcciones sobre los signos de peligro.
--
-- 1. Los signos de embarazada quedaron con etapa NULL, que significa "aplica a
--    todas". Resultado: a un adolescente varon se le ofrecia "Sangrado
--    vaginal". Pasan a la ficha prenatal, que solo se habilita cuando hay
--    embarazo activo.
-- 2. Los signos sembrados al inicio nunca llevaron tildes, y son texto que el
--    personal lee en pantalla y en la ficha impresa.

UPDATE signo_peligro SET etapa = 'prenatal' WHERE grupo_etario = 'embarazada';

UPDATE signo_peligro SET descripcion = 'Cefalea severa con visión borrosa'
  WHERE descripcion = 'Cefalea severa con vision borrosa';
UPDATE signo_peligro SET descripcion = 'Dolor torácico'
  WHERE descripcion = 'Dolor toracico';
UPDATE signo_peligro SET descripcion = 'Letárgico o inconsciente'
  WHERE descripcion = 'Letargico o inconsciente';
UPDATE signo_peligro SET descripcion = 'Dificultad respiratoria'
  WHERE descripcion = 'Dificultad respiratoria';
UPDATE signo_peligro SET descripcion = 'Estridor en reposo'
  WHERE descripcion = 'Estridor en reposo';
UPDATE signo_peligro SET descripcion = 'Vomita todo lo que ingiere'
  WHERE descripcion = 'Vomita todo lo que ingiere';
UPDATE signo_peligro SET descripcion = 'Signos de deshidratación grave'
  WHERE descripcion = 'Signos de deshidratacion grave';
UPDATE signo_peligro SET descripcion = 'Fiebre mayor a 39 grados C'
  WHERE descripcion = 'Fiebre mayor a 39 grados C';
UPDATE signo_peligro SET descripcion = 'Convulsiones'
  WHERE descripcion = 'Convulsiones';
