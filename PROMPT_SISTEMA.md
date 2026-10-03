# CONTEXTO DEL PROYECTO

Vas a construir un sistema web de gestión clínica para el Centro de Salud de Camotán, Chiquimula, Guatemala. Es un establecimiento público de primer nivel de atención en zona rural. Este documento es la especificación completa. Léela entera antes de escribir código.

Trabajas en español para todo lo visible al usuario. El código, los nombres de variables y los comentarios van en español también, sin tildes en identificadores.

---

# DECISIONES YA CERRADAS

No preguntes estas cinco cosas, ya están resueltas. Están incorporadas al schema y a la lógica.

1. **Una sola clínica.** El establecimiento atiende con una clínica activa. La tabla `Clinica` existe igual para permitir crecimiento, pero la asignación automática es directa: cuando la clínica queda libre, entra el paciente de mayor puntaje.
2. **Signos de peligro configurables**, en tabla propia, editables solo con reautenticación del director (ver sección SIGNOS DE PELIGRO).
3. **Multiestablecimiento desde ahora.** Todas las tablas principales llevan `establecimientoId`.
4. **Sí se registra antropometría histórica** con cálculo de puntaje Z según patrones OMS (ver sección ANTROPOMETRÍA).
5. **La jornada no se cierra con pacientes en cola.** Se atiende hasta vaciarla. Ver sección JORNADA.

Empieza directo con la Fase 1.

---

# REGLAS DE TRABAJO

1. No generes todo el sistema de una vez. Trabaja por fases en el orden indicado en la sección FASES.
2. Al terminar cada fase, detente y reporta qué construiste antes de continuar.
3. No inventes requerimientos que no estén en este documento. Si algo es ambiguo, pregunta.
4. Toda validación de entrada se hace con Zod, en el servidor. Nunca confíes solo en la validación del cliente.
5. Nunca escribas SQL crudo salvo en las vistas materializadas indicadas explícitamente. Todo lo demás va por Prisma.
6. Nunca guardes secretos en el código. Van en variables de entorno.
7. Cada endpoint que escriba en base de datos debe registrar en bitácora.
8. Escribe pruebas para la lógica de negocio pura (priorización, cálculo de cobertura, FEFO) antes de integrarla.

---

# STACK OBLIGATORIO

```
Frontend:  Vue 3 (Composition API, <script setup>) + Vite
           Vue Router 4, Pinia 2, Tailwind CSS 3.4, Chart.js 4 + vue-chartjs
Backend:   Node.js 20 LTS + Express 4
ORM:       Prisma 5
BD:        PostgreSQL 16
Auth:      jsonwebtoken + bcrypt
Validación: Zod 3
Pruebas:   Vitest + Supertest
Despliegue: Render
```

No agregues dependencias fuera de esta lista sin justificarlo primero. No uses TypeScript. No uses Docker. No uses Redis.

---

# ESTRUCTURA DE CARPETAS

```
/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.js
│   ├── src/
│   │   ├── config/         db.js, env.js
│   │   ├── middleware/     auth.js, rbac.js, validar.js, bitacora.js, errores.js
│   │   ├── routes/         index.js + un archivo por recurso
│   │   ├── controllers/    un archivo por recurso
│   │   ├── services/       logica de negocio pura
│   │   ├── schemas/        esquemas Zod
│   │   ├── jobs/           recalcularCola.js, evaluarAlertas.js, refrescarVistas.js
│   │   ├── utils/
│   │   └── app.js
│   ├── tests/
│   └── package.json
└── frontend/
    ├── src/
    │   ├── assets/
    │   ├── components/     comunes/ y por modulo/
    │   ├── composables/
    │   ├── layouts/
    │   ├── router/
    │   ├── stores/         Pinia
    │   ├── services/       cliente HTTP
    │   ├── views/          una carpeta por modulo
    │   ├── App.vue
    │   └── main.js
    └── package.json
```

---

# ROLES DEL SISTEMA

Exactamente cuatro. No agregues más.

| Rol | Clave interna | Acceso |
|---|---|---|
| Administrador general | `admin` | Todo |
| Personal de preconsulta | `preconsulta` | Pacientes, preconsulta, cola |
| Médico | `medico` | Cola, consulta, expediente, prescripción |
| Personal de farmacia | `farmacia` | Inventario, lotes, dispensación, trazabilidad |

El rol viaja dentro del JWT firmado. El middleware `rbac.js` lo verifica en cada endpoint.

