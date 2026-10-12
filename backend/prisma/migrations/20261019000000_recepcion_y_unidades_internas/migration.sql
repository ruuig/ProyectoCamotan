-- Recepcion: lo que llega a bodega entra con su documento (despacho de la
-- DDRISS, acta de donacion...) y varios productos. La entrada es lo que dice
-- el documento; si llego menos, la diferencia queda por reclamar y no se
-- entrega hasta que llegue.
CREATE TABLE "recepcion" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "numero_documento" TEXT,
    "procedencia" TEXT NOT NULL DEFAULT 'despacho',
    "remitente" TEXT NOT NULL,
    "acta" TEXT,
    "fecha" DATE NOT NULL,
    "observaciones" TEXT,
    "registrada_por" INTEGER NOT NULL,
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recepcion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recepcion_procedencia_check" CHECK ("procedencia" IN ('despacho', 'donacion', 'traslado', 'prestamo'))
);
CREATE INDEX "recepcion_fecha" ON "recepcion"("establecimiento_id", "fecha");
ALTER TABLE "recepcion" ADD CONSTRAINT "recepcion_establecimiento_id_fkey"
  FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recepcion" ADD CONSTRAINT "recepcion_registrada_por_fkey"
  FOREIGN KEY ("registrada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lote" ADD COLUMN "recepcion_id" INTEGER;
ALTER TABLE "lote" ADD COLUMN "cantidad_por_reponer" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lote" ADD CONSTRAINT "lote_por_reponer_check" CHECK ("cantidad_por_reponer" >= 0);
CREATE INDEX "lote_recepcion_id_idx" ON "lote"("recepcion_id");
ALTER TABLE "lote" ADD CONSTRAINT "lote_recepcion_id_fkey"
  FOREIGN KEY ("recepcion_id") REFERENCES "recepcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unidades del centro que reciben de bodega pero no reportan cada mes
-- (Emergencia, Labor y Parto...): lo que se les entrega es consumo interno.
ALTER TABLE "ubicacion" DROP CONSTRAINT "ubicacion_tipo_check";
ALTER TABLE "ubicacion" ADD CONSTRAINT "ubicacion_tipo_check"
  CHECK ("tipo" IN ('bodega', 'centro_salud', 'puesto_salud', 'centro_comunitario', 'unidad_interna'));

INSERT INTO "ubicacion" ("establecimiento_id", "nombre", "tipo", "orden")
SELECT e."id", u."nombre", 'unidad_interna', u."orden"
FROM "establecimiento" e
CROSS JOIN (VALUES
  ('Emergencia C/S Camotán', 900),
  ('Clínica de Labor y Parto', 901),
  ('Pre-consulta C/S Camotán', 902),
  ('Depto. Enfermería C/S Camotán', 903),
  ('Laboratorio C/S Camotán', 904),
  ('Oficina Salud Reproductiva', 905),
  ('Oficina Saneamiento Ambiental', 906),
  ('Territorio # 1', 907),
  ('Turnos', 908)
) AS u("nombre", "orden")
ON CONFLICT ("establecimiento_id", "nombre") DO NOTHING;
