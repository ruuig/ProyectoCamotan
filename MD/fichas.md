Fichas clínicas por etapa de vida

Listado completo de los campos de cada ficha clínica oficial del MSPAS que usa el Centro de Salud de Camotán, en el mismo orden, con los mismos nombres de sección y subsección que el papel. Transcrito de las fichas físicas fotografiadas en el centro.

Cómo usar este documento
El formulario en pantalla debe seguir exactamente esta estructura: mismos títulos de sección, mismas subdivisiones, mismo orden. No inventar agrupaciones propias (por ejemplo "Origen y residencia" o "Identidad y pertenencia" no existen en ninguna ficha; deben reemplazarse por los nombres reales).
El encabezado del formulario siempre muestra qué ficha se está llenando, con su nombre y rango oficial, por ejemplo: Ficha clínica para persona adulta y persona mayor, adulta/o (30 a 59 años) y persona mayor (60 años y más). El sistema elige la ficha por la edad del paciente a la fecha de la atención.
Cada sección indica cuándo se llena:
[Paciente]: se registra una vez y se actualiza cuando cambia. Vive en el expediente, no se vuelve a pedir en cada visita.
[Atención]: se llena en cada visita.
[Paciente, se actualiza]: es del paciente (la pasa preconsulta en "Completar ficha"), pero describe su estado actual y se actualiza cuando cambia; cada cambio queda en el historial de la sección.
Las secciones marcadas [Común] son idénticas en todas las fichas y se construyen como un solo componente reutilizable (ver sección 0).
Tipos de campo
Tipo	Control en pantalla
Texto	Campo de una línea
Texto largo	Área de texto de varias líneas
Número (unidad)	Teclado numérico, con la unidad visible
Fecha	Selector de fecha (día, mes, año)
Hora	Selector de hora (hora, minutos)
Sí/No	Dos botones excluyentes
Selección única	Botones o lista de opciones, solo una
Casillas	Selección múltiple, se marcan las que apliquen
Catálogo	Lista desplegable con búsqueda, valores de una tabla
Calculado	No se escribe; el sistema lo calcula
Archivo	Adjuntar imagen o PDF
Firma	Firma o huella; en el sistema, confirmación del usuario o imagen

Cuando un campo es "Sí/No + especifique", el texto solo se habilita si se marca Sí.

0. Componentes comunes
0.1 Encabezado [Atención]
Campo	Tipo	Notas
Fecha	Fecha	Automática: fecha de la atención
Hora	Hora	Automática: hora de la atención
Número de expediente	Calculado	Expediente digital del paciente
0.2 Datos del establecimiento [Común]

No se capturan en cada ficha: salen de la configuración del establecimiento y se muestran en la ficha impresa.

Campo	Tipo
Nombre del establecimiento	Configuración
Área de salud (o Dirección de Área de Salud)	Configuración
Distrito de salud (o Distrito municipal de salud)	Configuración
Categoría del establecimiento	Configuración: CCS, PS, CS, CAP, CAIMI, Otro
0.3 Examen físico [Atención] [Común]

Cada sitio anatómico es Sí/No en la columna "Normal". Si se marca No, el hallazgo se describe en el campo de hallazgos anormales.

Sitio anatómico	Neonato	Niñez	Adulto
Piel, faneras y mucosas	✓	✓	✓
Cabeza	✓	✓	✓
Ojos	✓	✓	✓
Oídos	✓	✓	✓
Salud bucodental (salud bucal)	✓	✓	✓
Cuello y tiroides	✓	✓	✓
Tórax	✓	✓	✓
Cardiopulmonar	✓	✓	✓
Abdomen	✓	✓	✓
Genitourinario	✓	✓	✓
Columna	✓	✓	✓
Cadera	✓	✓	✓
Extremidades	✓	✓	✓
Neurológicos	✓	✓	✓
Huesos y articulaciones	✓		
Pies			✓
Campo	Tipo
Otros hallazgos, especifique	Texto largo
Describa hallazgos anormales	Texto largo
0.4 En caso de violencia [Atención] [Común] [Sensible]
Campo	Tipo
Fecha de notificación	Fecha
Hora de notificación	Hora
Número de caso	Texto
0.5 Impresión clínica (diagnóstico), codificación y tratamiento [Atención] [Común]

