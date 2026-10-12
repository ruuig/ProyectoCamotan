-- Prioridad parametrizada en tres capas:
--   1. criterio_triaje: signos vitales y otros datos que, segun la edad,
--      llevan al paciente a urgente o moderado.
--   2. parametro_priorizacion: puntos dentro de cada nivel (condicion,
--      espera, distancia, ausencias).
--   3. parametro_priorizacion: tiempo maximo de espera por nivel.
-- Los valores iniciales siguen AIEPI y escalas de triaje de uso corriente;
-- el personal medico los revisa y ajusta desde Administracion.

-- Datos nuevos de la preconsulta que tambien deciden la prioridad.
ALTER TABLE "preconsulta" ADD COLUMN "dolor" SMALLINT;
ALTER TABLE "preconsulta" ADD COLUMN "conciencia" TEXT;
ALTER TABLE "preconsulta" ADD COLUMN "glucosa" SMALLINT;
-- Por que quedo en ese nivel, tal como se calculo al registrarla.
ALTER TABLE "preconsulta" ADD COLUMN "triaje" JSONB;
ALTER TABLE "preconsulta" ADD CONSTRAINT "preconsulta_dolor_check" CHECK ("dolor" IS NULL OR "dolor" BETWEEN 0 AND 10);
ALTER TABLE "preconsulta" ADD CONSTRAINT "preconsulta_conciencia_check"
  CHECK ("conciencia" IS NULL OR "conciencia" IN ('alerta', 'confuso', 'voz', 'dolor', 'no_responde'));
ALTER TABLE "preconsulta" ADD CONSTRAINT "preconsulta_glucosa_check" CHECK ("glucosa" IS NULL OR "glucosa" BETWEEN 10 AND 900);

CREATE TABLE "criterio_triaje" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "campo" TEXT NOT NULL,
    "edad_desde_meses" INTEGER NOT NULL DEFAULT 0,
    "edad_hasta_meses" INTEGER,
    "solo_embarazo" BOOLEAN NOT NULL DEFAULT FALSE,
    "operador" TEXT NOT NULL,
    "valor" DECIMAL(6,1) NOT NULL,
    "nivel" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT TRUE,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "criterio_triaje_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "criterio_triaje_campo_check" CHECK ("campo" IN ('temperatura', 'satOxigeno', 'frecRespiratoria', 'frecCardiaca', 'presionSis', 'presionDia', 'dolor', 'conciencia', 'glucosa', 'desnutricion')),
    CONSTRAINT "criterio_triaje_operador_check" CHECK ("operador" IN ('mayor_igual', 'menor')),
    CONSTRAINT "criterio_triaje_nivel_check" CHECK ("nivel" IN ('urgente', 'moderado')),
    CONSTRAINT "criterio_triaje_edad_check" CHECK ("edad_hasta_meses" IS NULL OR "edad_hasta_meses" > "edad_desde_meses")
);
CREATE INDEX "criterio_triaje_establecimiento" ON "criterio_triaje"("establecimiento_id", "activo");
ALTER TABLE "criterio_triaje" ADD CONSTRAINT "criterio_triaje_establecimiento_id_fkey"
  FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "parametro_priorizacion" (
    "establecimiento_id" INTEGER NOT NULL,
    "puntos" JSONB NOT NULL,
    "actualizado_por" INTEGER,
    "actualizado_en" TIMESTAMP(3),

    CONSTRAINT "parametro_priorizacion_pkey" PRIMARY KEY ("establecimiento_id")
);
ALTER TABLE "parametro_priorizacion" ADD CONSTRAINT "parametro_priorizacion_establecimiento_id_fkey"
  FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parametro_priorizacion" ADD CONSTRAINT "parametro_priorizacion_actualizado_por_fkey"
  FOREIGN KEY ("actualizado_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Puntos y tiempos iniciales: los de la tesis, mas el extra de menor de 2 meses.
INSERT INTO "parametro_priorizacion" ("establecimiento_id", "puntos")
SELECT e."id", '{
  "gravedad": { "urgente": 40, "moderado": 25, "leve": 10 },
  "condicion": { "embarazo": 30, "menor_5": 30, "menor_2_meses": 10, "adulto_mayor": 25, "discapacidad": 25 },
  "espera": [ { "desde": 0, "puntos": 5 }, { "desde": 30, "puntos": 15 }, { "desde": 60, "puntos": 25 }, { "desde": 90, "puntos": 30 } ],
  "distancia": [ { "desde": 30, "puntos": 5 }, { "desde": 60, "puntos": 10 }, { "desde": 120, "puntos": 15 } ],
  "ausencia": 10,
  "tiempoMaximo": { "moderado": 60, "leve": 120 }
}'::JSONB
FROM "establecimiento" e
ON CONFLICT DO NOTHING;

