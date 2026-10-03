# Pendientes por confirmar en el Centro de Salud de Camotán

No inventar respuestas a esto. Actualizar `01-pacientes.md` y `02-preconsulta.md` cuando se resuelvan.

## Decide la arquitectura del módulo de consulta (prioridad alta)

1. **¿Ficha general o fichas específicas por edad?** Se encontraron ambas: una "Ficha Clínica" genérica (versión 4/2016, para todos los grupos de población, con antecedentes obstétricos integrados) y seis fichas específicas por etapa (neonato, lactante y niño, adolescente, adulto y persona mayor, de 2018-2019). Pregunta concreta: cuando llega un paciente, ¿el médico usa la ficha general, la específica de su edad, o las dos? Si usan ambas, ¿en qué orden o para qué sirve cada una?

2. **¿Cómo se usa el protocolo AIEPI (2 meses a <5 años)?** Es un documento aparte de la ficha de niñez, con columnas repetidas de fecha y clasificación para seguimiento del mismo episodio. ¿Se llena siempre que un niño de ese rango llega enfermo, o solo en ciertos casos? Esto decide si va integrado a la pantalla de consulta pediátrica o es una pantalla aparte que se abre cuando corresponde.

3. **¿Preconsulta saca la ficha física del estante en cada visita del paciente, o solo la primera vez?**

   *Mientras se resuelve, el sistema deja de depender de la respuesta:* el aviso de "ficha incompleta" con su botón de completar aparece ahora en tres lugares —la ficha del paciente, el panel de dirección y **la pantalla de consulta**—. El médico es quien tiene al paciente enfrente para preguntar lo que falta, así que el momento natural existe aunque preconsulta no saque el papel.

## Catálogos y datos

4. Códigos exactos de "estado civil": la ficha de adulto muestra soltero/a, casado/a, viudo/a. Confirmar si existe "unido/a" (como en otras fuentes del SIGSA) y a partir de qué edad se pregunta. Mientras tanto "Completar ficha" ofrece solo las tres del papel; a quien ya tenía "unido/a" u "otro" guardado se le sigue mostrando, marcado como "registrado antes", sin borrarlo.

5. **Lista exacta de signos de peligro de la ficha de adolescente (10 a <30 años).** No se ha revisado esa página. No se pudo extraer del PDF: no está en la capa de texto (verificado con `pdftotext`, `pypdf` y los campos del formulario). Mientras tanto el sistema usa la lista de adulto para ese grupo y lo marca como provisional en la respuesta; no se inventó ninguna lista.

6. ¿A partir de qué edad se pregunta estado civil, trabaja, y profesión/oficio? Confirmado que aparece en la ficha de adulto (30+) y parcialmente en adolescente; falta precisar el corte exacto.

## Preconsulta y signos vitales

7. ~~¿Las básculas del centro son de libras, kilogramos, o hay de ambas?~~ **Resuelto por diseño.** La pregunta ya no bloquea nada: la pantalla de signos vitales tiene un selector que alterna entre libras y kilogramos, convierte el número ya escrito en vez de borrarlo, y recuerda la última unidad usada en esa tablet. El valor siempre se guarda en kilogramos, y la conversión la hace el servidor, no el navegador. Si el centro confirma que todas las básculas son de una sola unidad, basta con fijar el valor inicial.

8. ¿La vitamina A, el hierro y la desparasitación (calendario de acciones preventivas de niñez) se entregan en consulta general o solo en una clínica de vacunación aparte?

## Logística (confirmar con el Área de Salud, no con el centro)

9. ~~**Tiempo de solicitud y recepción, y frecuencia de pedido.**~~ **Reemplazado por los niveles del BRES del centro** (mínimo 2 y máximo 4 meses, configurables en Administración → Logística). Queda por confirmar que el Área de Salud acepta esos niveles. Texto anterior: De estos dos números salen el nivel mínimo y máximo de todos los insumos, y con ellos cuánto hay que pedir de cada uno. Están configurables en Administración → Logística, con valor provisional de 1 mes cada uno. Mientras la casilla "provisional" esté marcada, toda cifra derivada se muestra señalada como pendiente de confirmar, en pantalla y en el papel.

10. **Formato exacto de columnas del BRES** y del **oficio de baja**. La estructura del BRES viene del servidor en una lista de columnas: ajustarla al formulario impreso del centro es editar esa lista, no rehacer la tabla.

11. **(Sin efecto: el conteo físico se quitó de la interfaz.) Umbral de diferencia del inventario físico que exige autorización del director.** Asumido en 10 unidades o 10 % del saldo, lo que ocurra primero. Una diferencia bajo ese umbral se corrige sola con su reajuste; por encima, el saldo no se toca hasta que el director autorice.

12. **Catálogo CIE-10.** El sistema no lo tiene. Por eso "Diagnósticos del mes" muestra el texto que escribió a mano quien atendió, tomando el más repetido de cada código, y no una descripción oficial. Con el catálogo cargado —por CSV, como los lugares poblados— bastaría con cambiar esa lectura.

## Fuera de alcance por ahora (retomar después)

13. **Digitalización y carga al SIGSA.** El rol de digitalización no participa en la edición de la ficha del paciente (eso ya quedó resuelto: lo hace preconsulta). Su función es cargar los datos al SIGSA WEB, y ese flujo se diseñará en un módulo aparte más adelante. No se encontró evidencia de una API pública para esa integración; el camino más probable es un archivo o reporte que facilite la transcripción, pendiente de ver si existe una plantilla de carga masiva que el centro ya use.

14. Confirmar si la versión del FOR-SIGSA-3CS (noviembre 2017) sigue vigente en Camotán.

