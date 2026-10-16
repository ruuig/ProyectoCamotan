-- Area y distrito de salud para el encabezado de los formularios SIGSA.
ALTER TABLE "establecimiento" ADD COLUMN "area_salud" TEXT;
ALTER TABLE "establecimiento" ADD COLUMN "distrito_salud" TEXT;