Filas repetibles. El papel tiene espacio para hasta 10 diagnósticos (5 filas en 2 columnas).

Campo	Tipo
Impresión clínica (diagnóstico)	Texto, con buscador de CIE-10
CIE-10	Catálogo CIE-10
Tratamiento (en niñez se llama "Conducta/tratamiento")	Texto, ligado a la prescripción
0.6 Cierre [Atención] [Común]
Campo	Tipo
Otros problemas identificados	Texto largo
Laboratorios a realizar según normas, resultados y otros estudios complementarios (describir)	Texto largo
Orientación integral	Texto largo
Nombre completo, firma y sello del proveedor	Calculado: usuario que cierra la atención

El resto del cierre varía por ficha y se indica en cada una.

0.7 Códigos según comunidad lingüística

Todas las fichas traen al pie la tabla de códigos 1 a 22. En el sistema es el catálogo de comunidad lingüística (ver 01-pacientes.md sección 3), no un campo a llenar.

1. Ficha clínica para neonato (de 0 a 28 días)
1.1 Encabezado y datos del establecimiento

Ver 0.1 y 0.2.

1.2 Identificación [Paciente]
Campo	Tipo	Notas
Nombres	Texto	
Apellidos	Texto	
No inscrito aún en RENAP	Sí/No	Si Sí, el neonato no tiene CUI propio
Domicilio	Texto	
Departamento de nacimiento	Catálogo	
Municipio de nacimiento	Catálogo	
Departamento	Catálogo	De residencia
Municipio	Catálogo	De residencia
Territorio	Calculado	Desde la comunidad
Sector	Calculado	Desde la comunidad
Comunidad	Catálogo	Lugar poblado
Fecha de nacimiento	Fecha	
Edad (en días)	Calculado	Solo en días
Sexo	Selección única	F, M
Pueblo	Selección única	Maya, Garífuna, Xinca, Mestizo, Otro
Comunidad lingüística	Catálogo	Solo si pueblo es Maya
Migrante	Sí/No + origen (texto)	
Nombre de la madre/responsable	Texto	
Edad de la madre	Número (años)	
Número de celular	Texto	
CUI	Texto (13 dígitos)	De la madre o responsable si el neonato no está inscrito; confirmar en el centro
1.3 Motivo de consulta [Atención]
Campo	Tipo
Motivo de consulta	Texto largo
1.4 Signos o síntomas de peligro [Atención]
Campo	Tipo
Signos de peligro	Casillas: convulsiones, letárgico, vomita todo, fiebre mayor de 37.5 °C, hipotermia menor a 36 °C, dificultad respiratoria, no defeca en últimas 48 hrs., bajo peso y signos de peligro, ictericia, cianosis, anomalías congénitas, conjuntivitis, onfalitis, distensión abdominal, pústulas en la piel
Otros, especificar	Texto

En caso de signos o síntomas de peligro/condición grave: tomar signos vitales, estabilizar, registrar y llenar boleta de referencia.

Campo	Tipo
Acciones inmediatas realizadas	Texto largo
Referido	Sí/No
Especifique	Texto

Nota del papel: si no presenta signos o síntomas de peligro, continúe llenando la ficha clínica.

