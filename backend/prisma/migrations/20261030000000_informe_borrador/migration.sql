-- El encargado guarda su informe a medias y lo envía a fin de mes.
ALTER TABLE "reporte_servicio" ADD COLUMN IF NOT EXISTS "enviado_en" TIMESTAMP(3);
-- Lo que ya estaba cargado cuenta como enviado.
UPDATE "reporte_servicio" SET "enviado_en" = "capturado_en" WHERE "enviado_en" IS NULL;