---

# MODELO DE DATOS

Genera este `schema.prisma`. Respeta los índices, son necesarios para el rendimiento de la cola y las alertas.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model Establecimiento {
  id           Int      @id @default(autoincrement())
  codigo       String   @unique   // codigo institucional MSPAS
  nombre       String
  municipio    String
  departamento String
  tipo         String   // centro_salud_a | centro_salud_b | puesto_salud
  activo       Boolean  @default(true)
  creadoEn     DateTime @default(now())

  usuarios     Usuario[]
  pacientes    Paciente[]
  clinicas     Clinica[]
  insumos      Insumo[]
  signos       SignoPeligro[]
}

model Usuario {
  id                Int      @id @default(autoincrement())
  establecimientoId Int
  usuario           String   @unique
  passwordHash      String
  nombre            String
  dpi               String?  @unique   // solo identificador, NO es secreto
  rol               String   // admin | preconsulta | medico | farmacia
  esDirector        Boolean  @default(false) // habilita cambios protegidos
  activo            Boolean  @default(true)
  totpSecret        String?
  creadoEn          DateTime @default(now())

  establecimiento   Establecimiento @relation(fields: [establecimientoId], references: [id])
  bitacora          Bitacora[]

  @@index([establecimientoId, rol])
}

model Paciente {
  id                Int    @id @default(autoincrement())
  establecimientoId Int
  cui             String?  @unique
  expediente      String   @unique
  nombres         String
  apellidos       String
  fechaNacimiento DateTime
  sexo            String   // M | F
  comunidad       String
  telefono        String?
  idiomaMaterno   String   @default("espanol")
  activo          Boolean  @default(true)
  creadoEn        DateTime @default(now())

  establecimiento Establecimiento @relation(fields: [establecimientoId], references: [id])
  condiciones     CondicionPaciente[]
  atenciones      Atencion[]
  antropometrias  Antropometria[]

  @@index([establecimientoId, apellidos, nombres])
  @@index([establecimientoId, comunidad])
}

model CondicionPaciente {
  id         Int      @id @default(autoincrement())
  pacienteId Int
  tipo       String   // embarazo | menor_5 | adulto_mayor | discapacidad
  vigenteDesde DateTime @default(now())
  vigenteHasta DateTime?
  paciente   Paciente @relation(fields: [pacienteId], references: [id])
  @@index([pacienteId])
}

model Clinica {
  id                Int     @id @default(autoincrement())
  establecimientoId Int
  nombre            String
  disponible        Boolean @default(true)
  activa            Boolean @default(true)

  establecimiento   Establecimiento @relation(fields: [establecimientoId], references: [id])
  atenciones        Atencion[]
}

model SignoPeligro {
  id                Int      @id @default(autoincrement())
  establecimientoId Int
  codigo            String
  descripcion       String
  grupoEtario       String   // todos | menor_5 | embarazada | adulto_mayor
  gravedadSugerida  String   // urgente | moderado
  orden             Int      @default(0)
  activo            Boolean  @default(true)
  creadoEn          DateTime @default(now())
  actualizadoEn     DateTime @updatedAt
  actualizadoPor    Int?

  establecimiento   Establecimiento @relation(fields: [establecimientoId], references: [id])

  @@unique([establecimientoId, codigo])
  @@index([establecimientoId, activo, orden])
}

model Antropometria {
  id                Int      @id @default(autoincrement())
  pacienteId        Int
  atencionId        Int?     // null si se tomo en jornada extramural
  fecha             DateTime @default(now())
  edadMeses         Int
  peso              Decimal  @db.Decimal(5,2)
  talla             Decimal  @db.Decimal(5,2)
  perimetroCefalico Decimal? @db.Decimal(4,1)
  perimetroBraquial Decimal? @db.Decimal(4,1)  // MUAC, clave en desnutricion aguda
  zPesoEdad         Decimal? @db.Decimal(4,2)
  zTallaEdad        Decimal? @db.Decimal(4,2)
  zPesoTalla        Decimal? @db.Decimal(4,2)
  zImcEdad          Decimal? @db.Decimal(4,2)
  clasificacion     String?  // normal|riesgo|desnutricion_aguda_moderada|desnutricion_aguda_severa|desnutricion_cronica|sobrepeso

  paciente          Paciente @relation(fields: [pacienteId], references: [id])

  @@index([pacienteId, fecha])
  @@index([clasificacion])
}