1.5 Historial de la enfermedad actual [Atención]
Campo	Tipo
Historial de la enfermedad actual	Texto largo
1.6 Antecedentes
Perinatales [Paciente]
Campo	Tipo	Notas
Peso al nacer	Número (lb) + Número (onz)	
Clasificación del peso al nacer	Calculado	Menor de 2,500 g (5 lb 4 onz); de 2,500 a 4,000 g (5 lb 4 onz a 8 lb); mayor de 4,000 g (8 lb)
Longitud	Número (cm)	
P. cefálico	Número (cm)	
Clasificación del perímetro cefálico	Selección única	Normal (de 2 a menor de 2 DE), microcefalia (menor de 2 DE), macrocefalia (mayor de 3 DE)
Parto	Selección única	Vaginal, cesárea
Uso de fórceps	Sí/No	
Complicaciones durante el parto	Sí/No + especificar	
Atendido por	Selección única + texto	Médico/a, enfermero/a, aux. enf., comadrona, otro (especificar)
Edad gestacional	Selección única	Nació a término (37 a 40 semanas), nació pretérmino (menos de 37 semanas), nació postérmino (más de 41 semanas)
Lloró rápido y fuerte al nacer	Sí/No	
Apego inmediato	Sí/No	
Labio hendido	Sí/No	
Paladar hendido	Sí/No	
Anomalías del tubo neural	Sí/No	
Luxación congénita de cadera	Sí/No	
Quirúrgicos	Sí/No	
Otros	Texto	
Alimentación [Paciente, se actualiza]
Campo	Tipo
Leche materna (primeros 30 minutos de vida)	Sí/No
Lactancia materna exclusiva	Sí/No
Otro, especifique	Sí/No + texto
Psicosociales [Paciente]
Campo	Tipo	Opciones
Apoyo social	Sí/No	
Cobertura IGSS	Sí/No	
Vive con	Selección única + texto	Ambos padres, uno de los padres, familiar, otro (especifique)
Maternos [Paciente]
Campo	Tipo
Problemas de desnutrición	Sí/No
Diabetes	Sí/No
Hipertensión	Sí/No
Cáncer	Sí/No
Enfermedades transmisibles	Sí/No
Hipertensión durante el embarazo	Sí/No
Problemas psicológicos	Sí/No
Problemas judiciales	Sí/No
TB	Sí/No
TORCH	Sí/No
Chagas	Sí/No
Sífilis	Sí/No
Hepatitis B o C	Sí/No
Zika	Sí/No
ITS	Sí/No
Consumo de sustancias psicoactivas	Sí/No
Madre adolescente	Sí/No
Madre fallecida	Sí/No
Grupo y Rh de la madre	Texto
Otras, especificar	Texto
Vacunación [Paciente, se actualiza]
Campo	Tipo	Momento recomendado
Hepatitis B	Sí/No	RN, primeras 24 horas de vida
BCG	Sí/No	RN, hasta antes de cumplir 1 año
Familiograma [Paciente]
Campo	Tipo	Notas
Familiograma	Archivo	El papel indica elaborarlo en hoja aparte y adjuntarlo; en el sistema se adjunta foto o PDF
1.7 Examen físico [Atención]

Ver 0.3 (incluye huesos y articulaciones).

Pendiente: en las hojas de neonato fotografiadas no apareció una sección de signos vitales ni de antropometría. Confirmar en el centro si existe una página intermedia.

1.8 En caso de violencia

Ver 0.4.

1.9 Impresión clínica (diagnóstico), codificación y tratamiento

Ver 0.5.

1.10 Cierre

Ver 0.6, más:

Campo	Tipo
Firma o huella de la madre, padre o responsable	Firma
Fecha próxima cita	Fecha
Huella plantar del neonato	Firma (imagen)
2. Ficha clínica para lactante, niña y niño (de 29 días a menos de 10 años)
2.1 Encabezado y datos del establecimiento

Ver 0.1 y 0.2.

2.2 Identificación de la niña o niño [Paciente]
Campo	Tipo	Notas
Nombres	Texto	
Apellidos	Texto	
Departamento de nacimiento	Catálogo	
Municipio de nacimiento	Catálogo	
Domicilio	Texto	
Departamento	Catálogo	De residencia
Municipio	Catálogo	De residencia
Territorio	Calculado	
Sector	Calculado	
Comunidad	Catálogo	
Fecha de nacimiento	Fecha	
Edad	Calculado	Años, meses y días
Número CUI de la niña o niño	Texto (13 dígitos)	
Sexo	Selección única	F, M

Escolaridad

Campo	Tipo
Estudia actualmente	Sí/No
Deserción escolar	Sí/No
Último grado aprobado	Texto
Años repetidos, ¿cuántos?	Número
Campo	Tipo	Opciones
Pueblo	Selección única	Maya, Garífuna, Xinca, Mestizo, Otro
Comunidad lingüística	Catálogo	Solo si pueblo es Maya
Migrante	Sí/No + origen (texto)	
Nombre del/la responsable	Texto	
No. de teléfono	Texto	
Parentesco	Selección única	
DPI	Texto (13 dígitos)	Del responsable
2.3 Signos o síntomas de peligro [Atención]
Campo	Tipo
Signos de peligro	Casillas: no puede beber, tomar pecho o ingerir alimentos; vomita todo; tiene dificultad respiratoria; está letárgico o inconsciente; presenta convulsiones
Otro, especifique	Texto

