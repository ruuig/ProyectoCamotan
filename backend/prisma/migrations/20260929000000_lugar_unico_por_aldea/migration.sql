-- Un mismo nombre de caserio existe en aldeas distintas.
--
-- En Camotan hay un Descombro en La Lima y otro en Lela Obraje; un Zarzal en
-- Shupa y otro en Morola. Con unicidad solo por nombre, cargar el listado del
-- municipio hacia que uno pisara al otro y se perdia la aldea correcta.
--
-- Lo que identifica al lugar es nombre + aldea (que viaja en la columna sector).

ALTER TABLE lugar_poblado DROP CONSTRAINT lugar_poblado_unico;

ALTER TABLE lugar_poblado
  ADD CONSTRAINT lugar_poblado_unico UNIQUE (establecimiento_id, nombre, sector);
