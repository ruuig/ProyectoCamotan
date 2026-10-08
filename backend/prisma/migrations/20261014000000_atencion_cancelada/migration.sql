-- Una atencion abierta por error se cancela con su motivo, en vez de quedar
-- en la cola hasta pasar por todo el proceso. No se borra: queda quien la
-- cancelo, cuando y por que.
ALTER TABLE "atencion" DROP CONSTRAINT "atencion_estado_check";
ALTER TABLE "atencion" ADD CONSTRAINT "atencion_estado_check"
  CHECK ("estado" IN ('en_espera', 'en_atencion', 'atendido', 'ausente', 'cancelada'));

ALTER TABLE "atencion" ADD COLUMN "cancelada_en" TIMESTAMP(3);
ALTER TABLE "atencion" ADD COLUMN "cancelada_por" INTEGER;
ALTER TABLE "atencion" ADD COLUMN "motivo_cancelacion" TEXT;
ALTER TABLE "atencion" ADD CONSTRAINT "atencion_cancelada_por_fkey"
  FOREIGN KEY ("cancelada_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Cancelada siempre con motivo; las demas, sin datos de cancelacion.
ALTER TABLE "atencion" ADD CONSTRAINT "atencion_cancelacion_check"
  CHECK (("estado" = 'cancelada') = ("motivo_cancelacion" IS NOT NULL AND "cancelada_en" IS NOT NULL));