En caso de signos o síntomas de peligro/condición grave: tomar signos vitales, estabilizar, registrar y llenar boleta de referencia.

2.4 Motivo de consulta [Atención]
Campo	Tipo
Motivo de consulta	Texto largo
Referido	Sí/No
Especifique	Texto
2.5 Historia de la enfermedad actual [Atención]
Campo	Tipo
Historia de la enfermedad actual	Texto largo
2.6 Antecedentes
Perinatales [Paciente]
Campo	Tipo	Opciones
Peso al nacer	Número (lb) + Número (onz)	
Complicaciones durante el parto	Sí/No + especificar	
Longitud	Número (cm)	
Parto	Selección única	Vaginal, cesárea
Uso de fórceps	Sí/No	
Lugar del parto	Selección única + texto	Institucional, comunitario, otro (especificar)
Atendido por	Selección única + texto	Médico/a, enfermero/a, aux. enf., comadrona, otro (especificar)
Médicos [Paciente]
Campo	Tipo
Antecedentes médicos	Casillas: problemas de crecimiento, problemas nutricionales, problemas de desarrollo, enfermedades transmisibles, enfermedades crónicas, enfermedades vectoriales, alergias, traumas, cirugías, discapacidad, intoxicaciones, uso de medicamentos, asma, hospitalización, accidentes, maltrato infantil [Sensible]
Otros, especificar	Texto
Familiares [Paciente]
Campo	Tipo
Antecedentes familiares	Casillas: diabetes, hipertensión, cáncer, enfermedades transmisibles, problemas psicológicos, problemas judiciales, consumo de sustancias psicoactivas, violencia
Otras, especificar	Texto
Psicosociales [Paciente]
Campo	Tipo	Opciones
Apoyo social	Sí/No	
Cobertura IGSS	Sí/No	
Problemas más frecuentes	Texto	
Vive con	Selección única + texto	Ambos padres, uno de los padres, familiar, otro (especifique)
Problemas en la escuela	Sí/No + especificar	
Trabajo infantil	Sí/No + especificar	
¿Es peligroso?	Sí/No	Solo si hay trabajo infantil
Estado de ánimo	Casillas	Triste, alegre, ansioso, violento/a, ideas suicidas [Sensible]
Estilos de vida: alimentación según edad [Paciente, se actualiza]
Campo	Tipo	Notas
LM exclusiva (menores de 6 meses)	Sí/No	Mostrar solo si aplica a la edad
Alimentación mixta (menores de 6 meses)	Sí/No	Idem
LM de 6 meses a 2 años o más	Sí/No	Idem
Alimentación complementaria en mayores de 6 meses	Sí/No	Idem
Alimentación adecuada a su edad	Sí/No	
Comidas por día	Número	
Consumo de	Casillas	Cereales, verduras, frutas, carnes, lácteos, azúcares, grasas, agua pura
Actividad física	Sí/No + horas al día (número)	
Videojuegos	Sí/No	
TV	Sí/No	
Otras actividades	Texto	
Horas de sueño al día	Número	
Higiene	Sí/No	
2.7 Signos vitales [Atención]
Campo	Tipo
Temperatura	Número (°C)
Frecuencia cardíaca	Número (por min)
P/A	Texto (mmHg, formato 120/80)
Frecuencia respiratoria	Número (por min)
Aspecto general normal	Sí/No + describir
2.8 Antropometría: monitoreo del crecimiento en menores de 5 años [Atención]
Campo	Tipo	Notas
Peso	Número (kg o lb)	Un solo campo con selector lb/kg, ver 02-preconsulta.md 3.1
Longitud/talla	Número (cm)	
Perímetro cefálico	Número (cm)	
Peso/talla	Calculado	Normal, desnutrición moderada, desnutrición severa, sobrepeso, obesidad
Talla/edad	Calculado	Normal, retardo moderado, retardo severo
Peso/edad	Calculado	Normal, peso bajo moderado, peso bajo severo

Mayores de 5 años

Campo	Tipo	Notas
IMC según normas	Calculado	
Clasificación IMC	Calculado	Normal, desnutrición moderada, desnutrición severa, sobrepeso, obesidad

Las clasificaciones son calculadas desde las tablas OMS, pero el médico puede corregirlas; si las corrige, queda registrado.

2.9 Examen físico [Atención]

