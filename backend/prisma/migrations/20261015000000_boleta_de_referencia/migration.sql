-- Boleta de Referencia y Contrarreferencia del MSPAS. Una por atencion, con
-- su numero correlativo por anio. Lo que se imprime queda guardado tal cual
-- (antecedentes, examen fisico, impresion clinica): es el documento que se
-- entrego, aunque la ficha cambie despues. La contrarreferencia se registra
-- cuando el paciente regresa con ella.
CREATE TABLE "referencia" (
    "id" SERIAL NOT NULL,
    "atencion_id" INTEGER NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "correlativo" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'consulta_externa',
    "servicio_destino" TEXT NOT NULL,
    "telefono" TEXT,
    "hora_traslado" TEXT,
    "historia" TEXT,
    "antecedentes" JSONB NOT NULL DEFAULT '{}',
    "examen_fisico" JSONB NOT NULL DEFAULT '{}',
    "examenes" TEXT,
    "impresion_clinica" TEXT,
    "motivo" TEXT NOT NULL,
    "tratamiento" TEXT,
    "creada_por" INTEGER NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizada_en" TIMESTAMP(3),
    "contra_recibida_en" TIMESTAMP(3),
    "contra_servicio" TEXT,
    "contra_resumen" TEXT,
    "contra_tratamiento" TEXT,
    "contra_diagnostico" TEXT,
    "contra_recomendaciones" TEXT,
    "contra_responsable" TEXT,
    "contra_fecha_alta" DATE,
    "contra_registrada_por" INTEGER,

    CONSTRAINT "referencia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referencia_tipo_check" CHECK ("tipo" IN ('consulta_externa', 'emergencia')),
    CONSTRAINT "referencia_hora_check" CHECK ("hora_traslado" IS NULL OR "hora_traslado" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
CREATE UNIQUE INDEX "referencia_atencion_id_key" ON "referencia"("atencion_id");
CREATE UNIQUE INDEX "referencia_correlativo_key" ON "referencia"("establecimiento_id", "anio", "correlativo");
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_atencion_id_fkey"
  FOREIGN KEY ("atencion_id") REFERENCES "atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_establecimiento_id_fkey"
  FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_creada_por_fkey"
  FOREIGN KEY ("creada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_contra_registrada_por_fkey"
  FOREIGN KEY ("contra_registrada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
