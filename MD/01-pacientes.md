# 01. Pacientes

Sistema clínico del Centro de Salud de Camotán, Chiquimula. Este documento describe cómo debe funcionar el registro, identificación y edición de la ficha del paciente. Está basado en documentos reales del centro y en los formularios oficiales FOR-SIGSA-3CS vigentes, no en supuestos.

**Fuentes revisadas:** Excel de pacientes 2023-2026 del centro; FOR-SIGSA-3CS (hoja real llena); fichas clínicas oficiales del MSPAS para neonato (0-28 días), lactante y niño (29 días a <10 años), adulto y persona mayor (30-59 y 60+); protocolo AIEPI de 2 meses a <5 años.

## 1. El correlativo de papel no es identificador único

El Excel histórico del centro usa un "correlativo" (ej. `R-- 580`, `L-01`) para ubicar la ficha física en el estante. Al revisarlo se encontraron miles de correlativos duplicados entre años y dentro del mismo año (hasta 1,035 duplicados en 2023, uno de ellos repetido 153 veces). La causa confirmada: cuando no encuentran la ficha física, hacen una nueva con el mismo número.

**Regla:** el correlativo de papel se guarda como texto libre, no único, puramente informativo (`correlativoPapel`). El paciente tiene un identificador interno propio, generado por el sistema, que nunca se repite.

**Expediente digital:** correlativo legible por año, formato `AAAA-NNNNN` (ej. `2026-00123`), generado automáticamente dentro de una transacción para que dos registros simultáneos no choquen. No es editable por el usuario.

## 2. Registro en dos momentos

Preconsulta trabaja con tablet, con fila de pacientes esperando. El registro completo de identificación es demasiado largo para ese contexto. Se divide en dos:

### 2.1 Registro rápido (preconsulta, al llegar un paciente nuevo)
Campos mínimos para poder atender:
- Nombres y apellidos
- Sexo
- Fecha de nacimiento, o edad aproximada si no se conoce (ver 2.3)
- Comunidad (selector de catálogo, no texto libre, ver 2.4)
- Responsable, si es menor de 18 años: nombre, parentesco, teléfono
- Teléfono (opcional)

Toma menos de un minuto. No pide ningún otro campo.

### 2.2 Completar ficha (preconsulta, cuando hay oportunidad)
El resto de la identificación completa, descrita en 2.5. Se completa después del registro rápido, sin bloquear la atención del día. Ver sección 4 para el flujo de esta pantalla.

### 2.3 Edad sin fecha de nacimiento conocida *(implementado)*
El SIGSA acepta edad en días (menores de 1 mes), meses (menores de 1 año) o años. El formulario debe ofrecer "No conoce la fecha de nacimiento" y capturar la edad en la unidad que corresponda. El sistema guarda `fechaNacimientoEstimada = true` y calcula una fecha aproximada para seguir la edad en el tiempo. Cualquier cálculo de puntaje Z sobre una fecha estimada se muestra con esa advertencia.

**Cómo quedó:** la advertencia aparece junto a los puntajes Z en la pantalla de consulta, y la edad de la cabecera se marca como aproximada. El puntaje Z depende de la edad, así que quien lo lee tiene que saber de dónde sale esa edad.

### 2.4 Comunidad como catálogo
No texto libre. Selector con búsqueda sobre una tabla `LugarPoblado` (nombre, categoría: aldea/caserío/barrio/otro, territorio, sector). Si la comunidad no existe, solo el administrador la agrega. No sembrar el catálogo con comunidades inventadas: cargar solo las confirmadas, con un mecanismo de importación por CSV para el resto.

### 2.5 Campos de la ficha completa, por grupo de edad
Visibilidad según la edad del paciente a la fecha actual:

| Campo | Grupo de edad |
|---|---|
| CUI (13 dígitos) | Siempre, opcional |
| Expediente en papel (`correlativoPapel`) | Siempre, opcional |
| Departamento y municipio de nacimiento | Siempre |
| Domicilio, municipio de residencia | Siempre |
| Territorio y sector | Se completan solos desde el lugar poblado |
| Pueblo | Siempre |
| Comunidad lingüística | Solo si pueblo = Maya |
| Migrante y origen | Siempre |
| Responsable: nombre, parentesco, teléfono, DPI | Obligatorio si es menor de 18 |
| Escolaridad (versión niñez: estudia actualmente, deserción escolar, último grado aprobado, años repetidos) | 5 a menos de 10 años |
| Escolaridad (versión adolescente: estudia, último grado, motivo si no estudia) | 10 a menos de 30 años |
| Escolaridad (catálogo SIGSA, ver sección 3) | Siempre |
| Trabaja, profesión u oficio o condición | Desde 10 años |
| Estado civil | Desde 30 años (confirmado en ficha de adulto; verificar si aplica antes) |
| Orientación sexual e identidad de género | Solo mayores de 20 años; acceso restringido, ver sección 6 |
| Discapacidad (catálogo, no casilla simple) | Siempre |
| Redes sociales (sí/no) | Adulto y persona mayor |

**Pendiente de confirmar:** si en la práctica real del centro se llenan todos estos campos o solo una parte. La bitácora revisada muestra que en papel no se llena todo (ver `pendientes.md`). No construir un listado de "faltantes" sobre campos que el centro nunca ha llenado en papel; eso se resuelve priorizando por facilidad de llenado, no por exigir el 100%.

## 3. Catálogos oficiales (FOR-SIGSA-3CS, vigente desde nov. 2017)

Códigos exactos, para que la exportación al SIGSA no requiera traducción posterior.

**Pueblo:** 1 Mestizo/ladino, 2 Maya, 3 Garífuna, 4 Xinca, 5 Otros, 6 No indica.

**Comunidad lingüística** (si pueblo = Maya): 1 Achi', 2 Akateka, 3 Awakateka, **4 Ch'orti'** (preseleccionar en Camotán), 5 Chalchiteka, 6 Chuj, 7 Itza', 8 Ixil, 9 Jakalteka, 10 Kaqchikel, 11 K'iche', 12 Mam, 13 Mopan, 14 Poqomam, 15 Poqomchi', 16 Q'anjob'al, 17 Q'eqchi', 18 Sakapulteka, 19 Sipakapensa, 20 Tektiteka, 21 Tz'utujil, 22 Uspanteka, 23 No indica.

**Discapacidad:** 0 No aplica, 1 Física, 2 Mental, 3 Visual, 4 Auditiva, 5 Otro.

**Orientación sexual:** 0 No aplica, 1 Heterosexual, 2 Bisexual, 3 Homosexual, 4 Trans, 5 Otro.

**Escolaridad:** 1 No aplica, 2 Preprimaria, 3 Primaria, 4 Básicos, 5 Diversificado, 6 Universidad, 7 Ninguno, 8 Otro, 9 No indica. Ojo: este catálogo empieza en 1 para "No aplica", distinto a los demás que usan 0.

**Profesión, oficio o condición:** 0 No aplica, 1 Ama de casa, 2 Mujer trabajadora sexual, 3 Hombre trabajador sexual, 4 Persona privada de libertad, 5 Joven en riesgo social, 6 Uniformados, 7 Migrantes, 8 Otros.

**Categoría del establecimiento:** CCS, PS, CS, CAP, CAIMI, Otro.

**Estado civil:** soltero/a, casado/a, viudo/a (confirmado en ficha real; verificar si existe "unido/a" como en el anteproyecto original).

**Parentesco del responsable:** Madre, Padre, Abuelo/a, Hermano/a, Tío/a, Otro familiar, Tutor legal, Otro.

## 4. Flujo de completar ficha