Ver 0.3.

2.10 En caso de violencia

Ver 0.4.

2.11 Maltrato infantil [Atención] [Sensible]
Campo	Tipo
Fecha de notificación	Fecha
Número de caso	Texto
2.12 Impresión clínica (diagnóstico), codificación y tratamiento

Ver 0.5 (la columna se llama "Conducta/tratamiento").

2.13 Cierre

Ver 0.6, más:

Campo	Tipo
Fecha próxima cita	Fecha

Nota del papel en orientación integral: incluir las recomendaciones u orientación que indica la norma.

2.14 Acciones preventivas [Calculado desde las atenciones]

Es una tabla de seguimiento acumulada por edad, no un formulario por visita. En el sistema se genera a partir de las atenciones registradas; no se llena a mano.

Por cada control, según el rango de edad:

Dato	Origen
Rango de edad y edad recomendada	Calculado desde la fecha de nacimiento
Esquema recomendado, vacunas y dosis	Tabla de referencia del MSPAS (ver abajo)
Cantidad de controles (1er control, 2do control…)	Calculado
Peso/talla, talla/edad, peso/edad	De la antropometría de cada atención (2.8)
Vitaminas y micronutrientes espolvoreados (VME), 1a y 2a entrega	Fecha y número de dosis; cada 6 meses
Vitamina A 100,000 UI	Fecha
Desparasitación, 1a y 2a dosis	Fecha; cada 6 meses

Esquema recomendado de vacunas por edad (tabla de referencia, no editable):

Edad	Vacunas
0 meses	Hep B (primeras 24 horas, antes de 1 mes); BCG (RN, antes de 1 año)
2 meses	Polio 1, Penta 1, Rotavirus 1, Neumo 1
4 meses	Polio 2, Penta 2, Rotavirus 2, Neumo 2
6 meses	Polio 3, Penta 3
7 a 11 meses	Influenza 1a y 2a, en jornada
12 meses	SPR 1, Neumo R1
12 a 23 meses	Influenza 1a y, un mes después, 2a según antecedente vacunal, en jornada
18 meses	SPR 2, Polio R1, DPT R1
2 a menos de 3 años	Influenza 1a y, un mes después, 2a según antecedente vacunal, en jornada
4 años	Polio R2, DPT R2

Controles esperados: 12 en el primer año, 12 de 1 a menos de 2 años, 3 de 2 a menos de 3, 2 de 3 a menos de 4, 2 de 4 a menos de 5.

Esquema atrasado (5 a menos de 10 años): solo se administran dosis no recibidas en la edad recomendada. Para este grupo se usa IMC en lugar de los tres indicadores de crecimiento, y se agrega:

Dato	Origen
Hierro, 1a a 4a dosis	Fecha; cada 3 meses
Desparasitación, 1a y 2a dosis	Fecha; cada 6 meses
Clasificación IMC	De la antropometría

Regla del papel: si no cumple con alguna de las acciones preventivas, referir a la clínica de vacunación o a la clínica de control de peso y talla para iniciar, continuar o completar. En el sistema esto es una alerta, no un campo.

Pendiente: confirmar si en Camotán vitamina A, hierro y desparasitación se entregan en consulta general (entonces se registran en la atención) o solo en la clínica de vacunación.

3. Ficha clínica para adolescente y joven (de 10 a menos de 30 años)

Pendiente de fotografiar en el centro. No implementar el detalle hasta confirmar.

Por la versión pública revisada, se sabe que además del núcleo común incluye: religión; referente adulto (en lugar de responsable); estudia, último grado aprobado y motivo por el que no estudia; trabaja; antecedentes ginecoobstétricos (menarquia o espermarquia, embarazos, hijos, abortos, FUR, uso de anticonceptivos); vida sexual; factores de riesgo por ámbito (individual, familia, pares, escuela, comunidad); estadio de Tanner; trastornos alimentarios; vacuna VPH. Orientación sexual e identidad de género solo se preguntan a mayores de 20 años.

Falta: lista exacta de signos de peligro, nombres exactos de secciones y orden.

4. Ficha clínica para persona adulta y persona mayor (adulta/o de 30 a 59 años y persona mayor de 60 años y más)
4.1 Encabezado y datos del establecimiento

Ver 0.1 y 0.2.