## Datos del propio establecimiento

15. **Código institucional del MSPAS.** Hoy está como `PENDIENTE-CAMOTAN`. El nombre, municipio y departamento ya se corrigieron con tildes y salen en el encabezado de toda ficha impresa.

16. **Nombres de insumo sin tildes en la base** ("Guantes de latex", "Suero de rehidratacion oral", "Amoxicilina"). Son datos cargados, no texto del código. Se corrigen con una migración cuando se confirme la ortografía que usa el centro en sus propios listados.

17. **Rangos de signos vitales por edad.** Los que usa el sistema necesitan el visto bueno de alguien del personal médico del centro.

## Fichas clínicas en pantalla

18. **Identificación de la ficha de adolescente y joven (10 a <30 años).** Sigue sin fotografiarse en el centro. "Completar ficha" la arma con los campos comunes y los que se conocen por la versión pública, y la marca como provisional en el encabezado. Al tener la foto, se corrige en `backend/src/services/fichaIdentificacion.service.js` (función `identificacionAdolescente`); el formulario se dibuja solo a partir de esa lista.

19. **Catálogo de municipios.** Solo están cargados los 11 de Chiquimula; para los demás departamentos el municipio se escribe a mano. Los 22 departamentos sí están completos, con su código del INE. Si se quiere el catálogo nacional completo, se carga desde una fuente oficial, no de memoria.

20. **Antecedentes sensibles (violencia, maltrato, ideas suicidas, problemas judiciales).** Ya no aparecen en "Completar ficha" porque no son parte de la identificación en ninguna ficha: en el papel están en las secciones de antecedentes y "En caso de violencia" de cada consulta. Lo ya guardado se conserva en la base. Falta decidir con el centro si esos datos se registran por paciente o por atención antes de darles su pantalla.

## Reparto de la ficha entre preconsulta y médico

21. **Datos mínimos del SIGSA.** El aviso "faltan N datos" cuenta solo departamento y municipio de residencia, pueblo, comunidad lingüística (si es Maya), escolaridad y discapacidad. Confirmar con el SIGSA del Área de Salud si la boleta 3CS exige algún otro dato de identificación.

22. **Tipo de consulta sugerido.** El sistema sugiere "Reconsulta" si el paciente ya consultó este año por el mismo diagnóstico (misma categoría CIE-10, o mismo texto si no tiene código), y "Primera consulta" si no. El corte por año calendario es una suposición; confirmar cómo cuenta el SIGSA la primera consulta. El médico siempre puede cambiarlo.

23. **Catálogo CIE-10.** Sigue sin cargarse (ver punto 12). Ya se puede cargar desde Administración → CIE-10 con un CSV `codigo,descripcion,sinonimos`. Mientras tanto el buscador de la consulta usa los diagnósticos ya escritos en el centro.

24. **En caso de violencia: fecha y hora de notificación.** La consulta registra el lugar (MP, PGN, PNC) y el número, que es lo que pide el 3CS. La fecha y hora de notificación del papel salen en blanco en la ficha impresa; confirmar si se necesitan en el sistema.

25. **Campos antiguos de antecedentes sensibles.** Las columnas `antecedente_violencia`, `antecedente_maltrato`, `ideas_suicidas` y `problemas_judiciales` del paciente ya no se usan: esos datos viven ahora en las secciones de la ficha, con el nombre que tienen en el papel. Se pueden retirar con una migración cuando se confirme.

## Bodega (MD/Bodega.md)

26. **Excel de la bodega para migrar el historial.** Hacen falta el inventario de cierre, el balance, el BRES y el semáforo en la carpeta `plantillas/bodega/` del proyecto. Con ellos se importa el catálogo (307 insumos, unificados con los alias), el saldo inicial por ubicación, los lotes iniciales y el historial mensual, y se ajusta el BRES impreso a su formato exacto.

27. **Fecha de corte de los reportes de los servicios.** Configurada en el día 25, igual que el inventario de cierre; el BRES del Excel tiene fecha 30.

28. **Columna G del BRES.** Siempre estaba en cero en el Excel; el sistema pone ahí los reajustes y las bajas del mes. Confirmar.

29. ~~**Meses del promedio (J).**~~ **Resuelto:** el centro promedia 4 meses (configurado en Administración → Logística).

30. **Reparto entre 30 o 32 servicios.** Se asumió que es la cuota de distribución; la propuesta en partes iguales usa los servicios activos del catálogo.

31. **Seguimiento del retiro sanitario en los servicios.** El retiro lista los servicios que recibieron el lote, pero no registra uno por uno cuándo devolvieron el producto (de los pacientes sí). Decidir si hace falta.


## Carga de la bodega (2 de octubre de 2026)

32. **Unidades sin lote.** 250,565 unidades (151 insumos) no tienen lote ni vencimiento en el semáforo, que es de septiembre de 2025. Quedaron como lote "SIN-LOTE" en cuarentena: no se entregan hasta registrar su lote real en el primer inventario físico. Si el centro prefiere entregarlas mientras tanto, se liberan desde el detalle del lote.

33. ~~**Promedio (J).**~~ **Resuelto:** promedio de la demanda (D + E) de los últimos 4 meses, incluido el mes que se cierra; mientras el mes en curso no llega a su corte, se usan los 4 meses completos anteriores. Con el historial importado coincide con el Excel (763.75 contra 766 en Acetaminofén gotas; el Excel suma promedios redondeados por servicio).

34. **Forma y presentación de los insumos.** El Excel solo trae el nombre completo; la presentación quedó como "unidad" y hay que completarla por insumo cuando se use la propuesta de distribución por cajas.
