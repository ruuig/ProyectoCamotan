-- Requisicion Despacho de Almacen (FOR-ASE-01). Todo lo que sale de la
-- bodega a un servicio, a la farmacia incluida, sale por una requisicion:
-- el servicio pide, la bodega autoriza y despacha. El numero es el del
-- formulario impreso autorizado por la Contraloria: el sistema no lo genera,
-- lo registra. El despacho es un traslado ligado a la requisicion.
CREATE TABLE "requisicion" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "numero" TEXT,
    "ubicacion_id" INTEGER NOT NULL,
    "codigo" TEXT,
    "unidad_seccion" TEXT NOT NULL,
    "tipos" TEXT[] NOT NULL DEFAULT ARRAY['medicamentos']::TEXT[],
    "fecha_solicitud" DATE NOT NULL,
    "solicitante" TEXT NOT NULL,
    "jefe" TEXT,
    "recepcion_en" TIMESTAMP(3),
    "observaciones" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'solicitada',
    "registrada_por" INTEGER NOT NULL,
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autorizada_por" INTEGER,
    "autorizada_en" TIMESTAMP(3),
    "despachada_por" INTEGER,
    "despachada_en" TIMESTAMP(3),
    "recibido_por" TEXT,
    "anulada_por" INTEGER,
    "anulada_en" TIMESTAMP(3),
    "motivo_anulacion" TEXT,

    CONSTRAINT "requisicion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "requisicion_estado_check" CHECK ("estado" IN ('solicitada', 'autorizada', 'despachada', 'anulada'))
);
CREATE UNIQUE INDEX "requisicion_numero_unico" ON "requisicion"("establecimiento_id", "numero");
CREATE INDEX "requisicion_ubicacion_fecha" ON "requisicion"("ubicacion_id", "fecha_solicitud");
CREATE INDEX "requisicion_estado" ON "requisicion"("establecimiento_id", "estado");
ALTER TABLE "requisicion" ADD CONSTRAINT "requisicion_establecimiento_id_fkey"
  FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requisicion" ADD CONSTRAINT "requisicion_ubicacion_id_fkey"
  FOREIGN KEY ("ubicacion_id") REFERENCES "ubicacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requisicion" ADD CONSTRAINT "requisicion_registrada_por_fkey"
  FOREIGN KEY ("registrada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requisicion" ADD CONSTRAINT "requisicion_autorizada_por_fkey"
  FOREIGN KEY ("autorizada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requisicion" ADD CONSTRAINT "requisicion_despachada_por_fkey"
  FOREIGN KEY ("despachada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requisicion" ADD CONSTRAINT "requisicion_anulada_por_fkey"
  FOREIGN KEY ("anulada_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un renglon por articulo. El insumo puede faltar: el formulario tambien
-- sirve para equipo que no esta en el catalogo.
CREATE TABLE "requisicion_renglon" (
    "id" SERIAL NOT NULL,
    "requisicion_id" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "insumo_id" INTEGER,
    "descripcion" TEXT NOT NULL,
    "unidad_medida" TEXT NOT NULL,
    "cantidad_solicitada" INTEGER NOT NULL,
    "cantidad_autorizada" INTEGER,
    "cantidad_despachada" INTEGER,

    CONSTRAINT "requisicion_renglon_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "requisicion_renglon_cantidades_check" CHECK (
      "cantidad_solicitada" > 0
      AND ("cantidad_autorizada" IS NULL OR "cantidad_autorizada" >= 0)
      AND ("cantidad_despachada" IS NULL OR "cantidad_despachada" >= 0)
    )
);
CREATE UNIQUE INDEX "requisicion_renglon_orden" ON "requisicion_renglon"("requisicion_id", "orden");
CREATE INDEX "requisicion_renglon_insumo" ON "requisicion_renglon"("insumo_id");
ALTER TABLE "requisicion_renglon" ADD CONSTRAINT "requisicion_renglon_requisicion_id_fkey"
  FOREIGN KEY ("requisicion_id") REFERENCES "requisicion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "requisicion_renglon" ADD CONSTRAINT "requisicion_renglon_insumo_id_fkey"
  FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El despacho de una requisicion es un traslado.
ALTER TABLE "traslado" ADD COLUMN "requisicion_id" INTEGER;
CREATE UNIQUE INDEX "traslado_requisicion_id_key" ON "traslado"("requisicion_id");
ALTER TABLE "traslado" ADD CONSTRAINT "traslado_requisicion_id_fkey"
  FOREIGN KEY ("requisicion_id") REFERENCES "requisicion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
