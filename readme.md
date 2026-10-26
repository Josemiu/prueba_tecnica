# Prueba técnica: Cupo vehicular de colaboradores

Es un servicio que lleva el saldo de cada colaborador a partir de dos fuentes de gasto (facturas y GasClub). Lo construí con una lambda que corre en local usando Serverless Framework, Node.js y PostgreSQL.

Las decisiones de diseño están explicadas en [diseno.md](diseno.md).

## Tecnologías

- Node.js 22
- PostgreSQL 18
- Serverless Framework v4 con `serverless-offline`
- `pg` (cliente de PostgreSQL para Node)

Serverless v4 pide una cuenta gratuita. La primera vez hay que ejecutar `npx serverless login` e iniciar sesión en el navegador. No hace falta crear ninguna app ni organización para correrlo en local.

## Estructura del proyecto

```
.
├── serverless.yml
├── handler.js
├── connection.js
├── sql/
│   ├── tables_from_doc.sql
│   └── tables.sql
├── .env.example
├── diseno.md
└── readme.md
```

- `handler.js`: el código de los 6 endpoints.
- `connection.js`: la conexión a PostgreSQL.
- `sql/tables_from_doc.sql`: las tablas del enunciado con sus datos de ejemplo.
- `sql/tables.sql`: las tablas que diseñé yo.
- `diseno.md`: explicación del modelo de datos y mis decisiones.

## Cómo ejecutarlo

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear la base de datos

```bash
psql -U postgres -c "CREATE DATABASE cupo_vehicular;"
```

### 3. Crear las tablas

Primero las tablas del enunciado (`SGR_FACTURAS` y `SGR_GASCLUB_GASTOS`) con sus datos de ejemplo, y después las mías (`COLABORADORES`, `CUPO_HISTORIAL` y `MOVIMIENTOS`):

```bash
psql -U postgres -d cupo_vehicular -f sql/tables_from_doc.sql
psql -U postgres -d cupo_vehicular -f sql/tables.sql
```

Si tu PostgreSQL no usa el puerto 5432, agrega `-p <puerto>` a estos comandos.

Para comprobar que los datos de ejemplo se cargaron, cada tabla del enunciado debe tener 10 filas:

```bash
psql -U postgres -d cupo_vehicular -c "SELECT COUNT(*) FROM SGR_FACTURAS;"
psql -U postgres -d cupo_vehicular -c "SELECT COUNT(*) FROM SGR_GASCLUB_GASTOS;"
```

### 4. Configurar las variables de entorno

Copia `.env.example` a `.env` y completa tus datos:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cupo_vehicular
DB_USER=postgres
DB_PASSWORD=tu_contrasenia
```

Las cinco variables son obligatorias: si falta alguna, Serverless no arranca.

### 5. Levantar la lambda en local

```bash
npx serverless offline
```

Queda disponible en `http://localhost:3000/dev`. Ojo que `serverless-offline` agrega el `/dev` en la URL.

## Endpoints

Son 6 en total. Todos devuelven JSON y, si algo está mal (falta un dato, el colaborador no existe, etc.), responden con un error 400 o 404 y un mensaje.

**1. Crear colaborador** (`POST /colaboradores`)

Recibe la cédula y el cupo mensual. Antes de guardarlo reviso que esa cédula no esté ya registrada.

Body: `{"cedula", "cupo_mensual"}`

**2. Actualizar cupo** (`PUT /colaboradores/{cedula}/cupo`)

Cambia el cupo mensual del colaborador. Guardo el cupo anterior y el nuevo en una tabla de historial para tener registro del cambio. El saldo no se toca, solo cambia cuando se acredita.

Body: `{"cupo_mensual"}`

**3. Acreditar cupo** (`POST /colaboradores/{cedula}/acreditar`)

No necesita body. Toma el cupo mensual que tiene el colaborador en ese momento y lo suma al saldo, como una recarga.

**4. Registrar factura** (`POST /facturas`)

Revisa que el colaborador exista y que el total no sea mayor a su saldo. Si todo está bien, guarda la factura como `Pendiente` en `SGR_FACTURAS` y en mis tablas.

Body: `{"cedula", "numero_factura", "ruc_proveedor", "total"}`

**5. Sincronizar facturas** (`POST /sync/facturas`)

No necesita body. Lee `SGR_FACTURAS` y la compara con mis tablas: las facturas que no tengo las agrego, y si alguna cambió de estado (por ejemplo de `Pendiente` a `Aprobado`) la actualizo.

**6. Sincronizar GasClub** (`POST /sync/gasclub`)

No necesita body. Lee `SGR_GASCLUB_GASTOS` y agrega los consumos que todavía no tengo. Aquí no valido el saldo, porque esos gastos ya ocurrieron, así que puede quedar en negativo.

Las dos sincronizaciones solo toman en cuenta a los colaboradores que ya están registrados. Además se pueden ejecutar varias veces seguidas sin que se repitan datos, porque antes de insertar reviso si el registro ya existe.

## Cómo probarlo

Los ejemplos de `curl` están con la sintaxis de `cmd` en Windows. En Linux o Mac hay que usar comillas simples para el JSON.
 
