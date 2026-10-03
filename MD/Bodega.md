# 04. Inventario y trazabilidad de insumos

Sistema clínico del Centro de Salud de Camotán, Chiquimula. **Reemplaza a `PROMPT_INVENTARIO_TRAZABILIDAD.md`.**

El módulo de inventario ya existe en el proyecto. Este documento explica cómo debe funcionar según **los archivos de Excel que hoy usa la bodega del centro**, que se analizaron uno por uno, y según la normativa del MSPAS.

**Qué necesito de ti:** revisa el inventario, los lotes, la dispensación y las alertas actuales. Compáralos con esto y dame una lista de diferencias ordenada por importancia. Después corrígelas una por una. No reescribas lo que ya funciona.

Todo texto visible con tildes. Usa los términos del centro y del MSPAS: BRES, balance, inventario de cierre, semáforo, PEPE, reajuste, demanda.

---

## 1. Cómo trabaja hoy la bodega

La bodega lleva cuatro archivos de Excel encadenados entre sí con fórmulas:

| Archivo | Qué contiene |
|---|---|
| **Inventario de cierre** | Una hoja por mes desde 2019, con corte el día 25. Por medicamento: saldo anterior, entradas, entregado, saldo actual. Es la existencia física de la bodega. |
| **Balance de medicamentos** | Una hoja por mes, 307 medicamentos, y en columnas la bodega más 31 servicios. Por servicio: saldo anterior, entradas, entregado a usuarios, no entregado, saldo siguiente, promedio. Al final, columnas de existencia física y totales del municipio. |
| **BRES** | La columna de totales del balance en formato de impresión: 18 páginas de unos 20 medicamentos, con firmas del encargado de bodega y del coordinador municipal. Calcula el pedido para 4 meses. |
| **Semáforo** | Lotes y vencimientos por medicamento, separados a mano en hojas Rojo, Amarillo y Verde, máximo tres lotes por medicamento. |

### Problemas encontrados en esos archivos (contexto para el diseño)
- El medicamento se identifica por su fila, no por un código. Una misma fila cambió de producto entre 2025 y 2026.
- Fórmulas entre archivos que apuntan a celdas equivocadas y arrastran errores de saldo.
- Nombres distintos para el mismo insumo entre archivos.
- El semáforo no se conecta con entregas ni servicios, y tiene fechas imposibles.
- En marzo de 2023 se agregaron columnas de lote y vencimiento al inventario y se abandonaron al mes siguiente.

---

## 2. Catálogo único de insumos

Cada insumo tiene **código interno propio**; nunca se identifica por posición ni por el nombre del proveedor.

Campos: código, nombre genérico, forma farmacéutica, concentración, presentación, unidad de entrega, categoría, si es perecedero, si requiere cadena de frío, código de barras del fabricante (opcional), costo unitario de referencia, activo.

### Categorías con el color que ya usa el centro
| Color | Categoría |
|---|---|
| Azul | Medicamentos |
| Naranja | Suplementos |
| Morado | Planificación familiar |
| Verde | Médico quirúrgico |
| Amarillo | Laboratorio |
| Rojo | Tuberculosis |
| Negro | Para eliminar (inactivo) |

### Ordenamientos de la lista
La lista de insumos se puede ordenar y filtrar: alfabético, por categoría, por existencia, por meses de existencia, por semáforo. Al imprimir, se elige el orden.

### Alias para migrar el historial
Cada insumo guarda los nombres con que aparece en los Excel viejos ("Condon masculino", "Condón masculino, unidad"). La importación del historial usa esos alias para no perder meses.

---

## 3. Ubicaciones: la bodega y los servicios

La bodega y cada servicio son **ubicaciones**. El insumo no sale de la bodega y desaparece: **se traslada a un servicio, con su lote**.

Servicios tomados del balance (cargar como catálogo editable por el administrador):