4.2 Identificación del paciente [Paciente]
Campo	Tipo	Opciones o notas
Nombres	Texto	
Apellidos	Texto	
Departamento de nacimiento	Catálogo	No hay municipio de nacimiento en esta ficha
Domicilio	Texto	
Departamento	Catálogo	De residencia
Municipio	Catálogo	De residencia
Territorio	Calculado	
Sector	Calculado	
Comunidad	Catálogo	
Fecha de nacimiento	Fecha	
Edad	Calculado	En años
Número CUI/DPI	Texto (13 dígitos)	
Sexo	Selección única	F, M
Orientación sexual	Selección única [Sensible]	Heterosexual, bisexual, homosexual, trans
Identidad de género	Texto [Sensible]	
Escolaridad	Selección única	Analfabeta, primaria, básicos, diversificado, universitaria
Trabaja	Sí/No + especifique	
Profesión u oficio o condición	Texto	
Pueblo	Selección única	Maya, Garífuna, Xinca, Mestizo, Otro
Comunidad lingüística	Catálogo	Solo si pueblo es Maya
Estado civil	Selección única	Soltero/a, casado/a, viudo/a
Migrante	Sí/No + origen (texto)	
Nombre del/la responsable	Texto	
Parentesco	Selección única	
No. de teléfono	Texto	
No. de celular	Texto	
Redes sociales	Sí/No	
Correo electrónico	Texto	
4.3 Evalúe signos y síntomas de peligro [Atención]
Campo	Tipo
Dificultad respiratoria	Sí/No
Confusión mental	Sí/No
Dolor u opresión precordial	Sí/No
Dolor abdominal	Sí/No
Cefalea o dolor de cabeza intenso	Sí/No
Vómitos	Sí/No
Deshidratación	Sí/No
Inconciencia	Sí/No
Hipotermia	Sí/No
Otra condición, especifique	Texto

En caso de signos o síntomas de peligro/condición grave: tomar signos vitales, estabilizar, registrar y llenar boleta de referencia.

4.4 Motivo de consulta [Atención]
Campo	Tipo
Motivo de consulta	Texto largo
Referido	Sí/No
Especifique	Texto
4.5 Historia de la enfermedad actual [Atención]
Campo	Tipo
Historia de la enfermedad actual	Texto largo
4.6 Antecedentes
Personales [Paciente]
Campo	Tipo	Notas
Menarquia/espermarquia	Número (años de edad)	
Número de embarazos	Número	Solo mujeres
Número de hijos	Número	
Hijos vivos	Número	
Número de abortos	Número	Solo mujeres
FUR	Fecha	Solo mujeres; se actualiza en cada atención
Vida sexual activa	Sí/No + edad de inicio (número)	
Varias parejas	Sí/No	
Uso de métodos anticonceptivos	Sí/No + especifique	
Ciclos menstruales irregulares	Sí/No	Solo mujeres
Dismenorrea	Sí/No	Solo mujeres

Regla del papel: si sospecha o confirma embarazo, llenar también ficha prenatal. En el sistema: ofrecer abrir el episodio de embarazo (01-pacientes.md sección 5).

Médicos [Paciente]
Campo	Tipo
Antecedentes médicos	Casillas: TB, alergias, asma, ITS, ITU, dislipidemias, osteoartritis, cáncer de cérvix, cáncer de próstata, infarto del miocardio, problemas nutricionales, diabetes, ECV, hipertensión, uso de medicamentos, discapacidad, intoxicaciones, traumas, cirugías, hospitalizaciones, violencia [Sensible], caídas frecuentes, enfermedades vectoriales
Otros, especifique	Texto

Nota: aquí discapacidad es un antecedente médico Sí/No, no el catálogo de tipo de discapacidad del SIGSA. Son dos datos distintos (ver 5.1).

Psicosociales [Paciente]
Campo	Tipo	Opciones
Vive con	Selección única + texto	Familia, conocido/amigo, institución protectora, privado de libertad, situación de calle, otro (especifique)
Alteraciones del estado de ánimo	Sí/No	
Es objeto de maltrato o abuso, describa	Texto largo [Sensible]	
Estilos de vida [Paciente, se actualiza]

Alimentación y actividad física