Algunos pasos necesitan ejecutar SQL sobre la base de datos. Ese SQL no se pega directo en la terminal, porque no es un comando de Windows. Hay dos formas de ejecutarlo:
 
- **Opción A: una sola línea con `-c`**, desde la terminal normal:
```bash
  psql -U postgres -d cupo_vehicular -c "SELECT * FROM MOVIMIENTOS;"
```
 
- **Opción B: entrar a `psql` y pegar la consulta ahí**:
```bash
  psql -U postgres -d cupo_vehicular
```
 
  Dentro de `psql` se escribe la consulta terminada en `;` y se sale con `\q`.
 
En cada paso de abajo muestro las dos opciones.
 
**1. Crear colaborador, actualizar cupo y acreditar**
 
```bash
curl -X POST http://localhost:3000/dev/colaboradores -H "Content-Type: application/json" -d "{\"cedula\":\"0912345678\",\"cupo_mensual\":200}"
 
curl -X PUT http://localhost:3000/dev/colaboradores/0912345678/cupo -H "Content-Type: application/json" -d "{\"cupo_mensual\":300}"
 
curl -X POST http://localhost:3000/dev/colaboradores/0912345678/acreditar
```
 
La última respuesta debe mostrar `"saldo":300`.
 
**2. Sincronizar GasClub**
 
```bash
curl -X POST http://localhost:3000/dev/sync/gasclub
```
 
Con los datos de ejemplo debe insertar 2 consumos de la cédula `0912345678`. Los de cédulas que no están registradas se ignoran.
 
También se pueden insertar consumos a mano en `SGR_GASCLUB_GASTOS` y volver a sincronizar.
 
Opción A:
 
```bash
psql -U postgres -d cupo_vehicular -c "INSERT INTO SGR_GASCLUB_GASTOS (ID, CEDULA, REFERENCIA, TOTAL, FECHA) VALUES (11, '0912345678', 'GC-009999', 10.00, '2026-10-24');"
```
 
Opción B (dentro de `psql`):
 
```sql
INSERT INTO SGR_GASCLUB_GASTOS (ID, CEDULA, REFERENCIA, TOTAL, FECHA)
VALUES (11, '0912345678', 'GC-009999', 10.00, '2026-10-24');
```
 
Después se vuelve a ejecutar `sync/gasclub`, que debe insertar 1.
 
**3. Registrar una factura, aprobarla y sincronizar**
 
```bash
curl -X POST http://localhost:3000/dev/facturas -H "Content-Type: application/json" -d "{\"cedula\":\"0912345678\",\"numero_factura\":\"001-001-000001000\",\"ruc_proveedor\":\"1790012345001\",\"total\":10}"
```
 
Queda en estado `Pendiente`. Para simular la aprobación del asistente contable:
 
Opción A:
 
```bash
psql -U postgres -d cupo_vehicular -c "UPDATE SGR_FACTURAS SET ESTADO = 'Aprobado' WHERE NUMERO_FACTURA = '001-001-000001000';"
```
 
Opción B (dentro de `psql`):
 
```sql
UPDATE SGR_FACTURAS SET ESTADO = 'Aprobado' WHERE NUMERO_FACTURA = '001-001-000001000';
```
 
Y después se sincroniza:
 
```bash
curl -X POST http://localhost:3000/dev/sync/facturas
```
 
La respuesta debe indicar `"actualizadas":1` (más las facturas del ejemplo que se inserten la primera vez).
 
**4. Verificar en la base de datos**
 
Opción A:
 
```bash
psql -U postgres -d cupo_vehicular -c "SELECT * FROM MOVIMIENTOS ORDER BY ID;"
psql -U postgres -d cupo_vehicular -c "SELECT * FROM CUPO_HISTORIAL;"
```
 
Opción B (dentro de `psql`):
 
```sql
SELECT * FROM MOVIMIENTOS ORDER BY ID;
SELECT * FROM CUPO_HISTORIAL;
```
 
**5. Probar que no se duplica nada**
 
Si se ejecutan `sync/gasclub` y `sync/facturas` otra vez sin cambios, ambos devuelven `0`.
 
**6. Probar la validación de saldo**
 
Una factura con un total mayor al saldo disponible responde con error 400:
 
```bash
curl -X POST http://localhost:3000/dev/facturas -H "Content-Type: application/json" -d "{\"cedula\":\"0912345678\",\"numero_factura\":\"001-001-000009999\",\"ruc_proveedor\":\"1790012345001\",\"total\":5000}"
```
## Notas

- El saldo no se guarda en ninguna tabla: se calcula como la suma de acreditaciones menos la suma de gastos en `MOVIMIENTOS`.
- Las facturas `Pendiente` ya descuentan del saldo, así se evita gastar el mismo dinero dos veces mientras se aprueban.
- Agregué una validación que no pedía el enunciado: no permite registrar dos facturas con el mismo número para la misma cédula. Sin ella, la sincronización no podría distinguir una factura de otra.
- No manejé transacciones ni concurrencia para mantener la solución simple.