model ReferenciaOms {
  id         Int     @id @default(autoincrement())
  indicador  String  // peso_edad | talla_edad | peso_talla | imc_edad
  sexo       String  // M | F
  x          Decimal @db.Decimal(6,2)  // edad en meses, o talla en cm segun indicador
  l          Decimal @db.Decimal(10,6)
  m          Decimal @db.Decimal(10,6)
  s          Decimal @db.Decimal(10,6)

  @@unique([indicador, sexo, x])
}

model Atencion {
  id             Int       @id @default(autoincrement())
  establecimientoId Int
  pacienteId     Int
  clinicaId      Int?
  estado         String    @default("en_espera") // en_espera|en_atencion|atendido|ausente
  gravedad       String    // urgente | moderado | leve
  puntaje        Int       @default(0)
  ausencias      Int       @default(0)
  motivoConsulta String
  registradaEn   DateTime  @default(now())
  reingresoEn    DateTime?
  llamadaEn      DateTime?
  iniciadaEn     DateTime?
  cerradaEn      DateTime?
  diagnosticoCie String?
  diagnosticoTxt String?
  tratamiento    String?
  proximaCita    DateTime?

  paciente       Paciente  @relation(fields: [pacienteId], references: [id])
  clinica        Clinica?  @relation(fields: [clinicaId], references: [id])
  preconsulta    Preconsulta?
  prescripciones Prescripcion[]

  @@index([establecimientoId, estado, puntaje(sort: Desc)])
  @@index([registradaEn])
  @@index([pacienteId, registradaEn])
}

model Preconsulta {
  id               Int      @id @default(autoincrement())
  atencionId       Int      @unique
  peso             Decimal? @db.Decimal(5,2)
  talla            Decimal? @db.Decimal(5,2)
  temperatura      Decimal? @db.Decimal(4,1)
  presionSis       Int?
  presionDia       Int?
  frecCardiaca     Int?
  frecRespiratoria Int?
  satOxigeno       Int?
  signosPeligro    String[]
  registradaEn     DateTime @default(now())
  atencion         Atencion @relation(fields: [atencionId], references: [id])
}

model Insumo {
  id                Int    @id @default(autoincrement())
  establecimientoId Int
  codigoMspas     String?  @unique
  nombreGenerico  String
  nombreComercial String?
  componente      String?
  categoria       String   // medicamento|material_curacion|uso_unico|biologico
  presentacion    String
  unidadMedida    String
  stockMinimo     Int      @default(0)
  activo          Boolean  @default(true)

  establecimiento Establecimiento @relation(fields: [establecimientoId], references: [id])
  lotes           Lote[]

  @@index([establecimientoId, nombreGenerico])
  @@index([componente])
}

model Lote {
  id              Int      @id @default(autoincrement())
  insumoId        Int
  numeroLote      String
  fechaVence      DateTime
  cantidadInicial Int
  cantidadActual  Int
  recibidoEn      DateTime @default(now())
  insumo          Insumo   @relation(fields: [insumoId], references: [id])
  movimientos     MovimientoInsumo[]

  @@unique([insumoId, numeroLote])
  @@index([fechaVence])
  @@index([insumoId, fechaVence])
}

model Prescripcion {
  id            Int      @id @default(autoincrement())
  atencionId    Int
  insumoId      Int
  cantidad      Int
  indicaciones  String?
  creadaEn      DateTime @default(now())
  atencion      Atencion @relation(fields: [atencionId], references: [id])
  dispensaciones Dispensacion[]
  @@index([atencionId])
}

model Dispensacion {
  id             Int      @id @default(autoincrement())
  prescripcionId Int
  cantidad       Int
  parcial        Boolean  @default(false)
  anulada        Boolean  @default(false)
  usuarioId      Int
  registradaEn   DateTime @default(now())
  prescripcion   Prescripcion @relation(fields: [prescripcionId], references: [id])
  movimientos    MovimientoInsumo[]
}

model MovimientoInsumo {
  id              Int      @id @default(autoincrement())
  loteId          Int
  tipo            String   // ingreso|salida|ajuste|baja
  cantidad        Int
  saldoResultante Int
  dispensacionId  Int?
  usuarioId       Int
  motivo          String?
  registradoEn    DateTime @default(now())
  lote            Lote     @relation(fields: [loteId], references: [id])
  dispensacion    Dispensacion? @relation(fields: [dispensacionId], references: [id])

  @@index([loteId, registradoEn])
  @@index([registradoEn])
  @@index([tipo, registradoEn])
}

