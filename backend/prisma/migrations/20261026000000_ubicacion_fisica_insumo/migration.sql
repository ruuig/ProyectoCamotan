-- Dónde está el producto en la bodega (estante, repisa), cuando ya está etiquetado.
ALTER TABLE "insumo" ADD COLUMN "ubicacion_fisica" TEXT;