Post-consulta (Centro de Salud), P/S Caparjá, C/C Anicillo, P/S Shalaguá, C/C Chapulín, P/S Lantiquín, C/C Marimba, C/C Chaguitón, C/C Cañón Tisipe, Centro Comunitario Tierra Blanca, C/C Nuevo Porvenir Tesoro, Centro Comunitario Morola, Centro Comunitario Volcán, Centro Comunitario Roblarcito, C/C Pententá Nearar, C/C Nearar Pitahaya, Centro Comunitario Nearar Cumbre, C/C Muyurcó, Centro Comunitario Plan Tular, Centro Comunitario Limón Timoté, C/C Plan del Morro, Centro Comunitario Despoblado, Centro Comunitario Pashapa, Centro Comunitario Rodeo, C/C Cajón del Río, Centro Comunitario Filincas, Centro Comunitario Guayabo, C/C San Antonio, Centro Comunitario Shupa, Centro Comunitario Calichal, Centro Comunitario Tizamarté.

Cada ubicación: nombre, tipo (bodega, centro de salud, puesto de salud, centro comunitario), comunidad, activo.

---

## 4. Lote y movimientos

### Lote
Insumo, número de lote, fecha de vencimiento, fecha de fabricación, fabricante, registro sanitario, costo unitario, origen (despacho del área de salud, donación con número de acta, traslado, préstamo), ubicación en bodega, estado.

Estados: disponible, cuarentena, retirado, vencido, agotado, dado de baja. Solo un lote disponible se puede entregar o trasladar.

**Validaciones:** la fecha de vencimiento no puede ser anterior a la de fabricación ni a la fecha actual al recibir; si vence en menos de 3 meses, se avisa.

### Movimientos
Todo cambio de existencia es un movimiento: ingreso, traslado a servicio, entrega a paciente, consumo interno, reajuste positivo o negativo, baja.

**Regla central:** el saldo no se edita, es la suma de los movimientos. Los movimientos no se borran ni se editan; un error se corrige con un reajuste con causa. El saldo se puede calcular por lote y por ubicación.

### Causas de reajuste (catálogo del MSPAS)
**Positivos:** sobrante en inventario físico, sobrante en recepción, traslado o préstamo recibido, corrección de error de registro, devolución de un nivel inferior, donación que no viene del nivel superior.

**Negativos:** faltante en inventario físico, faltante en recepción, traslado o préstamo enviado, corrección de error de registro, devolución a un nivel superior, producto vencido, producto dañado.

---

## 5. El flujo de un lote

### 5.1 Recepción en bodega
Se registra contra el documento de despacho: insumo, lote, vencimiento, cantidad según documento, cantidad recibida, registro sanitario.

Verificación por línea: etiquetado completo, empaque íntegro y sin humedad, aspecto físico según la forma farmacéutica. Si algo no cumple, el lote entra en cuarentena. Si la cantidad no coincide, se registra lo recibido y la diferencia queda anotada.

Al ingresar, el lote ya tiene su semáforo.

### 5.2 Traslado de bodega a servicios
La bodega abastece a puestos de salud y centros comunitarios. Cada traslado registra: servicio de destino, insumo, **lote**, cantidad, fecha, quién entrega y quién recibe. Se puede imprimir un comprobante del traslado.

El sistema propone el lote que vence primero (criterio PEPE).

#### Propuesta de distribución
Hoy la bodega divide su existencia entre el número de servicios (30 en 2022, 32 en 2025) y redondea a presentaciones completas para decidir cuánto mandar a cada uno. El sistema debe ofrecer esa propuesta automáticamente con dos modos:
- **Partes iguales**, como lo hacen hoy.
- **Según el consumo de cada servicio**, usando su promedio de entregas reportadas.

En ambos modos, la cantidad se redondea hacia abajo a múltiplos de la presentación del insumo (caja, paquete). El encargado ajusta antes de confirmar.

### 5.3 Entrega a pacientes en el centro
En post-consulta, la prescripción llega de la consulta. El sistema propone el lote disponible que vence primero; elegir otro exige motivo. La entrega queda ligada a paciente, atención, prescripción y lote.

**Demanda no atendida:** si la existencia no alcanza, lo que falta se registra automáticamente como "no entregado". Es la columna "No entregado" del balance y del BRES, y la del SIGSA 4.

### 5.4 Reporte mensual de los servicios
Los puestos y centros comunitarios entregan medicamento a sus pacientes en papel y envían su reporte mensual a la bodega. Es lo que hoy se digita en el balance.

Pantalla de captura por servicio y mes, con estas columnas por insumo:

| Columna | Origen |
|---|---|
| Saldo anterior | Calculado del mes anterior |
| Entradas | **Precargado** desde los traslados que hizo la bodega a ese servicio |
| Entregado a usuarios | Se captura del reporte |
| No entregado | Se captura del reporte |
| Saldo siguiente | Calculado: saldo anterior + entradas − entregado |
| Saldo reportado por el servicio | Se captura, opcional |

Si el saldo reportado no coincide con el calculado, se marca la diferencia. Si las entradas que reporta el servicio no coinciden con lo trasladado, también.

Una lista del mes muestra qué servicios ya reportaron y cuáles faltan.

La captura debe ser rápida: tabla con todos los insumos del servicio, navegación con teclado, y opción de mostrar solo los insumos que ese servicio maneja.

### 5.5 Inventario de cierre de bodega
Corte mensual (día de corte configurable, hoy 25). Como el Excel del centro (INVENTARIOS CIERRE): saldo anterior, entradas, entregado (pacientes, consumo interno y traslados), reajustes y saldo actual de la bodega. Sale de los movimientos; nadie lo llena. Es el paso 2 del cierre del mes y se imprime en su formato.

Los meses anteriores al sistema (enero 2019 a septiembre 2026) muestran el inventario de cierre del Excel tal cual, importado con `scripts/importarInventarioCierre.js`. Las firmas (nombre y cargo del encargado de bodega y del visto bueno) se editan en Administración → Logística.

Los BRES importados de septiembre 2025 a abril 2026 venían con #REF! en sus totales; se reconstruyeron con `scripts/repararBresHistorico.js` (I y C del inventario de cierre, H = I + saldos de los servicios), reglas que coinciden al 100 % en los meses completos.

El cierre del mes tiene tres pasos: reportes de servicios, inventario de cierre y BRES. El balance consolidado ya no es un paso aparte: es la vista "Detalle por servicio" del BRES (bodega, post-consulta y cada servicio), con su impresión y su Excel. Falta confirmar si el Área de Salud pide el balance además del BRES.

El conteo físico ciego por lote se quitó de la interfaz (octubre 2026): el centro no cuenta, lleva el saldo calculado. El servicio y sus rutas siguen en el servidor por si se retoma.

---

## 6. Semáforo automático

Se calcula desde la fecha de vencimiento de cada lote, siempre, sin mover nada a mano y sin límite de lotes por insumo.

**Rangos del Centro de Salud de Camotán** (valores por defecto, configurables en Administración):

| Color | Vence en |
|---|---|
| Rojo | Menos de 12 meses |
| Amarillo | De 12 a 18 meses |
| Verde | Más de 18 meses |

Además: lotes vencidos aparecen aparte, bloqueados para entrega. Las alertas de vencimiento muestran el excedente: lo que sobrará del lote al consumo actual.

Vista del semáforo con los mismos datos que hoy: insumo, y por cada lote su cantidad, número y vencimiento, más el saldo total. Filtrable por color y por categoría.

---

## 7. Cálculos del balance y del BRES

El BRES es la columna de totales del balance. Se calcula así, **con la fórmula que usa el centro**:

| Col. | Concepto | Cálculo |
|---|---|---|
| B | Saldo anterior | Saldo del municipio al cierre del mes anterior (bodega + servicios) |
| C | Entradas | Ingresos a bodega del mes |
| D | Entregado a usuarios | Entregas del centro + entregado reportado por los servicios |
| E | No entregado | Demanda no atendida del centro + la reportada por los servicios |
| F | Demanda | D + E |
| G | Reajustes | Suma de reajustes del mes (confirmar en el centro) |
| H | Saldo siguiente del municipio | B + C − D ± G |
| I | Existencia física en bodega | Saldo del inventario de cierre de la bodega |
| J | Promedio | Promedio mensual de la demanda (confirmar cuántos meses usa el centro; el MSPAS indica 6) |
| K | Meses de existencia | H ÷ J |
| L | Máximo | J × nivel máximo (hoy 4 meses) |
| M | Cantidad a pedir | L − I; **si es negativo, se muestra 0** |

Niveles configurables: hoy el BRES trae **mínimo 2 meses y máximo 4 meses**.

**Nota para la tesis:** el centro resta la existencia de bodega (I) para calcular el pedido, mientras que el procedimiento del MSPAS resta el saldo total. El sistema replica la fórmula del centro, porque es la que acepta el área de salud, y deja la del MSPAS como opción configurable.

