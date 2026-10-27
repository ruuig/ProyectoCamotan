-- Entrega a un territorio: la bodega le entrega al encargado y él reparte
-- entre sus centros y puestos; en el informe dice cuánto le dio a cada uno.
ALTER TABLE "reporte_servicio_renglon" ADD COLUMN IF NOT EXISTS "entradas_territorio" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ubicacion" DROP CONSTRAINT "ubicacion_tipo_check";
ALTER TABLE "ubicacion" ADD CONSTRAINT "ubicacion_tipo_check"
  CHECK ("tipo" IN ('bodega', 'centro_salud', 'puesto_salud', 'centro_comunitario', 'unidad_interna', 'territorio'));

-- Un destino por cada territorio que tiene centros o puestos.
INSERT INTO "ubicacion" ("establecimiento_id", "nombre", "tipo", "orden", "activo", "territorio_id")
SELECT t."establecimiento_id", 'Territorio ' || t."numero" || ' · ' || t."encargado", 'territorio', 900 + t."numero", t."activo", t."id"
FROM "territorio" t
WHERE NOT EXISTS (SELECT 1 FROM "ubicacion" u WHERE u."territorio_id" = t."id" AND u."tipo" = 'territorio')
  AND EXISTS (SELECT 1 FROM "ubicacion" l WHERE l."territorio_id" = t."id" AND l."tipo" IN ('puesto_salud', 'centro_comunitario'))
ON CONFLICT ("establecimiento_id", "nombre") DO NOTHING;
