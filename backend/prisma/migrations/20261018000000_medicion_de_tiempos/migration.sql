-- Medicion del tiempo de registro y de consulta de fichas (objetivo 1 de la
-- tesis): desde que se empieza a escribir el nombre o el CUI hasta que se
-- guarda el paciente o se abre su ficha. Se mide sola, sin que el personal
-- haga nada; se consulta en una pantalla que no esta en el menu.
CREATE TABLE "medicion_tiempo" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "pantalla" TEXT,
    "milisegundos" INTEGER NOT NULL,
    "paciente_id" INTEGER,
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicion_tiempo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "medicion_tiempo_tipo_check" CHECK ("tipo" IN ('registro', 'consulta')),
    CONSTRAINT "medicion_tiempo_ms_check" CHECK ("milisegundos" >= 0)
);
CREATE INDEX "medicion_tiempo_tipo_fecha" ON "medicion_tiempo"("establecimiento_id", "tipo", "registrada_en");
ALTER TABLE "medicion_tiempo" ADD CONSTRAINT "medicion_tiempo_establecimiento_id_fkey"
  FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicion_tiempo" ADD CONSTRAINT "medicion_tiempo_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicion_tiempo" ADD CONSTRAINT "medicion_tiempo_paciente_id_fkey"
  FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
