# Sistema de gestion clinica — Centro de Salud de Camotan

Sistema web para un establecimiento publico de primer nivel de atencion en
Camotan, Chiquimula, Guatemala.

## Que resuelve

El sistema no tiene un modulo de reportes que alguien tenga que visitar. Cada
pantalla muestra informacion ya interpretada en el punto donde se toma la
decision correspondiente:

- La cola muestra el puntaje de prioridad y la espera, no solo una lista.
- Al capturar peso y talla de un menor de 5 anios aparece el puntaje Z y la
  clasificacion nutricional en el acto.
- Al prescribir se avisa si no hay existencia con que cumplir la receta.
- Al dispensar, el sistema propone el lote de vencimiento mas proximo y exige
  motivo escrito si se elige otro.
- El consolidado SIGSA esta siempre armado: al reportar solo se exporta.

Cuando un dato no se puede calcular, el sistema lo dice. Nunca muestra un 0
que se leeria como un valor real.

## Stack

| Capa | Tecnologia |
|---|---|
| Frontend | Vue 3 (Composition API) + Vite 5, Vue Router 4, Pinia 2, Tailwind 3.4, Chart.js 4 |
| Backend | Node.js 20 + Express 4 |
| ORM | Prisma 5 |
| Base de datos | PostgreSQL 16 |
| Auth | jsonwebtoken + bcrypt (costo 12) + TOTP (otplib) |
| Validacion | Zod 3 |
| Pruebas | Vitest + Supertest |

Dependencias agregadas fuera de la lista original, con su justificacion:

- `exceljs` — la exportacion del consolidado a XLSX lo exige.
- `otplib` — el segundo factor TOTP lo exige. Fijada en la 12 porque la 13 es
  solo ESM y el backend es CommonJS.
- `qrcode` — para dar de alta el TOTP escaneando, en lugar de tipear a mano
  una clave de 32 caracteres.

## Puesta en marcha

### 1. Base de datos

```bash
createdb -U postgres camotan
psql -U postgres -d camotan -f bd/01_esquema.sql
psql -U postgres -d camotan -f bd/02_vistas.sql
psql -U postgres -d camotan -f bd/03_catalogos.sql
```

### 2. Backend

```bash
cd backend
npm install
```

Crear `backend/.env`:

```
DATABASE_URL="postgresql://usuario:clave@localhost:5432/camotan"
DATABASE_URL_TEST="postgresql://usuario:clave@localhost:5432/camotan_test"
JWT_SECRET=<cadena aleatoria larga>
```

Generar un secreto: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

```bash
npx prisma generate
npm run seed     # usuarios de prueba, catalogos y las 2770 filas de la OMS
npm run dev
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

### 4. Base de pruebas

Las pruebas corren contra una base propia para no ensuciar los datos de
trabajo ni depender de su estado:

```bash
createdb -U postgres camotan_test
psql -U postgres -d camotan_test -f bd/01_esquema.sql
psql -U postgres -d camotan_test -f bd/02_vistas.sql
psql -U postgres -d camotan_test -f bd/03_catalogos.sql
cd backend
DATABASE_URL="postgresql://usuario:clave@localhost:5432/camotan_test" node prisma/seed.js
npm test
```

## Usuarios de prueba

Solo para desarrollo. Cambiar antes de cualquier despliegue real.

| Usuario | Contrasena | Rol |
|---|---|---|
| `admin` | `Camotan2026!` | Administrador |
| `preconsulta` | `Camotan2026!` | Preconsulta |
| `medico` | `Camotan2026!` | Medico |
| `farmacia` | `Camotan2026!` | Farmacia |
| `director` | `Director2026!` | Administrador con `esDirector` |

El director tiene DPI `1234567890101`, que es el que pide el sistema al
autorizar operaciones protegidas.

## Arquitectura

```
backend/src/
  config/       conexion a base de datos y variables de entorno
  middleware/   auth, rbac, validacion Zod, bitacora, idempotencia, errores
  routes/       una por recurso
  controllers/  una por recurso
  services/     logica de negocio; la parte pura tiene pruebas propias
  jobs/         recalcularCola, refrescarVistas, evaluarAlertas
  schemas/      esquemas Zod
frontend/src/
  components/   comunes y por modulo
  layouts/      LayoutPrincipal con navegacion y barra de conexion
  router/       rutas con guards por rol
  services/     cliente HTTP, almacen IndexedDB y servicios por recurso
  stores/       Pinia: auth y sincronizacion
  views/        una carpeta por modulo
