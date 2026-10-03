-- Alertas de los reportes mensuales de los servicios (MD/Bodega.md seccion 10).
ALTER TABLE alerta DROP CONSTRAINT alerta_tipo_check;
ALTER TABLE alerta ADD CONSTRAINT alerta_tipo_check CHECK (tipo IN (
  'vencimiento', 'existencia_baja', 'desabastecimiento', 'cuarentena',
  'bres_pendiente', 'inventario_pendiente', 'reporte_pendiente', 'diferencia_reporte',
  'cita_vencida', 'patron_clinico', 'desnutricion', 'comunidad_sin_atencion'
));

ALTER TABLE alerta DROP CONSTRAINT alerta_entidad_check;
ALTER TABLE alerta ADD CONSTRAINT alerta_entidad_check
  CHECK (entidad_tipo IN ('lote', 'insumo', 'paciente', 'lugar_poblado', 'establecimiento', 'ubicacion', 'reporte_servicio'));
