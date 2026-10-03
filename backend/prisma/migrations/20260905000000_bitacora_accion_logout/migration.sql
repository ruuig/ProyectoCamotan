-- Permite registrar el cierre de sesion en la bitacora.
-- El inicio y el fin de sesion son parte de la trazabilidad de acceso al
-- expediente clinico, no solo las escrituras de datos.

ALTER TABLE bitacora DROP CONSTRAINT IF EXISTS bitacora_accion_check;

ALTER TABLE bitacora ADD CONSTRAINT bitacora_accion_check
  CHECK (accion IN ('crear','leer','actualizar','eliminar','exportar',
                    'login','login_fallido','logout',
                    'config_signos','autorizacion_fallida'));
