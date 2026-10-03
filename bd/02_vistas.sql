-- ============================================================================
-- Script 02: vistas materializadas
--   psql "$DATABASE_URL" -f bd/02_vistas.sql
--
-- Son el unico SQL crudo permitido por la regla 5 de la especificacion.
-- El job refrescarVistas.js las refresca cada hora con REFRESH ... CONCURRENTLY
-- (posible gracias al indice unico de cada una).
-- ============================================================================

BEGIN;

-- Consumo promedio diario de los ultimos 30 dias, por insumo.
-- Alimenta diasCobertura() y excedenteProyectado().
--
-- primer_movimiento y dias_historial se agregan a la definicion original:
-- sin ellos el servicio no puede distinguir "consumo bajo" de "historial
-- insuficiente", y la especificacion exige devolver null en el segundo caso
-- en lugar de un 0 enganoso.
CREATE MATERIALIZED VIEW consumo_diario AS
SELECT
  l.insumo_id,
  SUM(ABS(m.cantidad))::numeric / 30           AS consumo_dia,
  COUNT(*)                                     AS movimientos,
  MAX(m.registrado_en)                         AS ultimo_movimiento,
  MIN(m.registrado_en)                         AS primer_movimiento,
  EXTRACT(DAY FROM NOW() - MIN(m.registrado_en))::int AS dias_historial
FROM movimiento_insumo m
JOIN lote l ON l.id = m.lote_id
WHERE m.tipo = 'salida'
  AND m.registrado_en >= NOW() - INTERVAL '30 days'
GROUP BY l.insumo_id;

CREATE UNIQUE INDEX consumo_diario_insumo_key ON consumo_diario (insumo_id);

-- Saldo vigente por insumo. Evita recorrer todos los lotes en cada pantalla de
-- farmacia y en el panel del administrador.
CREATE MATERIALIZED VIEW saldo_insumo AS
SELECT
  i.id                                  AS insumo_id,
  i.establecimiento_id,
  COALESCE(SUM(l.cantidad_actual), 0)   AS saldo_total,
  COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vence > NOW()), 0) AS saldo_vigente,
  MIN(l.fecha_vence) FILTER (WHERE l.cantidad_actual > 0 AND l.fecha_vence > NOW())
                                        AS proximo_vencimiento,
  COUNT(l.id) FILTER (WHERE l.cantidad_actual > 0) AS lotes_con_saldo
FROM insumo i
LEFT JOIN lote l ON l.insumo_id = i.id
WHERE i.activo = TRUE
GROUP BY i.id, i.establecimiento_id;

CREATE UNIQUE INDEX saldo_insumo_key ON saldo_insumo (insumo_id);
CREATE INDEX saldo_insumo_establecimiento_idx ON saldo_insumo (establecimiento_id);

-- Cobertura territorial: ultima atencion por comunidad.
-- Panel del admin: "comunidades sin atenciones en 30 dias, por rezago".
CREATE MATERIALIZED VIEW cobertura_comunidad AS
SELECT
  p.establecimiento_id,
  p.comunidad,
  COUNT(DISTINCT p.id)                                    AS pacientes,
  COUNT(a.id) FILTER (WHERE a.registrada_en >= NOW() - INTERVAL '30 days') AS atenciones_30d,
  MAX(a.registrada_en)                                    AS ultima_atencion,
  EXTRACT(DAY FROM NOW() - MAX(a.registrada_en))::int     AS dias_sin_atencion
FROM paciente p
LEFT JOIN atencion a ON a.paciente_id = p.id AND a.estado = 'atendido'
WHERE p.activo = TRUE
GROUP BY p.establecimiento_id, p.comunidad;

CREATE UNIQUE INDEX cobertura_comunidad_key
  ON cobertura_comunidad (establecimiento_id, comunidad);

COMMIT;

-- Refresco horario (lo ejecuta jobs/refrescarVistas.js):
--   REFRESH MATERIALIZED VIEW CONCURRENTLY consumo_diario;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY saldo_insumo;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY cobertura_comunidad;
