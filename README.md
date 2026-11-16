# Intercambio 🎄

Aplicación web para organizar un intercambio navideño familiar de hasta **100 participantes** (normalmente 30). Cada persona reclama su nombre, solicita o recibe un código por WhatsApp y gira una ruleta **una sola vez**. El servidor decide el sorteo; la ruleta solo representa el resultado.

El nombre visible de la página es **Intercambio**. La interfaz está completamente en español, es mobile-first y usa una estética navideña en rojo, verde y dorado.

---

## Índice

1. [Características](#características)
2. [Requisitos](#requisitos)
3. [Inicio rápido en local](#inicio-rápido-en-local)
4. [Variables de entorno](#variables-de-entorno)
5. [Nombres y exclusiones](#nombres-y-exclusiones)
6. [Flujo recomendado](#flujo-recomendado)
7. [Solicitud de código](#solicitud-de-código)
8. [Panel de administración](#panel-de-administración)
9. [WhatsApp](#whatsapp)
10. [Inicio, reinicio y temporada](#inicio-reinicio-y-temporada)
11. [Progreso e integridad](#progreso-e-integridad)
12. [Respaldos](#respaldos)
13. [API](#api)
14. [Pruebas automáticas](#pruebas-automáticas)
15. [Docker](#docker)
16. [Despliegue en Render o Railway](#despliegue-en-render-o-railway)
17. [Privacidad y seguridad](#privacidad-y-seguridad)
18. [Solución de problemas](#solución-de-problemas)
19. [Estructura del proyecto](#estructura-del-proyecto)

---

## Características

- Node.js 20+ y Express.
- SQLite persistente con `better-sqlite3` en `./data/app.db` (configurable con `DB_PATH`).
- Frontend HTML, CSS y JavaScript vanilla, servido por Express.
- Ruleta en `<canvas>` y confeti.
- Sorteo precalculado con algoritmo de Sattolo y `crypto.randomInt`.
- Reclamo atómico con códigos de 6 caracteres y cookies firmadas.
- Solicitudes de código visibles en verde en el panel, sin websockets ni notificaciones.
- Panel de administración ciego: no muestra asignaciones.
- Renombrar, agregar y eliminar participantes antes de iniciar.
- Teléfonos editables e importación masiva con vista previa.
- Enlaces `wa.me` manuales y adaptadores opcionales para Meta/Twilio.
- Alertas previas al inicio y confirmaciones reforzadas.
- Panel de progreso con semáforo de integridad del sorteo, sin revelar parejas.
- Reinicio del sorteo sin giros y reinicio completo de temporada con respaldo automático.
- Descarga de respaldo de la base de datos.
- Dockerfile multi-etapa, Docker Compose con volumen persistente y `GET /healthz`.
- Pruebas con el runner de Node y supertest.

---

## Requisitos

- Node.js 20 o superior.
- npm 10 o superior.
- Docker y Docker Compose, solo si quieres usar el contenedor.

---

## Inicio rápido en local

El repositorio **no incluye ningún archivo `.env`** ni contraseñas reales o de demostración.

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de configuración
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env

# 3. Editar .env:
#    - ADMIN_PASSWORD: una contraseña larga y única.
#    - SESSION_SECRET: al menos 32 caracteres aleatorios.
#    - PUBLIC_URL: la URL real desde la que entrará la familia.
#
# Puedes generar SESSION_SECRET con:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Arrancar
npm start
```

Abre:

- Participantes: <http://localhost:3000/>
- Panel: <http://localhost:3000/admin>
- Health check: <http://localhost:3000/healthz>

Para desarrollo con recarga automática:

```bash
npm run dev
```

La base se crea en `./data/app.db` y se siembra con `config/participants.json` la primera vez.

> Sin `ADMIN_PASSWORD` la aplicación no arranca. Sin `SESSION_SECRET` tampoco: el secreto se usa para firmar las cookies de participante y administrador.

---

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---:|---|
| `ADMIN_PASSWORD` | Sí | Contraseña del panel. Si falta, la app no arranca. |
| `SESSION_SECRET` | Sí | Secreto de al menos 32 caracteres para firmar cookies y sesiones. |
| `PORT` | No | Puerto HTTP. Por defecto `3000`. |
| `DB_PATH` | No | Ruta SQLite. Por defecto `./data/app.db`. |
| `PUBLIC_URL` | Sí en la práctica | URL pública exacta sin diagonal final. Se usa en los mensajes de WhatsApp y en CSRF. |
| `WHATSAPP_PROVIDER` | No | `none` (por defecto), `meta` o `twilio`. |
| `ADMIN_SHOW_RECEIVER_LIST` | No | Se mantiene en `false`. El panel no expone receptores ni parejas. |
| `TRUST_PROXY` | No | `1` detrás de Render, Railway, Nginx u otro proxy. |
| `NODE_ENV` | No | `production` en despliegue real con HTTPS; `development` en local. |

Ejemplo de producción:

```dotenv
ADMIN_PASSWORD=una-contrasena-larga-y-unica
SESSION_SECRET=una-cadena-aleatoria-de-64-caracteres
PORT=3000
DB_PATH=/var/data/app.db
PUBLIC_URL=https://intercambio-mendiola.example.com
WHATSAPP_PROVIDER=none
ADMIN_SHOW_RECEIVER_LIST=false
TRUST_PROXY=1
NODE_ENV=production
```

---

## Nombres y exclusiones

Edita `config/participants.json`:

```json
[
  "María López",
  "José Pérez",
  "Ana Torres"
]
```

- Entre 1 y 100 nombres.
- No se permiten vacíos, más de 60 caracteres, repetidos ni nombres que solo difieran por mayúsculas o acentos.
- Se siembran solo si la tabla está vacía.
- Si ya existen participantes, el archivo no se vuelve a aplicar.
- Antes de iniciar, el panel permite renombrar, agregar y eliminar participantes.
- El sorteo requiere al menos **3 participantes**.

### Exclusiones

`config/exclusions.json` contiene parejas que no deben regalarse entre sí:

```json
[
  ["María López", "José Pérez"],
  ["Ana Torres", "Luis Ramos"]
]
```

La exclusión es simétrica. Si las restricciones son imposibles, el servidor aborta tras 10,000 intentos con un error claro.

---

## Flujo recomendado

1. **Renombrar y capturar teléfonos**: el admin reemplaza “Participante 1”… por los nombres reales y agrega o elimina personas antes de iniciar.
2. **Solicitudes de código**: cada participante entra, elige su nombre y pulsa “Solicitar mi código”. El panel recibe la solicitud.
3. **Enviar por WhatsApp**: el admin abre el chat, envía el mensaje y confirma “¿Ya lo enviaste?”.
4. **Reclamar el nombre**: el participante escribe su código y confirma “¿Eres tú…? No podrás cambiarlo”.
5. **Iniciar el sorteo**: cuando la familia esté lista, el admin revisa alertas, escribe `INICIAR` y confirma.
6. **Girar**: cada persona gira una vez. El servidor ya decidió el resultado y lo guarda antes de animar la ruleta.
7. **Siguiente año**: al terminar, se puede reiniciar la temporada completa.

---

## Solicitud de código

`POST /api/request-code` **no requiere autenticación**. Es una ruta pública a propósito:

- Solo puede solicitarse para nombres no reclamados.
- Registra una solicitud para que el organizador vea la tarjeta verde.
- Nunca devuelve el teléfono ni el código.
- Es inofensiva porque el código solo se envía al teléfono que el administrador registró manualmente.
- Es idempotente: si ya hay una solicitud pendiente, responde “ya solicitado” sin duplicarla.
- Límites: 5 solicitudes por IP cada 10 minutos y 1 solicitud nueva por participante cada 5 minutos.
- Al marcar el código como enviado, se limpia `code_requested_at`.
- Liberar con código nuevo y reiniciar temporada también limpian las solicitudes.

En el panel, las solicitudes pendientes:

- aparecen arriba de la lista;
- tienen borde y fondo verde;
- muestran un foco encendido y la fecha/hora;
- incrementan el contador “Solicitudes pendientes”;
- se actualizan con el botón “Actualizar” y con polling cada 30 segundos mientras el panel está abierto.

No se usan notificaciones del navegador, sonidos, Server-Sent Events ni websockets.

---

## Panel de administración

Entra a `/admin` con `ADMIN_PASSWORD`.

### Participantes

- **Renombrar**: campo de nombre por tarjeta y “Guardar nombre”. Valida 1–60 caracteres y duplicados ignorando mayúsculas y acentos (`409`). Después de iniciar responde `403`. Renombrar a alguien ya reclamado no invalida su sesión.
- **Agregar**: botón “Agregar participante”. Nombre obligatorio y teléfono opcional. Máximo 100. Después de iniciar responde `403`.
- **Eliminar**: pide escribir el nombre exacto. Solo antes de iniciar y manteniendo al menos 3 participantes.
- Todos los acciones quedan en `admin_log` sin almacenar nombres completos ni teléfonos en la bitácora.

### Teléfonos

- Campo editable por tarjeta.
- Importación masiva pegando `Nombre, Teléfono` o `Nombre<TAB>Teléfono`.
- La vista previa muestra emparejados, no encontrados e inválidos y vence en 15 minutos.
- Nada se guarda hasta confirmar.
- Normalización:
  - `777 123 4567` → `527771234567`
  - `+52 (777) 123-4567` → `527771234567`
  - `527771234567` → se conserva.
  - `5217771234567` → se convierte en `527771234567`.
  - Otros países: 11 a 15 dígitos.
- Los teléfonos solo aparecen en rutas `/admin/*` autenticadas.

### Alertas antes de iniciar

El panel muestra pendientes de:

- participantes sin teléfono;
- nombres que siguen siendo `Participante N`;
- participantes sin código enviado;
- participantes sin reclamar;
- teléfonos repetidos.

El diálogo “Iniciar sorteo” muestra “Reclamados X/Total”, la lista de pendientes y exige escribir `INICIAR`. Si hay alertas, exige una confirmación adicional. Si faltan personas por reclamar, muestra una advertencia fuerte: no podrán girar hasta reclamar su nombre y el sorteo ya no se podrá cambiar.

Después de iniciar, se mantiene una alerta con las personas que siguen sin reclamar.

### Aviso permanente

> Una vez iniciado el sorteo no se puede agregar, quitar ni renombrar participantes.

### Admin ciego: límite real

La interfaz y las rutas JSON del panel nunca muestran asignaciones ni receptores. Sin embargo, el administrador tiene acceso a la base de datos y a funciones de recuperación: **técnicamente podría liberar un nombre, regenerar su código y reclamarlo**. Además, el respaldo descargable contiene la base SQLite completa, incluidas las asignaciones y los teléfonos. Todas las acciones quedan registradas en `admin_log`. El “panel ciego” es una garantía de producto y de interfaz, no una defensa criptográfica contra el propio administrador.

---

## WhatsApp

### Modo manual recomendado

`WHATSAPP_PROVIDER=none` es el valor por defecto y no tiene costo.

- Cada tarjeta con teléfono ofrece “Enviar por WhatsApp”.
- Se abre `https://wa.me/<telefono>?text=<mensaje>` con el mensaje codificado con `encodeURIComponent`.
- La plantilla por defecto es:

```text
Hola {nombre} 🎄 Este es tu acceso al Intercambio. Entra a {url} , elige tu nombre y escribe este código: {codigo}. Es personal, no lo compartas.
```

- Variables: `{nombre}` (siempre el nombre actual), `{url}` (`PUBLIC_URL`) y `{codigo}`.
- La plantilla debe conservar las tres variables.
- Al abrir WhatsApp se pregunta “¿Ya lo enviaste?”. Solo si confirmas se marca `code_sent_at` y se muestra “Código enviado ✔”.
- “Copiar mensaje” copia el texto sin marcar nada.
- Hay filtro “Pendientes de enviar” y “Envío en lote” con “Siguiente pendiente”, que abre un chat a la vez.

### Envío automático opcional

Requiere cuenta de WhatsApp Business verificada y una plantilla aprobada. **Puede tener costo.** El modo manual siempre está disponible.

#### Meta / WhatsApp Cloud API

```dotenv
WHATSAPP_PROVIDER=meta
WHATSAPP_META_TOKEN=...
WHATSAPP_META_PHONE_NUMBER_ID=...
WHATSAPP_META_TEMPLATE_NAME=intercambio_mendiola_acceso
WHATSAPP_META_TEMPLATE_LANG=es_MX
```

La plantilla debe tener tres parámetros de cuerpo: nombre, URL y código.

#### Twilio

```dotenv
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_CONTENT_SID=HX...
```

El adaptador usa `ContentSid` y variables `1`, `2` y `3` (nombre, URL, código).

`server/whatsapp.js` expone `sendMessage(phone, text, context)`.

---

## Inicio, reinicio y temporada

### Iniciar el sorteo

`POST /admin/start` exige:

```json
{ "confirm": "INICIAR" }
```

En una sola transacción:

1. Genera una permutación con Sattolo usando `crypto.randomInt`.
2. Aplica exclusiones.
3. Verifica integridad: cada giver/receiver una vez, sin autoasignaciones.
4. Guarda `draw_plan`.
5. Marca `draw_started=1`.

Un segundo inicio responde `409` sin regenerar nada.

### Reinicio normal (`POST /admin/reset`)

- Si `draw_started=0`: borra reclamos, `assignments` y `draw_plan`; conserva nombres, teléfonos y códigos.
- Si `draw_started=1` y **nadie ha girado**: permite volver a `draw_started=0`, borrando `draw_plan`. Requiere escribir `REINICIAR`. Se conservan los reclamos.
- Si ya hay filas en `assignments`: responde `403` con “Ya hay personas que giraron. El sorteo no se puede modificar”.

> **Si ya hay personas que giraron y necesitas empezar de cero, la app no lo permite.** La única salida es resolverlo manualmente fuera de la aplicación (respaldo, base de datos y reinstalación controlada). Esto evita romper resultados ya vistos.

El reinicio autorizado usa `maintenance_mode` dentro de la misma transacción. Un trigger impide activar ese flag desde fuera de las rutas de reinicio y otro impide poner `draw_started` en `0` sin él.

### Reiniciar temporada (`POST /admin/season-reset`)

Está en una **zona de peligro** al final del panel, con borde rojo. Borra:

- participantes, teléfonos, códigos, tokens, reclamos y solicitudes;
- `draw_plan`, `assignments`;
- valores de `settings`;
- `admin_log`.

Conserva la plantilla del mensaje y las variables de entorno. Vuelve a sembrar `config/participants.json` con códigos nuevos.

Exige:

```json
{
  "confirm": "BORRAR TODO",
  "password": "<ADMIN_PASSWORD>"
}
```

Si ya hay filas en `assignments`, además:

```json
{ "confirmActive": "YA GIRARON, BORRAR IGUAL" }
```

- Contraseña incorrecta: no borra nada y cuenta para el límite de intentos.
- Todo ocurre en una transacción. Si algo falla, se revierte.
- Antes de borrar se crea automáticamente un respaldo.
- Tras completar, se invalida la sesión de administrador y se escribe la primera fila `season-reset` en la nueva bitácora.
- Las cookies de participantes anteriores dejan de autenticar.

---

## Progreso e integridad

Con el sorteo iniciado, el panel muestra **Progreso del sorteo**:

- **Ya giraron: N de TOTAL**, con una lista numerada de nombres en orden alfabético, sin fechas ni orden de giro.
- **Faltan por girar: M**, con lista numerada. Quien todavía no reclamó aparece resaltado en amarillo con la etiqueta **“Sin reclamar”** y el aviso: “Esta persona aún no entra. Quien le toque regalarle quedará sin regalo si nunca gira”.
- **Regalos ya asignados: N de TOTAL** y **Regalos pendientes de asignar: M**.
- Aviso fijo cuando faltan giros: “Para que todos reciban regalo, todos deben girar. Quien no gire dejará a alguien sin regalo”.

### Semáforo de integridad

El recuadro **Integridad del sorteo** consulta `GET /admin/integrity` automáticamente al cargar/refrescar el panel y con el botón **“Verificar ahora”**:

- Verde: “✔ Sorteo correcto: cada persona da a una sola persona y recibe de una sola persona”.
- Rojo: “✖ Se detectó un problema”, con un motivo genérico sin nombres ni parejas.

La verificación comprueba en el backend:

1. `draw_plan` tiene exactamente un giver y un receiver por participante.
2. Nadie es su propio receiver.
3. No hay givers ni receivers repetidos.
4. El plan es un solo ciclo cerrado cuando no hay exclusiones configuradas.
5. Cada `assignment` coincide con su registro de `draw_plan`.
6. La cantidad de assignments corresponde a quienes ya giraron.

La respuesta `GET /admin/integrity` contiene únicamente `{ok, total, checks}` con booleanos; nunca nombres, ids ni parejas. Si la verificación falla, se registra `integrity-failed` en `admin_log` sin datos que permitan deducir parejas.

`GET /admin/progress` devuelve conteos, nombres de quienes ya giraron/pendientes y el estado de reclamación, sin ids ni receptores. `ADMIN_SHOW_RECEIVER_LIST=false` mantiene apagada cualquier lista de receptores.

### Verificación al iniciar y al girar

- `POST /admin/start` verifica la integridad del `draw_plan` recién insertado **antes de confirmar la transacción**. Si falla, hace rollback y no inicia.
- `POST /api/spin` comprueba, antes de insertar, que el receiver no esté ya asignado y que no sea el propio giver. Si falla, devuelve un error genérico sin revelar datos.

---

## Respaldos

- `GET /admin/backup` descarga una copia generada con `db.backup` de better-sqlite3. Solo funciona con sesión de administrador.
- Antes de cada reinicio de temporada se guarda automáticamente:
  `data/backups/app-YYYYMMDD-HHMMSS.db`
- Se conservan los últimos 5 respaldos automáticos.
- El panel ofrece “Descargar respaldo” en la zona de peligro y en el diálogo de reinicio de temporada.
- **Los respaldos contienen teléfonos y códigos de acceso.** Guárdalos en un lugar seguro.

### Restaurar un respaldo

Detén la aplicación, reemplaza el archivo SQLite por el respaldo y arranca de nuevo. Si hay archivos `app.db-wal` o `app.db-shm`, elimínalos antes de restaurar. Haz una copia del estado actual antes de tocar la base.

---

## API

### Participante

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/participants/available` | Nombres no reclamados (solo id/name). Pública. |
| POST | `/api/request-code` | Solicita código. Pública, idempotente y limitada. |
| POST | `/api/claim` | Reclama nombre con código. |
| GET | `/api/me` | Nombre, estado y resultado propio. |
| GET | `/api/wheel-names` | Nombres de la ruleta. **Requiere sesión de participante.** |
| POST | `/api/spin` | Devuelve o crea la asignación propia. |

Nunca existe un endpoint que reciba un id arbitrario y devuelva la asignación de otra persona.

### Administrador

Todas requieren sesión, excepto `/admin/login`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/admin/login` / `/admin/logout` | Sesión de admin. |
| GET | `/admin/participants` | Lista, solicitudes primero, sin receptor. |
| POST | `/admin/participants` | Agregar antes de iniciar. |
| PUT | `/admin/participants/:id/name` | Renombrar antes de iniciar. |
| DELETE | `/admin/participants/:id` | Eliminar con nombre de confirmación. |
| PUT | `/admin/participants/:id/phone` | Guardar teléfono. |
| POST | `/admin/participants/import/preview` | Vista previa de importación. |
| POST | `/admin/participants/import/confirm` | Confirmar importación. |
| POST | `/admin/participants/:id/mark-sent` | Marcar código enviado y limpiar solicitud. |
| POST | `/admin/participants/:id/release` | Liberar nombre y opcionalmente regenerar código. |
| GET/PUT | `/admin/message-template` | Plantilla de WhatsApp. |
| GET | `/admin/stats` | Contadores, incluidas `pendingRequests`. |
| GET | `/admin/progress` | Progreso de giros y pendientes, sin receptores. |
| GET | `/admin/integrity` | Semáforo de integridad del sorteo. |
| POST | `/admin/start` | Iniciar sorteo. |
| POST | `/admin/reset` | Reinicio normal. |
| POST | `/admin/season-reset` | Reinicio completo de temporada. |
| GET | `/admin/backup` | Descarga de respaldo SQLite. |
| GET | `/admin/log` | Últimas 100 acciones. |
| POST | `/admin/participants/:id/send-auto` | Envío automático opcional. |

---

## Pruebas automáticas

```bash
npm test
```

La suite usa `node:test` y supertest y suma **32 pruebas automatizadas**: los 25 escenarios base, la firma de cookies y los 6 escenarios nuevos de progreso e integridad.

- sorteo de tamaños 3, 7, 12, 30, 31 y 100;
- giros idempotentes y paralelos;
- reclamos simultáneos, bloqueo y recuperación;
- `wheel-names` sin sesión;
- triggers de congelamiento y `maintenance_mode`;
- renombrar, agregar y eliminar;
- solicitudes de código, orden, idempotencia y límites;
- teléfonos, importación y `wa.me`;
- privacidad, CSRF y sesiones admin;
- reinicio normal y reinicio de temporada;
- respaldo válido y rollback ante error;
- ciclo completo después de reiniciar temporada;
- integridad correcta para 3, 7, 12, 30 y 100 participantes;
- detección de un `draw_plan` corrupto y bitácora `integrity-failed`;
- privacidad de `/admin/integrity` y `/admin/progress`;
- listas de progreso, pendientes y etiquetas “Sin reclamar”.

---

## Docker

Incluye `Dockerfile` multi-etapa, `docker-compose.yml`, `.dockerignore` y `GET /healthz`.

### 1. Crear `.env`

El repositorio no trae `.env`. Docker Compose lo usa para interpolar variables:

```bash
cp .env.example .env
```

Define como mínimo:

```dotenv
ADMIN_PASSWORD=una-contrasena-segura
SESSION_SECRET=una-cadena-aleatoria-de-al-menos-32-caracteres
PUBLIC_URL=http://localhost:3000
WHATSAPP_PROVIDER=none
ADMIN_SHOW_RECEIVER_LIST=false
```

### 2. Arrancar

```bash
docker compose up --build -d
docker compose logs -f app
```

Abre <http://localhost:3000>. El contenedor de desarrollo usa `NODE_ENV=development` para permitir cookies por HTTP local. En producción usa HTTPS y `NODE_ENV=production`.

### 3. Datos persistentes

El volumen `mendiola_data` conserva `data/app.db` y `data/backups`.

```bash
docker compose down          # conserva datos
docker compose down -v       # BORRA la base y los respaldos
```

### 4. Pruebas en Docker

```bash
docker compose --profile test run --rm --build tests
```

`--build` garantiza que la imagen de pruebas use el código actual.

### 5. Imagen de producción directamente

```bash
docker build -t intercambio-mendiola .
docker run --rm -p 3000:3000 \
  -e ADMIN_PASSWORD="una-contrasena-segura" \
  -e SESSION_SECRET="una-cadena-aleatoria-de-64-caracteres" \
  -e PUBLIC_URL="https://tu-dominio.example" \
  -e NODE_ENV=production \
  -e TRUST_PROXY=1 \
  -e DB_PATH=/app/data/app.db \
  -v mendiola_data:/app/data \
  intercambio-mendiola
```

Health check: `GET /healthz`.

---

## Despliegue en Render o Railway

### Advertencia sobre SQLite

SQLite necesita **disco persistente**. Si el hosting usa filesystem efímero, la base y los respaldos se pierden al reiniciar o redeployar. Configura un disco/volumen y apunta `DB_PATH` dentro de él.

Ejecuta **una sola instancia**. SQLite no está diseñado para varias réplicas escribiendo el mismo archivo.

### Render

1. Sube el repositorio a GitHub sin `data/` ni `.env`.
2. Crea un Web Service de Node:
   - Build: `npm ci`
   - Start: `npm start`
   - Health Check Path: `/healthz`
3. Agrega un Persistent Disk, por ejemplo en `/var/data`.
4. Variables:
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `PUBLIC_URL=https://tu-servicio.onrender.com`
   - `DB_PATH=/var/data/app.db`
   - `NODE_ENV=production`
   - `TRUST_PROXY=1`
   - `WHATSAPP_PROVIDER=none`
5. Si usas Docker, monta el disco en `/app/data`.

### Railway

1. Crea el proyecto desde el repositorio.
2. Agrega un Volume montado en `/app/data`.
3. Variables:
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `PUBLIC_URL=https://tu-dominio.up.railway.app`
   - `DB_PATH=/app/data/app.db`
   - `NODE_ENV=production`
   - `TRUST_PROXY=1`
   - `WHATSAPP_PROVIDER=none`
4. Comprueba `/healthz`.

Si cambias el dominio, actualiza `PUBLIC_URL`; de lo contrario los mensajes apuntarán mal.

---

## Privacidad y seguridad

- `.gitignore` excluye `data/`, `.env` y `node_modules/`.
- Los teléfonos no están en el repositorio: se capturan desde el panel.
- Los teléfonos son datos personales; no los subas a GitHub ni los compartas.
- `data/backups` también contiene datos personales.
- Códigos de acceso: 6 caracteres sin ambiguos, comparación con `crypto.timingSafeEqual`.
- Token de participante: 32 bytes aleatorios; en la BD solo se guarda su hash SHA-256.
- Cookies de participante firmadas con `SESSION_SECRET`; `HttpOnly`, `SameSite=Lax`, `Secure` y prefijo `__Host-` en producción; 180 días.
- Cookie de admin separada: `HttpOnly`, `Secure`, `SameSite=Strict`, 2 horas absolutas y 30 minutos de inactividad.
- Regeneración del ID de sesión al login y destrucción al logout.
- `season-reset` invalida todas las sesiones de admin y las cookies antiguas de participantes.
- CSRF en POST/PUT/DELETE validando `Origin` contra `PUBLIC_URL` y el host.
- Login limitado a 5 fallos por IP con bloqueo de 10 minutos.
- Los fallos de contraseña en `season-reset` también cuentan para ese límite.
- Rate limiting en `/api/claim`, `/api/spin` y `/api/request-code`.
- Helmet con CSP y panel con `noindex`.
- Consultas SQL parametrizadas.
- `/admin/integrity` y `/admin/progress` no devuelven ids ni nombres de receptores; con `ADMIN_SHOW_RECEIVER_LIST=false` tampoco `/admin/participants`.
- Logs sin tokens, códigos, teléfonos ni resultados. Una falla de integridad registra solo `integrity-failed`.
- Triggers SQLite para el congelamiento y el candado de `maintenance_mode`.

---

## Solución de problemas

### La app no arranca: falta ADMIN_PASSWORD o SESSION_SECRET

Crea `.env` desde `.env.example` y define ambos. No hay contraseña incluida en el repositorio.

### Las cookies no se guardan en el celular

En producción se usan cookies `Secure` y `__Host-`, que requieren HTTPS. Para probar por HTTP local usa `NODE_ENV=development`. En Docker Compose, el valor por defecto ya es `development`.

### Los enlaces de WhatsApp apuntan a localhost

Configura `PUBLIC_URL` con la URL real. En una red local, usa la IP de la computadora, por ejemplo `PUBLIC_URL=http://192.168.1.50:3000`.

### La base se perdió al reiniciar

El hosting no tiene disco persistente o `DB_PATH` no apunta al disco. Revisa Render/Railway y monta un volumen.

### `SQLITE_BUSY`

Usa una sola instancia de la app y no compartas el mismo archivo entre múltiples procesos. El proyecto configura `busy_timeout`, pero SQLite no escala para múltiples escritores.

### “Ya hay personas que giraron. El sorteo no se puede modificar”

Es intencional. No se puede reiniciar el sorteo ni modificar asignaciones después de un giro. La única salida es una restauración manual fuera de la aplicación.

### No encuentro cómo pedir mi código

En la pantalla de elección de nombre:

1. selecciona tu nombre;
2. pulsa “Solicitar mi código”;
3. espera el WhatsApp del organizador;
4. vuelve, pulsa “Ya tengo mi código” y escribe los 6 caracteres.

Si ya habías solicitado, el servidor responde “ya solicitado” sin duplicar.

### El panel muestra tarjetas verdes

Son solicitudes de código pendientes. Se ordenan arriba y se limpian al marcar el código como enviado, al liberar con un código nuevo o al reiniciar la temporada.

---

## Estructura del proyecto

```text
.
├── config/
│   ├── participants.json
│   └── exclusions.json
├── data/                     # SQLite y backups (ignorado por Git)
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── css/styles.css
│   └── js/
│       ├── app.js
│       ├── admin.js
│       ├── wheel.js
│       └── confetti.js
├── server/
│   ├── index.js
│   ├── app.js
│   ├── db.js
│   ├── draw.js
│   ├── auth.js
│   ├── phone.js
│   ├── whatsapp.js
│   ├── integrity.js
│   └── routes/
│       ├── participant.js
│       └── admin.js
├── tests/
│   ├── helpers.js
│   ├── core.test.js
│   ├── integration.test.js
│   └── progress-integrity.test.js
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

---

Hecho con cariño para el Intercambio. 🎁
