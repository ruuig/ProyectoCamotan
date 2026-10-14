-- Catálogo CIE-10 completo de la OPS (versión de 3 y 4 caracteres que usa el
-- MSPAS/SIGSA). La descripción que se muestra es legible (tipo oración, con
-- tildes); la oficial se guarda tal cual viene en la lista.
ALTER TABLE "cie10" ADD COLUMN "descripcion_oficial" TEXT;
ALTER TABLE "cie10" ADD COLUMN "categoria" TEXT;
ALTER TABLE "cie10" ADD COLUMN "capitulo" TEXT;
ALTER TABLE "cie10" ADD COLUMN "nivel" SMALLINT;
-- daga: código de la causa (sistema daga-asterisco); asterisco: manifestación,
-- no se usa solo como diagnóstico principal.
ALTER TABLE "cie10" ADD COLUMN "marca" TEXT;
ALTER TABLE "cie10" ADD CONSTRAINT "cie10_marca_check" CHECK ("marca" IS NULL OR "marca" IN ('daga', 'asterisco'));
-- Una categoría de 3 caracteres con subcódigos no es un código final: se
-- codifica con uno de sus subcódigos.
ALTER TABLE "cie10" ADD COLUMN "tiene_subcodigos" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "cie10_categoria_idx" ON "cie10"("categoria");
CREATE INDEX "cie10_capitulo_idx" ON "cie10"("capitulo");

CREATE TABLE "cie10_capitulo" (
    "numero" TEXT NOT NULL,
    "rango" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "orden" SMALLINT NOT NULL,
    CONSTRAINT "cie10_capitulo_pkey" PRIMARY KEY ("numero")
);
