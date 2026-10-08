-- Cargo que va bajo el nombre de cada usuario en los formularios que firma
-- (SIGSA-3CS, SIGSA-4 y demas hojas impresas).
ALTER TABLE "usuario" ADD COLUMN "cargo" TEXT;