Decisión del centro: las fichas de papel se pasan al sistema poco a poco. Preconsulta pasa **toda la ficha del paciente** (identificación, antecedentes, alimentación y estilos de vida, vacunación y suplementación, familiograma), de los nuevos y de los que van llegando. El médico no llena la ficha: llena la hoja de evolución de cada visita (sección 7).

**Cómo quedó** *(implementado)*: "Completar ficha" muestra todas las secciones de la ficha que corresponde a la edad, con los títulos, el orden y los tipos de campo de `fichas.md`. Cada sección es plegable y se guarda sola; el avance se ve por sección ("Identificación del paciente: 5 de 9", "Médicos: sin registrar", "Familiares: registrado el 2 de octubre por Ana López"). Cada Sí/No tiene tres estados (sin registrar, Sí, No) y nunca se asume No; el botón "Marcar el resto como No" pone en No solo los que siguen sin registrar, y nunca los sensibles. Cada cambio guarda quién, cuándo y el valor anterior, visible desde la propia sección. La ficha de adolescente solo tiene identificación hasta fotografiarla.

- Dentro de la ficha del paciente, un aviso visible mientras falte algo: "Faltan N datos mínimos para el SIGSA", listando cuáles. **Solo cuentan los mínimos del SIGSA** (departamento y municipio de residencia, pueblo, comunidad lingüística si es Maya, escolaridad y discapacidad); el resto se muestra como "sin registrar" sin generar alarma.
- Junto al aviso, un botón secundario **"Completar ahora"** (no compite visualmente con la acción principal de la pantalla, que es registrar la preconsulta).
- Lleva a un formulario que prioriza primero los campos de selección rápida (pueblo, migrante, discapacidad: una sola opción cada uno) y deja al final los que requieren preguntar y escribir texto (domicilio, escolaridad detallada).
- Permite guardar parcialmente. Si solo se completan 2 de 9 campos, se guardan esos 2 y el aviso se actualiza a "faltan 7".
- Nunca bloquea ni interrumpe el registro de preconsulta o la atención médica.
- Lo completa preconsulta, no un rol de digitalización (ese rol existe para la carga al SIGSA, fuera de este flujo; ver `pendientes.md`).

## 5. Embarazo como episodio, no como dato fijo del paciente

No es una casilla permanente del registro. Tabla `EpisodioEmbarazo`: paciente, fecha de última regla, semanas de gestación al abrirlo, fecha probable de parto (calculada), estado (activo/finalizado), fecha y motivo de cierre.

- Se abre desde preconsulta cuando se sospecha o confirma embarazo.
- Mientras está activo: da prioridad en la cola y habilita la ficha/sección prenatal.
- Se cierra al registrar el parto, la pérdida, o automáticamente a las 42 semanas.

"Menor de 5 años" y "adulto mayor" se calculan solos desde la fecha de nacimiento, no se marcan a mano.

## 6. Datos sensibles

Orientación sexual, identidad de género, antecedentes de violencia, maltrato infantil (bloque separado de violencia general, con su propia fecha, hora y número de caso), ideas suicidas, problemas judiciales:

Incluye también la historia de abuso y/o violencia, el maltrato o abuso descrito, los antecedentes familiares o maternos de violencia y problemas judiciales, y el lugar y número de notificación de la consulta.

- **Preconsulta puede registrarlos al pasar la ficha de papel**, porque ya maneja ese papel físicamente.
- **Una vez guardados, solo el médico y el administrador ven el valor.** Preconsulta ve "Registrado" sin el contenido y no puede modificarlos ni borrarlos; en el historial ve que el dato cambió, no a qué.
- "Marcar el resto como No" nunca los toca: se responden uno por uno.
- Cada lectura y escritura queda en bitácora (usuario, fecha, paciente y campo), incluida la ficha impresa.
- No aparecen en listados, búsquedas ni exportaciones generales.

*(implementado)*

## 7. Reglas de edición por sección

La ficha no es un documento monolítico: cada sección pertenece a un rol y a un momento.

