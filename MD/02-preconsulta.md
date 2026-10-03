# 02. Preconsulta

Sistema clínico del Centro de Salud de Camotán. Preconsulta trabaja con una sola tablet, con fila de pacientes esperando, hoy usando un Excel lento para buscar y una tablet lenta para digitar. El diseño de esta pantalla responde directamente a esa condición: debe ser la más simple y rápida de todo el sistema, no una versión reducida de las pantallas de escritorio.

## 1. Principio de diseño

Atender a un paciente en preconsulta debe tomar menos de medio minuto de toques. Botones grandes, texto mínimo, sin pasos de más. Esta pantalla nunca debe cargarse con tareas que no sean estrictamente necesarias en el momento (ver `01-pacientes.md` sección 4 sobre por qué completar la ficha de identificación va aparte, no aquí).

## 2. Pantalla de inicio: buscar o seleccionar paciente

- Buscador grande arriba (altura aprox. 56px, ícono de lupa, texto grande), para el caso excepcional de alguien que no está en la fila.
- Debajo, "Fila de hoy": los pacientes ya citados o en curso, como tarjetas grandes y táctiles (altura aprox. 72px), no una tabla. Cada tarjeta: inicial en círculo, nombre, comunidad, edad. Tocar la tarjeta abre directo la toma de signos vitales de ese paciente, sin pasos intermedios.
- Botón grande al fondo, ancho completo: **"Paciente nuevo"**, lleva al registro rápido (`01-pacientes.md` sección 2.1).
- La búsqueda por texto solo se usa si el paciente no aparece en la fila de hoy.

## 3. Toma de signos vitales

Una sola pantalla, sin scroll si es posible. Campos grandes, teclado numérico.

### 3.1 Peso: libras o kilogramos, con conversión *(implementado)*
No se sabe de antemano en qué unidad pesa cada báscula del centro (hay evidencia de que usan ambas: el formulario oficial de niñez trae casillas de "Peso (Kg)" y "Peso (Lb)" por separado).

- Un botón de unidad junto al campo de peso, que alterna entre lb y kg.
- Al alternar, **convierte el número ya escrito**, no limpia el campo. Si el usuario escribió 63 en libras y toca el botón, debe ver 28.58 en kilogramos, no un campo vacío.
- El sistema recuerda la última unidad usada en ese dispositivo y la propone de entrada en el siguiente paciente (no vuelve a kg por defecto cada vez).
- Internamente, el valor siempre se guarda y se calcula en kilogramos, sin importar en qué unidad se capturó.

**Cómo quedó:** la conversión que cuenta la hace el servidor, no la pantalla. El formulario manda el número tal como se escribió junto con su unidad (`peso` y `unidadPeso`), y el backend convierte con el factor exacto de la libra avoirdupois antes de guardar. Así el valor del expediente no depende de que el navegador haya calculado bien, y un peso que en kilogramos queda fuera de lo posible se rechaza con el número ya convertido en el mensaje. La unidad de captura se guarda junto al peso, de modo que quien pesó en libras ve la equivalencia y puede verificarla.

### 3.2 Otros campos
Talla (cm, sin selector de unidad salvo que se confirme lo contrario), temperatura, presión arterial, frecuencia cardíaca, frecuencia respiratoria, saturación de oxígeno, perímetro braquial (menores de 5), perímetro cefálico (menores de 2, y en neonato especialmente).

### 3.3 Signos de peligro
Como botones grandes que se iluminan al tocarlos, no casillas pequeñas. La lista depende de la edad del paciente (confirmado con fichas reales):

**Neonato (0-28 días):** convulsiones, letárgico, vomita todo, fiebre mayor de 37.5°C, hipotermia menor a 36°C, dificultad respiratoria, no defeca en últimas 48 hrs., bajo peso y signos de peligro, ictericia, cianosis, anomalías congénitas, conjuntivitis, onfalitis, distensión abdominal, pústulas en la piel.

