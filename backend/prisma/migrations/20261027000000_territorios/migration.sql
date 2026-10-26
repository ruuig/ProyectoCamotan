-- Territorios: cada encargado responde por varios centros y puestos.
CREATE TABLE "territorio" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "encargado" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "territorio_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "territorio_numero_unico" ON "territorio"("establecimiento_id", "numero");
ALTER TABLE "territorio" ADD CONSTRAINT "territorio_establecimiento_id_fkey" FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ubicacion" ADD COLUMN "territorio_id" INTEGER;
ALTER TABLE "ubicacion" ADD CONSTRAINT "ubicacion_territorio_id_fkey" FOREIGN KEY ("territorio_id") REFERENCES "territorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
