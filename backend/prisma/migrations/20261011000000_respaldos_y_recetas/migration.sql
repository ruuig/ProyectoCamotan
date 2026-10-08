-- Lo que el medico puede recetar. El material medico quirurgico y el de
-- laboratorio se usan en el servicio, no se entregan al paciente; bodega
-- puede corregir cualquier insumo desde su ficha.
ALTER TABLE "insumo" ADD COLUMN "prescribible" BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE "insumo" SET "prescribible" = FALSE WHERE "categoria" IN ('medico_quirurgico', 'laboratorio');

-- Medicamento recetado que el centro no tiene: el paciente lo consigue fuera.
-- No pasa por farmacia ni descuenta inventario, por eso va aparte de
-- prescripcion, que siempre apunta a un insumo.
CREATE TABLE "receta_externa" (
    "id" SERIAL NOT NULL,
    "atencion_id" INTEGER NOT NULL,
    "medicamento" TEXT NOT NULL,
    "cantidad" INTEGER,
    "indicaciones" TEXT,
    "registrada_por" INTEGER NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receta_externa_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "receta_externa_cantidad_check" CHECK ("cantidad" IS NULL OR "cantidad" > 0)
);
CREATE INDEX "receta_externa_atencion_id_idx" ON "receta_externa"("atencion_id");
ALTER TABLE "receta_externa" ADD CONSTRAINT "receta_externa_atencion_id_fkey"
  FOREIGN KEY ("atencion_id") REFERENCES "atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receta_externa" ADD CONSTRAINT "receta_externa_registrada_por_fkey"
  FOREIGN KEY ("registrada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Respaldo automatico de la base de datos. Una sola fila: la base es una.
-- La hora y el dia son de Guatemala.
CREATE TABLE "configuracion_respaldo" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "automatico" BOOLEAN NOT NULL DEFAULT TRUE,
    "frecuencia" TEXT NOT NULL DEFAULT 'diaria',
    "hora" INTEGER NOT NULL DEFAULT 12,
    "dia_semana" INTEGER NOT NULL DEFAULT 1,
    "conservar" INTEGER NOT NULL DEFAULT 15,
    "ultimo_intento_en" TIMESTAMP(3),
    "ultimo_error" TEXT,
    "actualizado_por" INTEGER,
    "actualizado_en" TIMESTAMP(3),

    CONSTRAINT "configuracion_respaldo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "configuracion_respaldo_una_fila" CHECK ("id" = 1),
    CONSTRAINT "configuracion_respaldo_frecuencia_check" CHECK ("frecuencia" IN ('diaria', 'semanal')),
    CONSTRAINT "configuracion_respaldo_hora_check" CHECK ("hora" BETWEEN 0 AND 23),
    CONSTRAINT "configuracion_respaldo_dia_check" CHECK ("dia_semana" BETWEEN 0 AND 6),
    CONSTRAINT "configuracion_respaldo_conservar_check" CHECK ("conservar" BETWEEN 1 AND 365)
);
ALTER TABLE "configuracion_respaldo" ADD CONSTRAINT "configuracion_respaldo_actualizado_por_fkey"
  FOREIGN KEY ("actualizado_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
INSERT INTO "configuracion_respaldo" ("id") VALUES (1);