**Niñez (29 días a <10 años):** no puede beber, tomar pecho o ingerir alimentos; vomita todo; dificultad respiratoria; letárgico o inconsciente; convulsiones.

**Adulto y persona mayor (30+):** dificultad respiratoria, confusión mental, dolor u opresión precordial, dolor abdominal, cefalea o dolor de cabeza intenso, vómitos, deshidratación, inconsciencia, hipotermia.

**Adolescente (10 a <30):** pendiente de confirmar la lista exacta de su ficha.

- Al marcar cualquier signo, el sistema sugiere gravedad **urgente** automáticamente.
- Si el personal cambia la gravedad a algo menor con un signo marcado, debe justificar por qué no es urgente (campo de texto obligatorio en ese caso).
- Regla de las fichas oficiales: ante un signo de peligro, además de la gravedad urgente, el sistema ofrece abrir la boleta de referencia. *(Implementado: al guardar aparece el acceso a la boleta, con el recordatorio de estabilizar y registrar. Ofrece, no obliga.)*

### 3.4 Motivo de consulta *(implementado)*
Campo de texto corto y obligatorio, el primero de la pantalla.

**Cómo quedó:** antes había que escribirlo para poder abrir la atención, lo que obligaba a entrar al expediente primero. Ahora la atención se abre sin motivo y este se pregunta aquí, que es el mismo momento en la práctica. Sigue siendo obligatorio: sin él no se guarda la preconsulta.

### 3.5 Envío a cola
Un solo botón al fondo, ancho completo: **"Enviar a cola"**. Al tocarlo, el sistema calcula el puntaje de prioridad (gravedad, condición del paciente, tiempo de espera y tiempo de viaje desde su comunidad) y el paciente pasa a estado "en espera".

**Peso por distancia (octubre 2026):** el personal registra en Administración → Lugares poblados el tiempo de viaje de cada comunidad al centro. En la cola suma: menos de 30 min +0, de 30 a 59 min +5, de 1 a 2 h +10, más de 2 h +15. Sin dato no suma. Nunca supera a la gravedad: un caso urgente pasa antes que cualquier otro. Se explica en la cola como "Viene de lejos: 1 a 2 h de viaje".

## 4. Reglas de bloqueo *(implementado)*

Una vez que una atención pasa de "en espera" a "en consulta" (el médico la llamó), los datos que preconsulta capturó para esa visita quedan congelados para preconsulta. Si preconsulta necesita corregir algo después de ese punto, debe pasar por el médico. Ver `01-pacientes.md` sección 7.2.

**Cómo quedó:** mientras la atención está en espera, preconsulta corrige lo suyo sin más —nadie ha leído todavía ese dato para decidir nada— y no se registra nota. En cuanto el médico la llama, un intento de preconsulta devuelve `datos_congelados`, y el médico sí puede corregir pero debe explicar por qué: la corrección queda con el valor anterior, el autor y la fecha, visible en la propia pantalla de consulta.

Los signos de peligro no se corrigen por esta vía: cambiarlos cambia la gravedad y el puesto en la cola, y eso ya no es un error de digitación.

## 5. Lo que esta pantalla NO hace

- No completa identificación del paciente (eso es un botón aparte dentro de la ficha, fuera del flujo de atención, ver `01-pacientes.md` sección 4).
- No permite diagnóstico ni tratamiento.
- No requiere que preconsulta escriba nada que no sea indispensable para que el médico atienda.

## Pendiente de confirmar en el centro

- Lista exacta de signos de peligro para adolescente. No se pudo extraer del PDF oficial; el sistema usa la lista de adulto para ese grupo y lo marca como provisional.
- Si las básculas del centro son de libras, de kilogramos, o mixtas. Ya no bloquea nada: el selector está implementado y soporta ambas. Si se confirma una sola, basta con fijar el valor inicial.
- Si la vitamina A, hierro y desparasitación (del calendario de acciones preventivas) se entregan en cualquier consulta general o solo en una clínica de vacunación aparte; si se entregan en consulta general, este módulo necesita capturarlas.