```

### Logica de negocio con pruebas propias

Estan escritas como funciones puras, sin acceso a base de datos:

| Servicio | Que decide |
|---|---|
| `priorizacion.service.js` | Puntaje de cola. La urgencia se resuelve antes de ordenar por puntaje |
| `antropometria.service.js` | Puntaje Z por metodo LMS, clasificacion y MUAC |
| `inventario.service.js` | FEFO, fraccionamiento y ventanas de vencimiento |
| `indicadores.service.js` | Dias de cobertura y excedente proyectado |
| `signosVitales.service.js` | Rangos por edad y respiracion rapida AIEPI |
| `pacientes.service.js` | Similitud de nombres para detectar duplicados |

### Jobs

| Job | Cada | Que hace |
|---|---|---|
| `recalcularCola` | 5 min | Asigna la clinica libre al de mayor prioridad |
| `refrescarVistas` | 1 hora | `REFRESH MATERIALIZED VIEW CONCURRENTLY` |
| `evaluarAlertas` | 1 hora | Evalua umbrales y persiste en la tabla `Alerta` |

El job de alertas es idempotente y cierra solo las alertas cuya causa
desaparecio.

## Seguridad

- JWT de 8 horas (una jornada). El usuario se relee en cada peticion: si el
  director desactiva a alguien, su token deja de servir de inmediato.
- Contrasenas con bcrypt costo 12.
- Sin enumeracion de usuarios: usuario inexistente, desactivado y contrasena
  incorrecta devuelven la misma respuesta, y se compara siempre contra un hash
  senuelo para que el tiempo tampoco delate.
- Los errores 5xx nunca llegan al cliente con detalle interno.
- Bitacora de toda escritura y de toda lectura de expediente clinico.

### Autorizacion del director

Las operaciones protegidas (editar signos de peligro, desactivar usuarios,
modificar el establecimiento) exigen reautenticacion del director aunque ya
haya sesion abierta:

- El DPI se trata como nombre de usuario, no como secreto: aparece en
  documentos y listados.
- La seguridad la da la contrasena, y el TOTP como tercer factor si el
  director lo tiene configurado.
- Limite de 3 intentos fallidos por hora por IP.
- Mensaje generico: no revela si fallo el DPI, la contrasena o el codigo.
- No genera token ni sesion: vale solo para esa operacion.
- La bitacora guarda el valor anterior y el nuevo, y quien autorizo.

## Tolerancia a desconexion

El establecimiento tiene conectividad irregular.

- **Lectura**: la cola y el catalogo de insumos se guardan en IndexedDB. Sin
  red se siguen viendo con la marca "datos de hace N minutos".
- **Escritura**: preconsulta y dispensacion se encolan en IndexedDB si falla
  la peticion, con una `Idempotency-Key` por operacion. El reenvio no duplica
  registros: el servidor guarda la respuesta y la repite.
- **No permitido sin conexion**: cerrar la atencion medica y confirmar un
  ajuste de inventario. Ambas afectan saldos y no pueden resolverse a ciegas,
  asi que se rechazan con un mensaje claro en vez de encolarse.

## Pendientes de validacion clinica y administrativa

Estos valores estan implementados y concentrados cada uno en un solo lugar,
para que ajustarlos sea un cambio de datos y no de logica. **Requieren
confirmacion antes de usarse en produccion.**

| Que | Donde | Estado |
|---|---|---|
| Rangos de signos vitales por edad | `services/signosVitales.service.js` | Valores pediatricos de uso corriente y umbrales AIEPI. **Falta firma del personal medico** |
| Codigo institucional MSPAS | tabla `establecimiento` | `PENDIENTE-CAMOTAN`. Editable desde Administracion |
| Tipo de establecimiento | tabla `establecimiento` | Asumido `centro_salud_b` (ambulatorio) |
| Catalogo de insumos | seed | Los 7 sembrados son de ejemplo. Falta el listado real con codigos MSPAS |
| Hora de fin de jornada | `services/cola.service.js` | Asumida 16:30 |
| Intervalo de despacho | `services/paneles.service.js` | Asumido 30 dias |
| Grupos de edad del consolidado | `services/consolidado.service.js` | Cortes asumidos. Falta contrastar con el formato SIGSA vigente |
| Signos de peligro AIEPI | tabla `signo_peligro` | Los 14 del documento. Editables desde Administracion |

## Datos de referencia de la OMS

`backend/prisma/datos/` contiene los parametros LMS de los patrones de
crecimiento infantil de la OMS (2770 filas) y su procedencia documentada.
Ver `backend/prisma/datos/FUENTE.md`.

Nota importante: la OMS publica **dos** estandares de peso segun estatura
(acostado para menores de 2 anios, de pie desde los 2) y sus valores difieren
en el tramo que comparten. El sistema los carga por separado para no
clasificar mal la desnutricion.

## Notas de mantenimiento

`bd/*.sql` es la fuente de verdad del esquema: contiene los `CHECK` y los
indices parciales que `schema.prisma` no puede representar. Por eso **no use
`prisma migrate dev` a secas**: use `--create-only` y revise el SQL generado
antes de aplicarlo, porque Prisma puede proponer borrar indices que no conoce.
