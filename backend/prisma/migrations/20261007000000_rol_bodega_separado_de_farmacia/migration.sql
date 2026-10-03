-- Bodega maneja el inventario; farmacia dispensa a los pacientes. Son roles distintos.
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_rol_check";
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_rol_check"
  CHECK ("rol" IN ('admin', 'preconsulta', 'medico', 'farmacia', 'bodega'));
