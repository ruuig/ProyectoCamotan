-- Post-consulta: aplicado en el servicio y orientacion al paciente.
ALTER TABLE "dispensacion" ADD COLUMN "aplicada_en_servicio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "atencion" ADD COLUMN "orientado_en" TIMESTAMP(3);