-- Criterios iniciales. Edad en meses: 2 = dos meses, 12 = un anio, 60 = cinco
-- anios, 216 = 18 anios. Conciencia: 1 confuso, 2 responde a la voz, 3 solo
-- al dolor, 4 no responde. Desnutricion: 1 aguda moderada, 2 aguda severa.
INSERT INTO "criterio_triaje" ("establecimiento_id", "campo", "edad_desde_meses", "edad_hasta_meses", "solo_embarazo", "operador", "valor", "nivel", "etiqueta", "orden")
SELECT e."id", c.campo, c.desde, c.hasta, c.embarazo, c.operador, c.valor, c.nivel, c.etiqueta, c.orden
FROM "establecimiento" e
CROSS JOIN (VALUES
  ('temperatura', 0, 2, FALSE, 'mayor_igual', 37.5, 'urgente', 'Fiebre en menor de 2 meses', 10),
  ('temperatura', 0, 2, FALSE, 'menor', 35.5, 'urgente', 'Hipotermia en menor de 2 meses', 11),
  ('temperatura', 2, NULL, FALSE, 'mayor_igual', 40, 'urgente', 'Fiebre muy alta', 12),
  ('temperatura', 2, NULL, FALSE, 'mayor_igual', 39, 'moderado', 'Fiebre alta', 13),
  ('temperatura', 2, NULL, FALSE, 'menor', 35, 'urgente', 'Hipotermia', 14),
  ('satOxigeno', 0, NULL, FALSE, 'menor', 90, 'urgente', 'Saturación crítica', 20),
  ('satOxigeno', 0, NULL, FALSE, 'menor', 94, 'moderado', 'Saturación baja', 21),
  ('frecRespiratoria', 0, 2, FALSE, 'mayor_igual', 60, 'moderado', 'Respiración rápida', 30),
  ('frecRespiratoria', 2, 12, FALSE, 'mayor_igual', 50, 'moderado', 'Respiración rápida', 31),
  ('frecRespiratoria', 12, 60, FALSE, 'mayor_igual', 40, 'moderado', 'Respiración rápida', 32),
  ('frecRespiratoria', 216, NULL, FALSE, 'mayor_igual', 30, 'urgente', 'Respiración muy rápida', 33),
  ('frecRespiratoria', 216, NULL, FALSE, 'mayor_igual', 22, 'moderado', 'Respiración rápida', 34),
  ('frecCardiaca', 216, NULL, FALSE, 'mayor_igual', 130, 'urgente', 'Pulso muy rápido', 40),
  ('frecCardiaca', 216, NULL, FALSE, 'mayor_igual', 110, 'moderado', 'Pulso rápido', 41),
  ('frecCardiaca', 216, NULL, FALSE, 'menor', 40, 'urgente', 'Pulso muy lento', 42),
  ('frecCardiaca', 216, NULL, FALSE, 'menor', 50, 'moderado', 'Pulso lento', 43),
  ('presionSis', 216, NULL, FALSE, 'mayor_igual', 180, 'urgente', 'Presión muy alta', 50),
  ('presionSis', 216, NULL, FALSE, 'mayor_igual', 160, 'moderado', 'Presión alta', 51),
  ('presionSis', 216, NULL, FALSE, 'menor', 90, 'urgente', 'Presión baja', 52),
  ('presionDia', 216, NULL, FALSE, 'mayor_igual', 110, 'urgente', 'Presión muy alta', 53),
  ('presionDia', 216, NULL, FALSE, 'mayor_igual', 100, 'moderado', 'Presión alta', 54),
  ('presionSis', 0, NULL, TRUE, 'mayor_igual', 140, 'urgente', 'Presión alta en el embarazo', 55),
  ('presionDia', 0, NULL, TRUE, 'mayor_igual', 90, 'urgente', 'Presión alta en el embarazo', 56),
  ('dolor', 0, NULL, FALSE, 'mayor_igual', 8, 'urgente', 'Dolor intenso', 60),
  ('dolor', 0, NULL, FALSE, 'mayor_igual', 5, 'moderado', 'Dolor moderado', 61),
  ('conciencia', 0, NULL, FALSE, 'mayor_igual', 2, 'urgente', 'No está alerta', 70),
  ('conciencia', 0, NULL, FALSE, 'mayor_igual', 1, 'moderado', 'Confuso', 71),
  ('glucosa', 0, NULL, FALSE, 'menor', 70, 'urgente', 'Glucosa baja', 80),
  ('glucosa', 0, NULL, FALSE, 'mayor_igual', 300, 'urgente', 'Glucosa muy alta', 81),
  ('glucosa', 0, NULL, FALSE, 'mayor_igual', 250, 'moderado', 'Glucosa alta', 82),
  ('desnutricion', 0, 60, FALSE, 'mayor_igual', 2, 'urgente', 'Desnutrición aguda severa', 90),
  ('desnutricion', 0, 60, FALSE, 'mayor_igual', 1, 'moderado', 'Desnutrición aguda moderada', 91)
) AS c(campo, desde, hasta, embarazo, operador, valor, nivel, etiqueta, orden);

-- Signos de peligro: se quitan los repetidos (se desactivan, para no perder
-- lo que ya se registro con ellos) y se corrigen los que mandaban todo a
-- urgente: si todos son urgentes, nadie lo es.
UPDATE "signo_peligro" s SET "activo" = FALSE
WHERE s."activo" AND EXISTS (
  SELECT 1 FROM "signo_peligro" o
  WHERE o."activo" AND o."establecimiento_id" = s."establecimiento_id"
    AND o."descripcion" = s."descripcion" AND o."grupo_etario" = s."grupo_etario"
    AND o."codigo" < s."codigo"
);
UPDATE "signo_peligro" SET "gravedad_sugerida" = 'moderado'
WHERE "activo" AND "grupo_etario" = 'todos' AND "descripcion" IN ('Vómitos', 'Dolor abdominal', 'Cefalea o dolor de cabeza intenso');
