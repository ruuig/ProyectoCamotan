-- Encargado de servicio: usuario de un centro o puesto de salud que hace sus
-- requisiciones a la bodega y sube su informe mensual. Solo ve su ubicacion.
ALTER TABLE "usuario" ADD COLUMN "ubicacion_id" INTEGER;
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_ubicacion_id_fkey"
  FOREIGN KEY ("ubicacion_id") REFERENCES "ubicacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "usuario_ubicacion" ON "usuario"("ubicacion_id");
