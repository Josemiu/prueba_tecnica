# Diseño de la solución

## Mis tablas

Además de las dos tablas que daba el enunciado (`SGR_FACTURAS` y `SGR_GASCLUB_GASTOS`, que dejé tal cual), creé tres tablas propias. Ninguna tiene llaves, UNIQUE, CHECK ni triggers, como pedía la prueba. Todas las validaciones las hice en el código de los endpoints.

- **`COLABORADORES`**: guarda la cédula, el cupo mensual actual y la fecha en que se creó.
- **`CUPO_HISTORIAL`**: cada vez que se actualiza un cupo guardo la cédula, el cupo anterior, el nuevo y la fecha. Con esto queda la trazabilidad del endpoint 2.
- **`MOVIMIENTOS`**: es la cuenta corriente de cada colaborador. Aquí van las acreditaciones y los gastos. Sus columnas son:
  - `tipo`: `Acreditacion` o `Gasto`.
  - `origen`: `Facturas` o `GasClub` en los gastos (en las acreditaciones queda vacío).
  - `referencia`: el número de factura o el código de GasClub.
  - `monto`, `fecha` y `cedula`.
  - `estado`: `Pendiente` o `Aprobado`, solo para las facturas.

## Decisiones que tomé

**El saldo no se guarda, se calcula.** Pensé en tener una columna de saldo en `COLABORADORES`, pero había que actualizarla cada vez que pasaba algo y si fallaba una vez ya quedaba mal. Con una sola tabla de movimientos, el saldo es la suma de las acreditaciones menos la suma de los gastos, y siempre es correcto. Es justo lo que dice el enunciado.

**Las facturas pendientes ya descuentan del saldo.** Si no lo hiciera así, un colaborador podría registrar varias facturas pendientes y gastar más de lo que tiene mientras esperan la aprobación. Cuando se aprueban solo cambia el estado, el saldo se queda igual.

**Actualizar el cupo no toca el saldo.** Solo cambia el cupo en `COLABORADORES` y deja una fila en el historial. El saldo sube únicamente cuando se acredita.

**Cómo evito duplicados sin UNIQUE.** Como no podía usar restricciones, antes de insertar busco si el registro ya existe:
- Colaborador: por cédula.
- Factura: por cédula y número de factura.
- Consumo de GasClub: por su referencia.

**Las sincronizaciones se pueden repetir.** Cada una inserta solo lo que falta y, en el caso de las facturas, actualiza solo las que cambiaron de estado. Probé ejecutarlas dos veces seguidas y la segunda no cambia nada. Además ignoran las cédulas que no están en `COLABORADORES`.

**GasClub no valida el saldo.** Esos consumos ya ocurrieron, así que siempre se registran y el saldo puede quedar negativo. En cambio, al registrar una factura por el endpoint sí compruebo que el total no supere el saldo.

## Notas

- No usé transacciones ni manejo de concurrencia. Si dos personas registraran una factura al mismo tiempo, podrían pasar las dos validaciones de saldo. Para el alcance de la prueba lo dejé así.
- Agregué una validación que no estaba en el enunciado: no dejo registrar dos facturas con el mismo número para la misma cédula. Sin eso, la sincronización no podría saber cuál es cuál.