Campo	Tipo
Comidas por día	Número
Consumo de	Casillas: cereales, verduras, frutas, carnes, lácteos, agua segura
Actividad física	Sí/No + horas al día (número)
Videojuegos	Sí/No
Otras actividades	Texto
TV	Sí/No
Horas de sueño al día	Número
Higiene diaria	Sí/No
Asiste a grupos de autoayuda	Sí/No
Conduce vehículo	Sí/No
Especifique	Texto
Familiares [Paciente]
Campo	Tipo
Antecedentes familiares	Casillas: diabetes, hipertensión, cáncer, enfermedades transmisibles, ITS, TB, violencia, problemas psicológicos, problemas judiciales, consumo de sustancias psicoactivas, demencia
Vacunación [Paciente, se actualiza]
Campo	Tipo
Td	Sí/No
TdAp	Sí/No
Influenza	Sí/No
Otras, especifique	Texto
Suplementación [Paciente, se actualiza]
Campo	Tipo
Ácido fólico	Sí/No
Sulfato ferroso	Sí/No
Otros, especifique	Texto
Hábitos [Paciente]
Campo	Tipo
Consumo de alcohol	Sí/No
Consumo de tabaco	Sí/No
Consumo de otras sustancias, especifique	Texto
Historia abuso y/o violencia [Paciente] [Sensible]
Campo	Tipo
Historia abuso y/o violencia	Sí/No + especifique
4.7 Signos vitales [Atención]
Campo	Tipo	Notas
Temperatura	Número (°C)	
Frecuencia cardíaca	Número (por min)	
P/A	Texto (mmHg, formato 120/80)	
Frecuencia respiratoria	Número (por min)	
Aspecto general normal	Sí/No + describir	
Peso	Número (kg o lb)	Selector lb/kg
Talla	Número (cm)	
Circunferencia abdominal	Número (cm)	
IMC	Calculado	
Estado nutricional	Calculado	Bajo peso, peso normal, sobrepeso, obesidad
4.8 Examen físico [Atención]

Ver 0.3 (incluye pies).

4.9 En caso de violencia

Ver 0.4.

4.10 Impresión clínica, conducta y tratamiento

Ver 0.5.

4.11 Cierre

Ver 0.6, más:

Campo	Tipo
Firma o huella del paciente o responsable	Firma

Nota: esta ficha no trae campo de fecha de próxima cita en el papel. Confirmar en el centro si la anotan en otro lado; en el sistema conviene tenerlo igual.

5. Diferencias entre fichas que el sistema debe respetar
5.1 Discapacidad
SIGSA: dato de identificación con tipo (0 No aplica, 1 Física, 2 Mental, 3 Visual, 4 Auditiva, 5 Otro). Se necesita para la exportación.
Fichas de niñez y adulto: antecedente médico Sí/No.
Regla: son dos campos distintos. Si el antecedente médico es Sí, el sistema pide el tipo para el SIGSA; si el tipo SIGSA es distinto de "No aplica", el antecedente se marca Sí solo.
5.2 Escolaridad

Cada ficha la pregunta distinto (niñez: estudia, deserción, último grado, años repetidos; adulto: analfabeta, primaria, básicos, diversificado, universitaria). El SIGSA tiene su propio catálogo (01-pacientes.md sección 3). El sistema guarda lo que pide la ficha y lo traduce al código SIGSA al exportar.

5.3 Pueblo

Las fichas tienen 5 opciones (Maya, Garífuna, Xinca, Mestizo, Otro). El SIGSA tiene 6 (agrega "No indica"). Guardar con el código SIGSA; en pantalla mostrar las 5 de la ficha más "No indica".

5.4 Lugar de nacimiento
Neonato y niñez: departamento y municipio de nacimiento.
Adulto: solo departamento de nacimiento.
5.5 Peso

Todas las fichas tienen casillas separadas de kg y lb. En el sistema es un solo campo con selector, guardado siempre en kg.

5.6 Clasificación nutricional
Ficha	Indicadores
Neonato	Clasificación del peso al nacer y del perímetro cefálico
Niñez, menores de 5	Peso/talla, talla/edad, peso/edad
Niñez, 5 a menos de 10	IMC con 5 categorías
Adulto	IMC con 4 categorías (bajo peso, peso normal, sobrepeso, obesidad)
5.7 Datos sensibles

Marcados [Sensible] en todo el documento. Aplican las reglas de 01-pacientes.md sección 6.