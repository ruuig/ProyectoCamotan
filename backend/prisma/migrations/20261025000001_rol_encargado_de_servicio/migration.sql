-- El encargado de un centro o puesto de salud entra con su propio rol.
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_rol_check";
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_rol_check"
  CHECK ("rol" IN ('admin', 'preconsulta', 'medico', 'farmacia', 'bodega', 'servicio'));
