-- Orden en que el centro lista los insumos en su balance y su BRES. El BRES
-- impreso sigue este orden, no el alfabetico.
ALTER TABLE insumo ADD COLUMN orden_formulario INTEGER;
CREATE INDEX insumo_orden_formulario ON insumo (establecimiento_id, orden_formulario);

-- Promedio que el centro anoto en su balance para cada servicio, cuando el
-- reporte viene del historial importado de los Excel.
ALTER TABLE reporte_servicio_renglon ADD COLUMN promedio_anotado INTEGER;

-- Reportes importados de los Excel: se distinguen de los capturados.
ALTER TABLE reporte_servicio ADD COLUMN importado BOOLEAN NOT NULL DEFAULT false;
