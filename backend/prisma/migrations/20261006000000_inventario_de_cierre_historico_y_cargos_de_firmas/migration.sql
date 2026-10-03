-- Cargos que van bajo las firmas de los formatos de la bodega.
ALTER TABLE "configuracion_logistica"
  ADD COLUMN "cargo_encargado_bodega" TEXT NOT NULL DEFAULT 'Encargado de Bodega',
  ADD COLUMN "cargo_coordinador" TEXT NOT NULL DEFAULT 'Coordinador Municipal de Salud';

-- Inventario de cierre mensual que el centro llevaba en Excel, para los meses
-- anteriores al sistema.
CREATE TABLE "inventario_cierre_historico" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "saldo_anterior" INTEGER NOT NULL,
    "entradas" INTEGER NOT NULL,
    "entregado" INTEGER NOT NULL,
    "saldo_actual" INTEGER NOT NULL,

    CONSTRAINT "inventario_cierre_historico_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventario_cierre_historico_establecimiento_id_periodo_insumo_id_key"
  ON "inventario_cierre_historico"("establecimiento_id", "periodo", "insumo_id");
CREATE INDEX "inventario_cierre_historico_establecimiento_id_periodo_idx"
  ON "inventario_cierre_historico"("establecimiento_id", "periodo");

ALTER TABLE "inventario_cierre_historico"
  ADD CONSTRAINT "inventario_cierre_historico_establecimiento_id_fkey"
  FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventario_cierre_historico"
  ADD CONSTRAINT "inventario_cierre_historico_insumo_id_fkey"
  FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