model Alerta {
  id          Int      @id @default(autoincrement())
  establecimientoId Int
  tipo        String   // vencimiento|existencia_baja|cita_vencida|patron_clinico|desnutricion
  severidad   String   // alta | media | baja
  entidadTipo String   // lote | insumo | paciente
  entidadId   Int
  mensaje     String
  atendida    Boolean  @default(false)
  atendidaPor Int?
  generadaEn  DateTime @default(now())

  @@index([atendida, severidad])
  @@index([entidadTipo, entidadId])
}

model Bitacora {
  id         Int      @id @default(autoincrement())
  usuarioId  Int
  accion     String   // crear|leer|actualizar|eliminar|exportar
  entidad    String
  entidadId  Int?
  ip         String?
  detalle    String?
  registradaEn DateTime @default(now())
  usuario    Usuario  @relation(fields: [usuarioId], references: [id])
  @@index([usuarioId, registradaEn])
  @@index([entidad, entidadId])
}
```

---

# LÓGICA DE NEGOCIO CRÍTICA

Estas tres funciones son el corazón del sistema. Impleméntalas en `services/` como funciones puras y escríbeles pruebas antes de conectarlas a la base de datos.

## 1. Cálculo de puntaje de prioridad

```javascript
// services/priorizacion.service.js
// Debe ser función pura: recibe datos, devuelve número. Sin acceso a BD.

const PESO_GRAVEDAD  = { urgente: 40, moderado: 25, leve: 10 };
const PESO_CONDICION = { embarazo: 30, menor_5: 30, adulto_mayor: 25, discapacidad: 25 };
const PENALIZACION_AUSENCIA = 10;

function calcularPuntaje({ gravedad, condiciones, inicioEspera, ausencias }, ahora) {
  const g = PESO_GRAVEDAD[gravedad] ?? 0;

  // Si coexisten varias condiciones se toma SOLO la de mayor puntaje
  const c = condiciones?.length
    ? Math.max(...condiciones.map(x => PESO_CONDICION[x] ?? 0))
    : 0;

  const min = (ahora - inicioEspera) / 60000;
  const e = min >= 90 ? 30 : min >= 60 ? 25 : min >= 30 ? 15 : 5;

  return Math.max(0, g + c + e - (ausencias * PENALIZACION_AUSENCIA));
}
```

**Reglas de la cola que debes implementar:**
- `inicioEspera` es `reingresoEn` si existe, si no `registradaEn`. Cuando un paciente vuelve de ausente, su cronómetro se reinicia.
- Un caso con gravedad `urgente` se asigna a la clínica disponible sin importar el puntaje de los demás. Esta regla va ANTES de ordenar por puntaje. Con una sola clínica, el urgente desplaza al siguiente en cola y este conserva su puntaje.
- Job cada 5 minutos reordena la cola. **No hagas UPDATE masivo**: calcula el puntaje al leer la cola y persiste solo cuando cambia el estado.
- Segunda ausencia en la misma jornada: el paciente sale del sistema, estado `ausente` definitivo, debe registrarse de nuevo.

## 2. Selección de lote FEFO

```javascript
// services/inventario.service.js
// First Expired, First Out: propone el lote de vencimiento mas proximo
// con existencia suficiente. Si el usuario elige otro, exige motivo.

function seleccionarLoteFEFO(lotes, cantidadRequerida) {
  const disponibles = lotes
    .filter(l => l.cantidadActual > 0 && l.fechaVence > new Date())
    .sort((a, b) => a.fechaVence - b.fechaVence);

  const suficiente = disponibles.find(l => l.cantidadActual >= cantidadRequerida);
  if (suficiente) return { lote: suficiente, requiereFraccionamiento: false };

  // Si ningun lote alcanza solo, se fracciona entre varios
  return { lotes: disponibles, requiereFraccionamiento: true };
}
```

## 3. Días de cobertura

```javascript
// services/indicadores.service.js
function diasCobertura(saldoTotal, consumoDiarioPromedio) {
  if (!consumoDiarioPromedio || consumoDiarioPromedio === 0) return null; // no calculable
  return Math.floor(saldoTotal / consumoDiarioPromedio);
}