Si J es cero, K se muestra como "sin consumo" en lugar de un error de división.

---

## 8. Documentos imprimibles

Todos como vista de impresión en tamaño carta, igual que las fichas clínicas. **Reproducen el formato actual del centro y solo llenan los datos.** Cada impresión queda en bitácora.

1. **BRES:** mismo formato que el Excel de impresión, mismas columnas, unos 20 insumos por página, encabezado con municipio, servicio, mes y año, niveles mínimo y máximo, y al pie las firmas del encargado de bodega y del coordinador municipal (nombres configurables).
2. **Balance consolidado:** por mes, insumos en filas y servicios en columnas, con totales.
3. **Inventario de cierre:** saldo anterior, entradas, entregado, saldo actual.
4. **Hoja de conteo** para el inventario físico (ciega).
5. **Semáforo:** por color, con lotes y vencimientos.
6. **Comprobante de traslado** a un servicio.
7. **Tarjeta de control (kardex) de apoyo** por insumo, con leyenda indicando que la oficial es la autorizada por la Contraloría General de Cuentas.
8. **Oficio de baja** con cantidad, lote, número de tarjeta, precio y vencimiento.
9. **Formato en blanco** de cada uno, para contingencia.

Cada documento permite elegir el orden del listado (alfabético o por categoría) y filtrar por categoría.

Además, exportación a Excel del balance y del BRES con la misma estructura de columnas, por si el área de salud lo pide en ese formato.

---

## 9. Trazabilidad

Hay **dos niveles**, y el sistema debe mostrarlo así de claro:

- **En el centro de salud**, la trazabilidad llega **hasta el paciente**: de cada lote se sabe quién lo recibió, cuándo y por qué diagnóstico.
- **En puestos y centros comunitarios**, que entregan en papel, llega **hasta el servicio**: se sabe qué lote, cuánto y cuándo se trasladó a cada uno.

### Desde un lote
Recorrido completo en orden: recepción, traslados a servicios, entregas a pacientes, reajustes, bajas. Con dos listas: servicios que lo recibieron (con cantidad y fecha) y pacientes del centro que lo recibieron.

### Desde un paciente
Todos los lotes que ha recibido y su estado actual. Si alguno tiene retiro activo, se marca en su ficha.

### Retiro sanitario
Al registrar la alerta, los lotes pasan a retirado en todas las ubicaciones. El sistema genera dos listas: **pacientes del centro** que lo recibieron, con comunidad y teléfono, y **servicios** a los que se trasladó, con la cantidad enviada. Se registra el seguimiento de cada uno hasta cerrar el retiro.

Toda consulta y cambio queda en bitácora.

---

## 10. Alertas

| Alerta | Condición | Se resuelve |
|---|---|---|
| Existencia | Meses de existencia bajo el nivel mínimo | Sola, al recibir despacho |
| Desabastecimiento | Saldo en cero con demanda en el mes | Sola, al recibir despacho |
| Vencimiento | Lote en rojo con excedente | Sola, al agotarse, trasladarse o darse de baja |
| Reporte pendiente | Servicio sin reporte del mes después del corte | Al capturar el reporte |
| Diferencia en reporte | Saldo o entradas del servicio no cuadran | Al revisar y aceptar o corregir |
| Inventario pendiente | Pasó el corte sin inventario de cierre | Al registrarlo |
| BRES pendiente | Cierre del mes sin BRES generado | Al generarlo |
| Cuarentena | Lote en cuarentena más de 7 días | Al liberarlo o darlo de baja |

---

## 11. Migración del historial

Importar desde los Excel actuales para no empezar de cero:
- **Catálogo** desde la lista del balance (307 insumos), usando los alias para unificar nombres.
- **Saldo inicial por ubicación** desde el último mes del balance y del inventario de cierre.
- **Lotes iniciales** desde el semáforo, revisando fechas imposibles antes de importar.
- **Historial mensual** del inventario de cierre y del balance como movimientos agregados por mes, para que el promedio tenga datos desde el primer día.

La importación genera un reporte de lo que no pudo emparejar para revisarlo a mano.

---

## Cómo quedó *(implementado)*

