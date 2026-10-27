-- La baja se hace en un solo paso, sin oficio ni autorización del director:
-- una baja aplicada ya no exige quién la autorizó.
ALTER TABLE oficio_baja DROP CONSTRAINT IF EXISTS oficio_autorizado_check;
