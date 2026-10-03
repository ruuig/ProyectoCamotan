-- Quien atendio la consulta: el SIGSA-4 pide el responsable de la consulta.
ALTER TABLE "atencion" ADD COLUMN "atendida_por" INTEGER;
ALTER TABLE "atencion" ADD CONSTRAINT "atencion_atendida_por_fkey"
  FOREIGN KEY ("atendida_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Constancia de que el paciente (o quien lo acompana) recibio los
-- medicamentos: la firma o huella que pide el SIGSA-4. Una por entrega.
CREATE TABLE "constancia_entrega" (
    "id" SERIAL NOT NULL,
    "atencion_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "quien_recibe" TEXT NOT NULL,
    "nombre_recibe" TEXT,
    "imagen" BYTEA,
    "registrada_por" INTEGER NOT NULL,
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constancia_entrega_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "constancia_entrega_tipo_check" CHECK ("tipo" IN ('firma', 'huella', 'papel')),
    CONSTRAINT "constancia_entrega_quien_check" CHECK ("quien_recibe" IN ('paciente', 'responsable', 'otro')),
    -- La firma y la huella llevan imagen; "papel" se firma en la hoja impresa.
    CONSTRAINT "constancia_entrega_imagen_check" CHECK (("tipo" = 'papel') = ("imagen" IS NULL))
);
CREATE INDEX "constancia_entrega_atencion_id_idx" ON "constancia_entrega"("atencion_id");
ALTER TABLE "constancia_entrega" ADD CONSTRAINT "constancia_entrega_atencion_id_fkey"
  FOREIGN KEY ("atencion_id") REFERENCES "atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "constancia_entrega" ADD CONSTRAINT "constancia_entrega_registrada_por_fkey"
  FOREIGN KEY ("registrada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