| Sección | Quién la llena | Cuándo |
|---|---|---|
| Identificación básica | Preconsulta | Al crear el paciente |
| Identificación completa y datos para el SIGSA | Preconsulta | Completar ficha, sin apuro (sección 4) |
| Antecedentes (perinatales, maternos, personales, médicos, familiares, psicosociales, hábitos, historia de abuso y/o violencia) | Preconsulta | Completar ficha; una vez, editable después con historial |
| Alimentación y estilos de vida, vacunación y suplementación (estado actual) | Preconsulta | Completar ficha; se actualiza cuando cambia |
| Familiograma (neonato) | Preconsulta | Completar ficha, foto o PDF adjunto |
| Datos sensibles (sección 6) | Preconsulta los registra; médico o administrador los ve y corrige | Al pasar la ficha de papel |
| Motivo de consulta, signos de peligro, signos vitales y antropometría | Preconsulta | Atención del día |
| Hoja de evolución: MC (precargado), HE, EF, IC con CIE-10 (hasta 10 filas), Tx con receta, próxima cita | Médico | Durante la consulta |
| Datos del SIGSA 3CS: tipo de consulta (sugerido), control, semana de gestación (calculada), referencia viene/fue, lugar de notificación, acompañante | Médico | Durante la consulta |
| Examen físico por sitio, otros problemas, laboratorios, orientación integral | Médico, opcional | "Más de la ficha (opcional)" |

El médico ve el resumen de antecedentes en la consulta y puede abrir la ficha para corregirlos, pero llenarlos no es parte de su flujo.

La ficha impresa de una atención junta las tres partes (ficha del paciente, atención del día y hoja del médico) en el orden del papel de su edad; lo no registrado sale vacío, como en el papel. *(implementado)*

### 7.1 Inmutabilidad de la consulta cerrada *(implementado)*
Al cerrar una consulta, sus datos quedan fijos. No se edita en silencio después. Una corrección posterior se registra como nota aparte: qué se corrigió, quién y cuándo, sin borrar el dato original. Mismo principio que la trazabilidad de inventario: nunca sobrescribir.

**Cómo quedó:** tabla `NotaCorreccion` ligada a la atención, con el campo, el valor anterior, el nuevo, el motivo, el autor y la fecha. Se corrigen el diagnóstico, el código CIE-10, el tratamiento y la próxima cita; el resto no se corrige, se anula la atención.

Dos detalles que resolvió la implementación:

- **Poner un código CIE-10 que faltaba es completar, no corregir.** Solo deja nota cuando reemplaza uno que ya estaba, y en ese caso exige motivo. Antes el endpoint de codificación sobrescribía en silencio.
- **Una consulta cerrada ya no muestra el formulario de cierre.** Se abre en modo lectura, con sus datos y la lista de correcciones. Antes se podía llegar por enlace directo y ver el formulario como si estuviera abierta.

### 7.2 Bloqueo durante la consulta en curso *(implementado)*
Cuando una atención pasa de "en espera" a "en consulta", los datos de preconsulta de esa visita quedan congelados para cualquiera que no sea el médico que la atiende, para evitar que ambos editen el mismo dato a la vez. El médico puede corregir si ve algo raro, siempre bajo la regla de 7.1.

**Cómo quedó:** mientras está en espera, preconsulta corrige lo suyo sin nota, porque nadie ha leído ese dato todavía. En cuanto el médico la llama, preconsulta recibe `datos_congelados` y solo el médico puede corregir, explicando por qué. Ver `02-preconsulta.md` sección 4.

## Pendiente de confirmar en el centro

Ver `pendientes.md`. En particular: si existe una "ficha general" única que se usa en lugar de las seis específicas por edad, y si el personal saca la ficha física del estante en cada visita del paciente o solo la primera vez (esto último decide si el flujo de completar ficha tiene un momento natural asociado).