function excedenteProyectado(saldoTotal, consumoDiario, fechaVence, ahora) {
  const diasHasta = Math.max(0, (fechaVence - ahora) / 86400000);
  return Math.max(0, Math.round(saldoTotal - (consumoDiario * diasHasta)));
}
```

**Importante:** si no hay historial suficiente, `diasCobertura` devuelve `null` y la interfaz muestra "Cobertura no calculable: se requieren 30 días de historial". **Nunca muestres 0 ni un número inventado.**

---

# REQUERIMIENTO CENTRAL: INFORMACIÓN ÚTIL PERMANENTE

Este es el requerimiento que diferencia el sistema. Léelo con atención.

**El sistema NO tiene un módulo de reportes que el usuario visite.** No construyas una pantalla llamada "Reportes" con filtros y un botón de generar. En su lugar, cada pantalla muestra información derivada en el punto donde se toma la decisión correspondiente.

## Regla de oro

Cuando muestres un dato, pregúntate qué decisión habilita. Si no habilita ninguna, transfórmalo o no lo muestres.

```
MAL:  "Amoxicilina 500mg — 340 unidades — vence 12/08/2026"
BIEN: "Amoxicilina 500mg — cobertura 18 días — sobrarán ~190 unidades al vencer"
```

## Panel de inicio por rol

Al iniciar sesión, cada rol entra directo a su panel operativo. No hay pantalla de bienvenida vacía.

**Preconsulta** (`/panel/preconsulta`)
- Cola actual con conteo, espera promedio y el paciente que lleva más tiempo esperando
- Advertencia visible si alguien supera 90 minutos
- Lista de citas programadas para hoy que aún no llegan

**Médico** (`/panel/medico`)
- Tarjeta del siguiente paciente con sus alertas clínicas derivadas ya calculadas:
  - Signos vitales fuera de rango para la edad
  - Consultas repetidas por el mismo diagnóstico (3 o más en 60 días)
  - Peso fuera del rango esperado en menores de 5 años
- Contador de atendidos hoy y tiempo promedio de consulta

**Farmacia** (`/panel/farmacia`)
- Bloque "Requieren acción": insumos con menos de 15 días de cobertura, lotes en ventana de vencimiento con excedente proyectado
- Prescripciones pendientes de entrega
- Diferencia de inventario acumulada del mes, con el insumo de mayor discrepancia

**Administrador** (`/panel/admin`)
- Atenciones de la semana con comparación contra la semana anterior
- Espera promedio y su variación
- Insumos que se agotan antes del próximo despacho
- Comunidades sin atenciones en 30 días, ordenadas por rezago
- Estado del consolidado SIGSA del mes en curso, siempre listo para exportar

## Alertas dentro del flujo

Estas aparecen en el momento de la acción, nunca en una bandeja separada:

| Momento | Alerta |
|---|---|
| Al buscar paciente | "Existe expediente con nombre similar. ¿Es la misma persona?" |
| Al registrar preconsulta | "Temperatura fuera de rango para la edad" |
| Al abrir consulta | "Tercera consulta por el mismo diagnóstico en 60 días" |
| Al prescribir | "Quedan 3 unidades, cobertura de 1 día" |
| Al dispensar otro lote | "Este no es el de vencimiento más próximo. Indique motivo" |
| Al recibir insumo | "Este lote vence en 40 días, dentro de la ventana de alerta" |
| Al cerrar jornada | "4 pacientes quedaron en cola sin atender" |

## Ventanas de alerta de vencimiento

| Categoría | Ventana |
|---|---|
| `biologico` | 6 meses |
| `medicamento` | 3 meses |
| `material_curacion`, `uso_unico` | 2 meses |

Semáforo: verde fuera de ventana, amarillo dentro, rojo a menos de un tercio de la ventana o ya vencido.

## Consolidado SIGSA como estado, no como acción

El consolidado del mes se mantiene actualizado permanentemente. El administrador lo ve siempre en su panel. Cuando toca reportar, solo exporta lo que ya estaba armado. Contenido: atenciones por servicio y grupo de edad, diagnósticos por CIE-10, consumo de insumos por período, existencias por lote, tiempos promedio de espera por categoría de prioridad. Exporta a XLSX.

## Implementación de indicadores

- **Tiempo real:** puntaje de cola, tiempo de espera, saldo actual
- **Vistas materializadas refrescadas cada hora:** consumo promedio, días de cobertura, atenciones por período, cobertura territorial
- **Job horario** que evalúa umbrales y persiste alertas en la tabla `Alerta`, para que el panel cargue instantáneo

Crea esta vista materializada:

```sql
CREATE MATERIALIZED VIEW consumo_diario AS
SELECT
  l.insumo_id,
  SUM(ABS(m.cantidad))::numeric / 30 AS consumo_dia,
  COUNT(*) AS movimientos,
  MAX(m.registrado_en) AS ultimo_movimiento
