-- La requisicion va en dos direcciones:
--   servicio: un servicio del centro (o la farmacia) pide a la bodega, que
--             despacha; es lo que antes se llamaba traslado.
--   superior: la bodega del centro pide al almacen de la DDRISS (u otro);
--             cuando llega, los lotes entran desde la requisicion.
ALTER TABLE "requisicion" ADD COLUMN "direccion" TEXT NOT NULL DEFAULT 'servicio';
ALTER TABLE "requisicion" ADD COLUMN "almacen" TEXT;
ALTER TABLE "requisicion" ADD CONSTRAINT "requisicion_direccion_check" CHECK ("direccion" IN ('servicio', 'superior'));
ALTER TABLE "requisicion" DROP CONSTRAINT "requisicion_estado_check";
ALTER TABLE "requisicion" ADD CONSTRAINT "requisicion_estado_check"
  CHECK ("estado" IN ('solicitada', 'autorizada', 'despachada', 'parcial', 'recibida', 'anulada'));

-- El lote que entro por una requisicion a la DDRISS sabe cual fue.
ALTER TABLE "lote" ADD COLUMN "requisicion_id" INTEGER;
CREATE INDEX "lote_requisicion_id_idx" ON "lote"("requisicion_id");
ALTER TABLE "lote" ADD CONSTRAINT "lote_requisicion_id_fkey"
  FOREIGN KEY ("requisicion_id") REFERENCES "requisicion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los traslados ya registrados pasan a ser requisiciones despachadas. El
-- numero del formulario queda en blanco para anotarlo si se tiene.
ALTER TABLE "requisicion" ADD COLUMN "de_traslado" INTEGER;

INSERT INTO "requisicion" (
  "establecimiento_id", "ubicacion_id", "unidad_seccion", "tipos", "fecha_solicitud", "solicitante",
  "observaciones", "estado", "registrada_por", "registrada_en", "autorizada_por", "autorizada_en",
  "despachada_por", "despachada_en", "recibido_por", "direccion", "de_traslado"
)
SELECT t."establecimiento_id", t."ubicacion_id", u."nombre", ARRAY['medicamentos']::TEXT[],
       (t."registrado_en" - INTERVAL '6 hours')::DATE, t."recibido_por",
       t."observacion", 'despachada', t."entregado_por", t."registrado_en", t."entregado_por", t."registrado_en",
       t."entregado_por", t."registrado_en", t."recibido_por", 'servicio', t."id"
FROM "traslado" t
JOIN "ubicacion" u ON u."id" = t."ubicacion_id"
WHERE t."requisicion_id" IS NULL;

INSERT INTO "requisicion_renglon" (
  "requisicion_id", "orden", "insumo_id", "descripcion", "unidad_medida",
  "cantidad_solicitada", "cantidad_autorizada", "cantidad_despachada"
)
SELECT r."id",
       ROW_NUMBER() OVER (PARTITION BY r."id" ORDER BY i."nombre_generico", i."id"),
       i."id",
       TRIM(CONCAT_WS(' ', i."nombre_generico", i."concentracion", i."forma_farmaceutica")),
       i."unidad_entrega",
       SUM(-m."cantidad"), SUM(-m."cantidad"), SUM(-m."cantidad")
FROM "requisicion" r
JOIN "movimiento_insumo" m ON m."traslado_id" = r."de_traslado" AND m."ubicacion" = 'bodega'
JOIN "lote" l ON l."id" = m."lote_id"
JOIN "insumo" i ON i."id" = l."insumo_id"
WHERE r."de_traslado" IS NOT NULL
GROUP BY r."id", i."id", i."nombre_generico", i."concentracion", i."forma_farmaceutica", i."unidad_entrega"
HAVING SUM(-m."cantidad") > 0;

UPDATE "requisicion" r SET "tipos" = sub."tipos"
FROM (
  SELECT rr."requisicion_id",
         ARRAY_AGG(DISTINCT CASE i."categoria"
           WHEN 'medico_quirurgico' THEN 'suministros'
           WHEN 'laboratorio' THEN 'reactivos'
           ELSE 'medicamentos' END) AS "tipos"
  FROM "requisicion_renglon" rr JOIN "insumo" i ON i."id" = rr."insumo_id"
  GROUP BY rr."requisicion_id"
) sub
WHERE sub."requisicion_id" = r."id" AND r."de_traslado" IS NOT NULL;

UPDATE "traslado" t SET "requisicion_id" = r."id"
FROM "requisicion" r WHERE r."de_traslado" = t."id";

-- Un traslado sin renglones de bodega no deja requisicion vacia.
UPDATE "traslado" t SET "requisicion_id" = NULL
FROM "requisicion" r
WHERE r."id" = t."requisicion_id" AND r."de_traslado" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "requisicion_renglon" rr WHERE rr."requisicion_id" = r."id");
DELETE FROM "requisicion" r
WHERE r."de_traslado" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "requisicion_renglon" rr WHERE rr."requisicion_id" = r."id");

ALTER TABLE "requisicion" DROP COLUMN "de_traslado";
