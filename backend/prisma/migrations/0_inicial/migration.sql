-- CreateTable
CREATE TABLE "establecimiento" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "municipio" TEXT NOT NULL,
    "departamento" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "establecimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "dpi" TEXT,
    "rol" TEXT NOT NULL,
    "es_director" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paciente" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "cui" TEXT,
    "expediente" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "fecha_nacimiento" TIMESTAMP(3) NOT NULL,
    "sexo" TEXT NOT NULL,
    "comunidad" TEXT NOT NULL,
    "telefono" TEXT,
    "idioma_materno" TEXT NOT NULL DEFAULT 'espanol',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "condicion_paciente" (
    "id" SERIAL NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMP(3),

    CONSTRAINT "condicion_paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinica" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "clinica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signo_peligro" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "grupo_etario" TEXT NOT NULL,
    "gravedad_sugerida" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "actualizado_por" INTEGER,

    CONSTRAINT "signo_peligro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "antropometria" (
    "id" SERIAL NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "atencion_id" INTEGER,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edad_meses" INTEGER NOT NULL,
    "peso" DECIMAL(5,2) NOT NULL,
    "talla" DECIMAL(5,2) NOT NULL,
    "perimetro_cefalico" DECIMAL(4,1),
    "perimetro_braquial" DECIMAL(4,1),
    "z_peso_edad" DECIMAL(4,2),
    "z_talla_edad" DECIMAL(4,2),
    "z_peso_talla" DECIMAL(4,2),
    "z_imc_edad" DECIMAL(4,2),
    "clasificacion" TEXT,

    CONSTRAINT "antropometria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referencia_oms" (
    "id" SERIAL NOT NULL,
    "indicador" TEXT NOT NULL,
    "sexo" TEXT NOT NULL,
    "x" DECIMAL(6,2) NOT NULL,
    "l" DECIMAL(10,6) NOT NULL,
    "m" DECIMAL(10,6) NOT NULL,
    "s" DECIMAL(10,6) NOT NULL,

    CONSTRAINT "referencia_oms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atencion" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "clinica_id" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'en_espera',
    "gravedad" TEXT NOT NULL,
    "puntaje" INTEGER NOT NULL DEFAULT 0,
    "ausencias" INTEGER NOT NULL DEFAULT 0,
    "motivo_consulta" TEXT NOT NULL,
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reingreso_en" TIMESTAMP(3),
    "llamada_en" TIMESTAMP(3),
    "iniciada_en" TIMESTAMP(3),
    "cerrada_en" TIMESTAMP(3),
    "diagnostico_cie" TEXT,
    "diagnostico_txt" TEXT,
    "tratamiento" TEXT,
    "proxima_cita" TIMESTAMP(3),

    CONSTRAINT "atencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preconsulta" (
    "id" SERIAL NOT NULL,
    "atencion_id" INTEGER NOT NULL,
    "peso" DECIMAL(5,2),
    "talla" DECIMAL(5,2),
    "temperatura" DECIMAL(4,1),
    "presion_sis" INTEGER,
    "presion_dia" INTEGER,
    "frec_cardiaca" INTEGER,
    "frec_respiratoria" INTEGER,
    "sat_oxigeno" INTEGER,
    "signos_peligro" TEXT[],
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preconsulta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insumo" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "codigo_mspas" TEXT,
    "nombre_generico" TEXT NOT NULL,
    "nombre_comercial" TEXT,
    "componente" TEXT,
    "categoria" TEXT NOT NULL,
    "presentacion" TEXT NOT NULL,
    "unidad_medida" TEXT NOT NULL,
    "stock_minimo" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lote" (
    "id" SERIAL NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "numero_lote" TEXT NOT NULL,
    "fecha_vence" TIMESTAMP(3) NOT NULL,
    "cantidad_inicial" INTEGER NOT NULL,
    "cantidad_actual" INTEGER NOT NULL,
    "recibido_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescripcion" (
    "id" SERIAL NOT NULL,
    "atencion_id" INTEGER NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "indicaciones" TEXT,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispensacion" (
    "id" SERIAL NOT NULL,
    "prescripcion_id" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "parcial" BOOLEAN NOT NULL DEFAULT false,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "usuario_id" INTEGER NOT NULL,
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispensacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_insumo" (
    "id" SERIAL NOT NULL,
    "lote_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "saldo_resultante" INTEGER NOT NULL,
    "dispensacion_id" INTEGER,
    "usuario_id" INTEGER NOT NULL,
    "motivo" TEXT,
    "registrado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimiento_insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerta" (
    "id" SERIAL NOT NULL,
    "establecimiento_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidad" TEXT NOT NULL,
    "entidad_tipo" TEXT NOT NULL,
    "entidad_id" INTEGER NOT NULL,
    "mensaje" TEXT NOT NULL,
    "atendida" BOOLEAN NOT NULL DEFAULT false,
    "atendida_por" INTEGER,
    "generada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitacora" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" INTEGER,
    "ip" TEXT,
    "detalle" TEXT,
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bitacora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operacion_idempotente" (
    "clave" TEXT NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "respuesta" JSONB,
    "registrada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operacion_idempotente_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "establecimiento_codigo_key" ON "establecimiento"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_usuario_key" ON "usuario"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_dpi_key" ON "usuario"("dpi");

-- CreateIndex
CREATE INDEX "usuario_establecimiento_id_rol_idx" ON "usuario"("establecimiento_id", "rol");

-- CreateIndex
CREATE UNIQUE INDEX "paciente_cui_key" ON "paciente"("cui");

-- CreateIndex
CREATE INDEX "paciente_establecimiento_id_apellidos_nombres_idx" ON "paciente"("establecimiento_id", "apellidos", "nombres");

-- CreateIndex
CREATE INDEX "paciente_establecimiento_id_comunidad_idx" ON "paciente"("establecimiento_id", "comunidad");

-- CreateIndex
CREATE UNIQUE INDEX "paciente_establecimiento_id_expediente_key" ON "paciente"("establecimiento_id", "expediente");

-- CreateIndex
CREATE INDEX "condicion_paciente_paciente_id_idx" ON "condicion_paciente"("paciente_id");

-- CreateIndex
CREATE INDEX "clinica_establecimiento_id_activa_disponible_idx" ON "clinica"("establecimiento_id", "activa", "disponible");

-- CreateIndex
CREATE INDEX "signo_peligro_establecimiento_id_activo_orden_idx" ON "signo_peligro"("establecimiento_id", "activo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "signo_peligro_establecimiento_id_codigo_key" ON "signo_peligro"("establecimiento_id", "codigo");

-- CreateIndex
CREATE INDEX "antropometria_paciente_id_fecha_idx" ON "antropometria"("paciente_id", "fecha");

-- CreateIndex
CREATE INDEX "antropometria_clasificacion_idx" ON "antropometria"("clasificacion");

-- CreateIndex
CREATE UNIQUE INDEX "referencia_oms_indicador_sexo_x_key" ON "referencia_oms"("indicador", "sexo", "x");

-- CreateIndex
CREATE INDEX "atencion_establecimiento_id_estado_puntaje_idx" ON "atencion"("establecimiento_id", "estado", "puntaje" DESC);

-- CreateIndex
CREATE INDEX "atencion_registrada_en_idx" ON "atencion"("registrada_en");

-- CreateIndex
CREATE INDEX "atencion_paciente_id_registrada_en_idx" ON "atencion"("paciente_id", "registrada_en");

-- CreateIndex
CREATE UNIQUE INDEX "preconsulta_atencion_id_key" ON "preconsulta"("atencion_id");

-- CreateIndex
CREATE INDEX "insumo_establecimiento_id_nombre_generico_idx" ON "insumo"("establecimiento_id", "nombre_generico");

-- CreateIndex
CREATE INDEX "insumo_componente_idx" ON "insumo"("componente");

-- CreateIndex
CREATE UNIQUE INDEX "insumo_establecimiento_id_codigo_mspas_key" ON "insumo"("establecimiento_id", "codigo_mspas");

-- CreateIndex
CREATE INDEX "lote_fecha_vence_idx" ON "lote"("fecha_vence");

-- CreateIndex
CREATE INDEX "lote_insumo_id_fecha_vence_idx" ON "lote"("insumo_id", "fecha_vence");

-- CreateIndex
CREATE UNIQUE INDEX "lote_insumo_id_numero_lote_key" ON "lote"("insumo_id", "numero_lote");

-- CreateIndex
CREATE INDEX "prescripcion_atencion_id_idx" ON "prescripcion"("atencion_id");

-- CreateIndex
CREATE INDEX "prescripcion_insumo_id_idx" ON "prescripcion"("insumo_id");

-- CreateIndex
CREATE INDEX "dispensacion_prescripcion_id_idx" ON "dispensacion"("prescripcion_id");

-- CreateIndex
CREATE INDEX "dispensacion_registrada_en_idx" ON "dispensacion"("registrada_en");

-- CreateIndex
CREATE INDEX "movimiento_insumo_lote_id_registrado_en_idx" ON "movimiento_insumo"("lote_id", "registrado_en");

-- CreateIndex
CREATE INDEX "movimiento_insumo_registrado_en_idx" ON "movimiento_insumo"("registrado_en");

-- CreateIndex
CREATE INDEX "movimiento_insumo_tipo_registrado_en_idx" ON "movimiento_insumo"("tipo", "registrado_en");

-- CreateIndex
CREATE INDEX "alerta_atendida_severidad_idx" ON "alerta"("atendida", "severidad");

-- CreateIndex
CREATE INDEX "alerta_entidad_tipo_entidad_id_idx" ON "alerta"("entidad_tipo", "entidad_id");

-- CreateIndex
CREATE INDEX "bitacora_usuario_id_registrada_en_idx" ON "bitacora"("usuario_id", "registrada_en");

-- CreateIndex
CREATE INDEX "bitacora_entidad_entidad_id_idx" ON "bitacora"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "operacion_idempotente_registrada_en_idx" ON "operacion_idempotente"("registrada_en");

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_establecimiento_id_fkey" FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente" ADD CONSTRAINT "paciente_establecimiento_id_fkey" FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "condicion_paciente" ADD CONSTRAINT "condicion_paciente_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinica" ADD CONSTRAINT "clinica_establecimiento_id_fkey" FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signo_peligro" ADD CONSTRAINT "signo_peligro_establecimiento_id_fkey" FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signo_peligro" ADD CONSTRAINT "signo_peligro_actualizado_por_fkey" FOREIGN KEY ("actualizado_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antropometria" ADD CONSTRAINT "antropometria_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antropometria" ADD CONSTRAINT "antropometria_atencion_id_fkey" FOREIGN KEY ("atencion_id") REFERENCES "atencion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atencion" ADD CONSTRAINT "atencion_establecimiento_id_fkey" FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atencion" ADD CONSTRAINT "atencion_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atencion" ADD CONSTRAINT "atencion_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preconsulta" ADD CONSTRAINT "preconsulta_atencion_id_fkey" FOREIGN KEY ("atencion_id") REFERENCES "atencion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumo" ADD CONSTRAINT "insumo_establecimiento_id_fkey" FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote" ADD CONSTRAINT "lote_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescripcion" ADD CONSTRAINT "prescripcion_atencion_id_fkey" FOREIGN KEY ("atencion_id") REFERENCES "atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescripcion" ADD CONSTRAINT "prescripcion_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensacion" ADD CONSTRAINT "dispensacion_prescripcion_id_fkey" FOREIGN KEY ("prescripcion_id") REFERENCES "prescripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensacion" ADD CONSTRAINT "dispensacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_insumo" ADD CONSTRAINT "movimiento_insumo_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_insumo" ADD CONSTRAINT "movimiento_insumo_dispensacion_id_fkey" FOREIGN KEY ("dispensacion_id") REFERENCES "dispensacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_insumo" ADD CONSTRAINT "movimiento_insumo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_establecimiento_id_fkey" FOREIGN KEY ("establecimiento_id") REFERENCES "establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_atendida_por_fkey" FOREIGN KEY ("atendida_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bitacora" ADD CONSTRAINT "bitacora_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operacion_idempotente" ADD CONSTRAINT "operacion_idempotente_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.13                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