FROM movimiento_insumo m
JOIN lote l ON l.id = m.lote_id
WHERE m.tipo = 'salida'
  AND m.registrado_en >= NOW() - INTERVAL '30 days'
GROUP BY l.insumo_id;

CREATE UNIQUE INDEX ON consumo_diario (insumo_id);
```

---

# SIGNOS DE PELIGRO CONFIGURABLES

Los signos de peligro viven en la tabla `SignoPeligro`, no en un arreglo fijo. El personal de preconsulta los marca al registrar; si marca alguno cuyo `gravedadSugerida` sea `urgente`, el sistema propone gravedad urgente y exige justificación escrita si el personal la baja.

## Protección de la edición

Editar el catálogo requiere **reautenticación del director**, aunque ya haya sesión activa. Flujo:

```
PATCH /api/v1/admin/signos-peligro/:id
Body: { ...cambios, autorizacion: { dpi, password } }

1. Verificar que exista Usuario con ese dpi, activo, esDirector = true
2. Verificar password con bcrypt contra ese usuario
3. Si falla: 403, registrar intento en bitacora, NO revelar cual dato fallo
4. Si pasa: aplicar cambio, registrar en bitacora con accion 'config_signos'
   y detalle del valor anterior y el nuevo
5. La autorizacion NO genera sesion nueva ni token: sirve solo para esa operacion
```

Aplica el mismo mecanismo a: desactivar un usuario, modificar umbrales de alerta y cambiar la configuración del establecimiento.

## Advertencia de seguridad que debes respetar

El DPI **no es un secreto**: aparece en documentos, listados y trámites. Trátalo como nombre de usuario, nunca como contraseña. La seguridad real la da la contraseña, que va con bcrypt costo 12. Implementa además:

- Límite de 3 intentos fallidos de autorización por hora, por IP
- Registro en bitácora de todo intento, exitoso o no
- Mensaje de error genérico: "Credenciales de autorización inválidas", sin decir si falló el DPI o la contraseña

Si el director puede tener TOTP configurado, pídelo como tercer factor en lugar de la contraseña sola. Es preferible.

## Catálogo inicial (seed)

Siembra estos signos, basados en la estrategia AIEPI del MSPAS:

| Código | Descripción | Grupo | Gravedad |
|---|---|---|---|
| `conv` | Convulsiones | todos | urgente |
| `no_bebe` | No puede beber ni mamar | menor_5 | urgente |
| `vomita_todo` | Vomita todo lo que ingiere | menor_5 | urgente |
| `letargico` | Letárgico o inconsciente | todos | urgente |
| `tiraje` | Tiraje subcostal | menor_5 | urgente |
| `estridor` | Estridor en reposo | menor_5 | urgente |
| `deshidratacion` | Signos de deshidratación grave | todos | urgente |
| `sangrado` | Sangrado activo | todos | urgente |
| `fiebre_alta` | Fiebre mayor a 39°C | todos | moderado |
| `dificultad_resp` | Dificultad respiratoria | todos | urgente |
| `edema` | Edema en ambos pies | menor_5 | urgente |
| `sangrado_vaginal` | Sangrado vaginal | embarazada | urgente |
| `cefalea_severa` | Cefalea severa con visión borrosa | embarazada | urgente |
| `dolor_pecho` | Dolor torácico | adulto_mayor | urgente |

---

# ANTROPOMETRÍA Y CURVAS DE CRECIMIENTO

Este módulo aprovecha que el sistema ya captura peso y talla en preconsulta. Es de alto valor porque Camotán es territorio prioritario en desnutrición infantil.

## Qué se registra

Cada medición de un paciente menor de 5 años genera un registro en `Antropometria`, vinculado a la atención cuando ocurre en consulta, o sin atención cuando se toma en jornada extramural.

Además de peso y talla, captura **perímetro braquial (MUAC)** en menores de 5 años. Es el indicador más directo de desnutrición aguda y se mide con una cinta que el establecimiento ya tiene.

## Cálculo del puntaje Z (método LMS)

Los patrones de crecimiento de la OMS se distribuyen como tablas LMS. La fórmula:

```javascript
// services/antropometria.service.js — funcion pura, con pruebas
function calcularZ(valor, L, M, S) {
  if (L === 0) return Math.log(valor / M) / S;
  return (Math.pow(valor / M, L) - 1) / (L * S);
}