| Sección | Estado |
|---|---|
| 2. Catálogo único | Código interno propio; categorías del centro con su color (azul, naranja, morado, verde, amarillo, rojo); "para eliminar" es un insumo inactivo. Código de barras, costo de referencia y unidades por empaque. Alias de los Excel viejos, sin repetirse entre insumos. Lista filtrable y ordenable (alfabético, categoría, existencia, meses, semáforo). |
| 3. Ubicaciones | Tabla `ubicacion` con la bodega, post-consulta y los 30 servicios del balance, editable en Administración → Ubicaciones de bodega. |
| 4. Lote y movimientos | Fecha de fabricación; el vencimiento no puede ser anterior a la fabricación ni a hoy; aviso si vence en menos de 3 meses. El saldo sigue siendo la suma de movimientos. |
| 5.1 Recepción | Sin cambios de fondo (ya existía con verificación y cuarentena). |
| 5.2 Traslados | Pantalla Inventario → Traslados: servicio de destino, quién recibe, renglones con lote (PEPE propuesto), número TRA-AAAA-NNNN y comprobante impreso. Propuesta de distribución en partes iguales o según consumo, redondeada a la caja. |
| 5.3 Entrega a pacientes | Sin cambios (ya existía, con demanda no atendida). |
| 5.4 Reporte de servicios | Pantalla Inventario → Reportes de servicios: lista de quién reportó y quién falta; captura con teclado; entradas precargadas desde los traslados; diferencias de saldo y de entradas marcadas; se aceptan explicando el motivo. |
| 5.5 Inventario físico | Ya existía (conteo ciego, reajustes, autorización del director). |
| 6. Semáforo | Rangos del centro (rojo < 12, amarillo 12–18, verde > 18), configurables; vencidos aparte. Se usa en todo el sistema. Pantalla Inventario → Semáforo. |
| 7. Balance y BRES | Fórmula del centro, columnas B a M. B suma la bodega y los servicios. M = L − I (o L − H con la fórmula del MSPAS, configurable). Niveles 2 y 4 meses configurables, y mandan también en el inventario y las alertas. Si J es cero, K dice "sin consumo". |
| 8. Documentos | BRES (unos 20 insumos por página, firmas configurables), balance consolidado (horizontal), inventario de cierre, hoja de conteo, semáforo, comprobante de traslado, tarjeta de control y oficio de baja. Orden y filtro por categoría. Formato en blanco con `?blanco=1` (y `/imprimir/traslado/blanco`). Toda impresión queda en bitácora. Excel del balance y del BRES. |
| 9. Trazabilidad | Desde un lote: pacientes del centro y servicios a los que se trasladó. El retiro sanitario lista también los servicios. |
| 10. Alertas | Se agregaron "reporte pendiente" (solo servicios que ya reciben traslados, después del día de corte) y "diferencia en reporte". |
| 11. Migración | **Pendiente**: faltan los Excel de la bodega en el proyecto (ver `pendientes.md`). |

Decisiones tomadas al implementar:

- Post-consulta entrega desde los mismos lotes de la bodega, así que no tiene saldo propio: en el balance es la columna de lo entregado a pacientes en el centro.
- El consumo interno cuenta en D y las bajas en G, porque el BRES del centro no tiene columnas aparte para eso.
- Un servicio que nunca ha reportado parte de lo que se le trasladó como saldo anterior.

## Pendientes por confirmar en el centro

- Fecha de corte de los reportes de los servicios (el inventario de cierre es al 25 y el BRES tiene fecha 30).
- Qué representa la columna G del BRES (siempre en cero; se asume reajustes).
- Cuántos meses usa el centro para el promedio.
- Si la columna que divide la existencia entre 30 o 32 es, efectivamente, la cuota de reparto a los servicios.

## Criterios de aceptación

1. Ningún insumo se identifica por posición; todo usa el código del catálogo.
2. El saldo de cualquier lote y ubicación se reconstruye sumando sus movimientos.
3. Cada traslado a un servicio queda con su lote.
4. Las entradas del reporte de un servicio vienen precargadas desde los traslados.
5. El semáforo se calcula solo con los rangos del centro.
6. El BRES impreso reproduce el formato actual y su cantidad a pedir coincide con la fórmula del centro.
7. Desde un lote se ven servicios y pacientes que lo recibieron; desde un paciente, sus lotes.
8. Un retiro sanitario genera la lista de pacientes y de servicios afectados.

Empieza revisando el estado actual del módulo y dame la lista de diferencias.