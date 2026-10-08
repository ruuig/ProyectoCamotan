-- La farmacia (post-consulta) lleva su propia existencia, lote por lote.
--
-- La cantidad del lote sigue siendo lo que hay en el centro (bodega mas
-- farmacia); cantidad_farmacia es la parte que esta en la farmacia. Asi los
-- informes del centro no cambian y la bodega es la diferencia.
ALTER TABLE "lote" ADD COLUMN "cantidad_farmacia" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lote" ADD CONSTRAINT "lote_cantidad_farmacia_check"
  CHECK ("cantidad_farmacia" >= 0 AND "cantidad_farmacia" <= "cantidad_actual");

-- Donde ocurrio cada movimiento. Pasar de la bodega a la farmacia son dos
-- movimientos que se anulan en el total: sale de una y entra a la otra.
ALTER TABLE "movimiento_insumo" ADD COLUMN "ubicacion" TEXT NOT NULL DEFAULT 'bodega';
ALTER TABLE "movimiento_insumo" ADD CONSTRAINT "movimiento_insumo_ubicacion_check"
  CHECK ("ubicacion" IN ('bodega', 'farmacia'));
CREATE INDEX "movimiento_insumo_ubicacion_registrado_en_idx" ON "movimiento_insumo"("ubicacion", "registrado_en");

-- Lo entregado a pacientes sale de la farmacia.
UPDATE "movimiento_insumo" SET "ubicacion" = 'farmacia' WHERE "dispensacion_id" IS NOT NULL;

-- Control diario de la farmacia: al cerrar el dia se cuenta lo que hay y la
-- diferencia contra el sistema queda registrada con su motivo.
CREATE TABLE "cierre_farmacia" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cerrado_por" INTEGER NOT NULL,
    "cerrado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacion" TEXT,

    CONSTRAINT "cierre_farmacia_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cierre_farmacia_dia_unico" ON "cierre_farmacia"("establecimiento_id", "fecha");
ALTER TABLE "cierre_farmacia" ADD CONSTRAINT "cierre_farmacia_establecimiento_id_fkey"
  FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_farmacia" ADD CONSTRAINT "cierre_farmacia_cerrado_por_fkey"
  FOREIGN KEY ("cerrado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "conteo_farmacia" (
    "id" SERIAL NOT NULL,
    "cierre_id" INTEGER NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "en_sistema" INTEGER NOT NULL,
    "contado" INTEGER NOT NULL,
    "motivo" TEXT,

    CONSTRAINT "conteo_farmacia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conteo_farmacia_contado_check" CHECK ("contado" >= 0),
    -- Una diferencia no se registra sin explicar por que.
    CONSTRAINT "conteo_farmacia_motivo_check" CHECK ("contado" = "en_sistema" OR "motivo" IS NOT NULL)
);
CREATE UNIQUE INDEX "conteo_farmacia_insumo_unico" ON "conteo_farmacia"("cierre_id", "insumo_id");
ALTER TABLE "conteo_farmacia" ADD CONSTRAINT "conteo_farmacia_cierre_id_fkey"
  FOREIGN KEY ("cierre_id") REFERENCES "cierre_farmacia"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conteo_farmacia" ADD CONSTRAINT "conteo_farmacia_insumo_id_fkey"
  FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Firma o huella digital al entregar: apagada hasta tener el equipo. Mientras
-- tanto el paciente firma el formato en papel.
ALTER TABLE "configuracion_logistica" ADD COLUMN "constancia_digital" BOOLEAN NOT NULL DEFAULT FALSE;