// Los valores extremos se ajustan segun la norma OMS
function ajustarZExtremo(z, valor, L, M, S) {
  if (z > 3) {
    const sd3 = valorEnZ(3, L, M, S), sd23 = sd3 - valorEnZ(2, L, M, S);
    return 3 + (valor - sd3) / sd23;
  }
  if (z < -3) {
    const sd3neg = valorEnZ(-3, L, M, S), sd23neg = valorEnZ(-2, L, M, S) - sd3neg;
    return -3 + (valor - sd3neg) / sd23neg;
  }
  return z;
}

function valorEnZ(z, L, M, S) {
  if (L === 0) return M * Math.exp(S * z);
  return M * Math.pow(1 + L * S * z, 1 / L);
}
```

## Clasificación automática

| Indicador | Puntaje Z | Clasificación |
|---|---|---|
| Peso para la talla | < −3 | Desnutrición aguda severa |
| Peso para la talla | −3 a −2 | Desnutrición aguda moderada |
| Peso para la talla | −2 a −1 | Riesgo de desnutrición |
| Talla para la edad | < −2 | Desnutrición crónica (retardo de talla) |
| IMC para la edad | > +2 | Sobrepeso |

MUAC como criterio independiente en menores de 5 años: menor a 115 mm indica desnutrición aguda severa; entre 115 y 125 mm, moderada.

## Datos de referencia OMS

La tabla `ReferenciaOms` necesita cargarse en el seed. Descarga los archivos LMS oficiales de la OMS (indicadores peso para la edad, talla para la edad, peso para la talla e IMC para la edad, de 0 a 60 meses, ambos sexos) y genera el seed a partir de ellos. Son alrededor de 2,500 filas en total.

Si no logras obtener los archivos, deja el módulo funcionando pero devolviendo `null` en los puntajes Z, con el mensaje "Tablas de referencia OMS no cargadas". **No inventes valores.**

## Dónde aparece esta información

Siguiendo la regla de información útil permanente:

- **Al registrar preconsulta de un menor de 5 años:** al capturar peso y talla, el sistema muestra de inmediato el puntaje Z y la clasificación, con el semáforo correspondiente.
- **En el expediente:** gráfica de la curva de crecimiento del paciente sobre las bandas de referencia OMS, con Chart.js.
- **Alerta al médico:** "Peso para la talla en −2.4 DE, clasificación de desnutrición aguda moderada" y, si aplica, "descenso de 0.8 DE respecto a la medición anterior".
- **Panel del administrador:** conteo de menores de 5 años por clasificación y listado de casos severos sin control en los últimos 30 días.

Esta última es la que más valor tiene: identifica a los niños que dejaron de asistir estando en desnutrición.

---

# JORNADA DE ATENCIÓN

**La jornada no se cierra mientras haya pacientes en cola.** No implementes un cierre automático por hora.

Reglas:

- Una jornada equivale a un día calendario, para efectos del conteo de ausencias.
- Al llegar la hora de fin de horario, el sistema **no bloquea nada**. Solo muestra en el panel de preconsulta y en el del médico: "Fin de horario. Quedan N pacientes en cola."
- El puntaje sigue subiendo por tiempo de espera, de modo que los pacientes más antiguos se atienden primero.
- El conteo de ausencias (`ausencias`) se reinicia con el cambio de día calendario, no con el fin de horario.
- Si un paciente en cola es marcado ausente después del horario, aplica la misma regla de siempre: penalización de 10 puntos y reinicio del cronómetro.
- Al vaciarse la cola, el sistema muestra el resumen del día en el panel del médico: atenciones realizadas, tiempo promedio, urgentes atendidos, ausentes.

Reemplaza la alerta "Al cerrar jornada: 4 pacientes quedaron en cola" por "Fin de horario: N pacientes aún en cola, espera del más antiguo: X".

---

# API REST

Base `/api/v1`. JWT en `Authorization: Bearer`. Errores uniformes `{ error: { codigo, mensaje, detalles } }`.

```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /pacientes?buscar=&comunidad=&pagina=&limite=
POST   /pacientes
GET    /pacientes/:id
PATCH  /pacientes/:id
GET    /pacientes/:id/historial
GET    /pacientes/:id/alertas

POST   /atenciones
GET    /atenciones/cola
PATCH  /atenciones/:id/estado
POST   /atenciones/:id/preconsulta
PATCH  /atenciones/:id/consulta
POST   /atenciones/:id/prescripcion

GET    /insumos?buscar=&categoria=
POST   /insumos
GET    /insumos/:id/cobertura
POST   /insumos/:id/lotes
GET    /lotes/:id/trazabilidad
POST   /dispensaciones
POST   /inventario/ajustes

GET    /indicadores/panel/:rol
GET    /indicadores/alertas
GET    /indicadores/consolidado?mes=
GET    /indicadores/consolidado/export

GET    /pacientes/:id/antropometria
POST   /pacientes/:id/antropometria
GET    /pacientes/:id/curva?indicador=peso_talla

GET    /admin/signos-peligro
POST   /admin/signos-peligro          ← requiere autorizacion de director
PATCH  /admin/signos-peligro/:id      ← requiere autorizacion de director
GET    /admin/usuarios
POST   /admin/usuarios
GET    /admin/bitacora
GET    /admin/establecimiento
PATCH  /admin/establecimiento         ← requiere autorizacion de director
```

---

# SEGURIDAD

| Control | Implementación |
|---|---|
| JWT | Expiración 8 horas (una jornada) |
| Contraseñas | bcrypt costo 12 |
| 2FA (TOTP) | Solo para rol `admin` |
| Autorización | Middleware `rbac.js` por endpoint |
| HTTPS | Forzado, redirección desde HTTP |
| Validación | Zod antes del controlador, siempre |
| Bitácora | Toda escritura **y toda lectura de expediente clínico** |
| Secretos | Variables de entorno |

---

# TOLERANCIA A DESCONEXIÓN

El establecimiento tiene conectividad irregular. Implementa:

1. **Caché de lectura:** cola de atención y catálogo de insumos en el navegador. Si cae la red, se sigue viendo con marca visible "datos de hace N minutos".
2. **Cola de escritura:** registro de preconsulta y dispensación se encolan en IndexedDB si falla la petición, y se reenvían al recuperar conexión. Cada operación lleva un `idempotencyKey` generado en el cliente para que el reenvío no duplique registros.
3. **No permitido sin conexión:** cerrar atención médica y confirmar ajuste de inventario. Ambas afectan saldos.

---

# FASES DE CONSTRUCCIÓN

Sigue este orden. Detente al final de cada fase y reporta.

**Fase 1 — Base**
Monorepo, backend Express, frontend Vite+Vue, Tailwind, conexión Prisma a PostgreSQL, schema completo, primera migración. Seed con: un establecimiento (Centro de Salud de Camotán), una clínica, usuarios de prueba de los cuatro roles más un director, catálogo de signos de peligro AIEPI y catálogo mínimo de insumos.

**Fase 2 — Autenticación**
Login, JWT, bcrypt, middleware auth y rbac, bitácora, guards de router en frontend, redirección al panel según rol.

**Fase 3 — Pacientes y preconsulta**
CRUD de pacientes con búsqueda por nombre y CUI, detección de posibles duplicados, registro de condiciones especiales, formulario de preconsulta que carga los signos de peligro desde la tabla configurable y marca valores fuera de rango por edad.

**Fase 3b — Antropometría**
Carga de tablas OMS, cálculo de puntaje Z con pruebas unitarias, clasificación automática, registro de MUAC, gráfica de curva de crecimiento en el expediente.

**Fase 4 — Cola y consulta médica**
Servicio de priorización con pruebas, endpoint de cola, job de recálculo, cambios de estado, pantalla de consulta médica con historial y alertas clínicas, registro de diagnóstico CIE-10 y prescripción.

**Fase 5 — Inventario y trazabilidad**
Catálogo de insumos, recepción con lote y vencimiento, FEFO con pruebas, dispensación vinculada a prescripción, movimientos con saldo, consulta de trazabilidad completa del lote, ajustes de inventario.

**Fase 6 — Indicadores y paneles**
Vistas materializadas, job horario de alertas, endpoint de panel por rol, los cuatro paneles en frontend, alertas contextuales en los formularios.

**Fase 7 — Consolidado y cierre**
Consolidado SIGSA permanente, exportación XLSX, tolerancia a desconexión, pruebas de integración, 2FA para admin, mecanismo de autorización del director y administración de signos de peligro.

---
