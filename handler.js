const connection = require('./connection');

const respuesta = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const leerBody = (event) => {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
};


const endpoint = (fn) => async (event) => {
  try {
    return await fn(event);
  } catch (err) {
    console.error(err);
    return respuesta(500, { error: 'Error interno', detalle: err.message });
  }
};

const esMonto = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

const buscarColaborador = async (cedula) => {
  const r = await connection.query('SELECT * FROM COLABORADORES WHERE CEDULA = $1', [cedula]);
  return r.rows[0];
};

// Saldo = suma de acreditaciones - suma de gastos
const obtenerSaldo = async (cedula) => {
  const r = await connection.query(
    `SELECT COALESCE(SUM(CASE WHEN TIPO = 'Acreditacion' THEN MONTO ELSE -MONTO END), 0) AS saldo
     FROM MOVIMIENTOS WHERE CEDULA = $1`,
    [cedula]
  );
  return Number(r.rows[0].saldo);
};

// Crea el colaborador

module.exports.crearColaborador = endpoint(async (event) => {
  const { cedula, cupo_mensual } = leerBody(event);

  if (!cedula || !esMonto(cupo_mensual)) {
    return respuesta(400, { error: 'Se requiere cedula y cupo_mensual (número mayor a 0)' });
  }
  if (await buscarColaborador(cedula)) {
    return respuesta(400, { error: 'El colaborador ya existe' });
  }

  await connection.query(
    'INSERT INTO COLABORADORES (CEDULA, CUPO_MENSUAL, FECHA_CREACION) VALUES ($1, $2, NOW())',
    [cedula, cupo_mensual]
  );
  return respuesta(201, { cedula, cupo_mensual });
});

// Actuliza el cupo pero sin modificar el saldo

module.exports.actualizarCupo = endpoint(async (event) => {
  const { cedula } = event.pathParameters;
  const { cupo_mensual } = leerBody(event);

  if (!esMonto(cupo_mensual)) {
    return respuesta(400, { error: 'Se requiere cupo_mensual (número mayor a 0)' });
  }
  const colaborador = await buscarColaborador(cedula);
  if (!colaborador) {
    return respuesta(404, { error: 'El colaborador no existe' });
  }

  await connection.query(
    `INSERT INTO CUPO_HISTORIAL (CEDULA, CUPO_ANTERIOR, CUPO_NUEVO, FECHA)
     VALUES ($1, $2, $3, NOW())`,
    [cedula, colaborador.cupo_mensual, cupo_mensual]
  );
  await connection.query('UPDATE COLABORADORES SET CUPO_MENSUAL = $1 WHERE CEDULA = $2', [
    cupo_mensual,
    cedula,
  ]);
  return respuesta(200, {
    cedula,
    cupo_anterior: Number(colaborador.cupo_mensual),
    cupo_nuevo: cupo_mensual,
  });
});

// Acredita el cupo 

module.exports.acreditarCupo = endpoint(async (event) => {
  const { cedula } = event.pathParameters;

  const colaborador = await buscarColaborador(cedula);
  if (!colaborador) {
    return respuesta(404, { error: 'El colaborador no existe' });
  }

  await connection.query(
    `INSERT INTO MOVIMIENTOS (CEDULA, TIPO, ORIGEN, REFERENCIA, MONTO, ESTADO, FECHA)
     VALUES ($1, 'Acreditacion', NULL, NULL, $2, NULL, NOW())`,
    [cedula, colaborador.cupo_mensual]
  );
  return respuesta(200, {
    cedula,
    acreditado: Number(colaborador.cupo_mensual),
    saldo: await obtenerSaldo(cedula),
  });
});

// Registrar la factura 

module.exports.registrarFactura = endpoint(async (event) => {
  const { cedula, numero_factura, ruc_proveedor, total } = leerBody(event);

  if (!cedula || !numero_factura || !ruc_proveedor || !esMonto(total)) {
    return respuesta(400, {
      error: 'Se requiere cedula, numero_factura, ruc_proveedor y total (mayor a 0)',
    });
  }
  if (!(await buscarColaborador(cedula))) {
    return respuesta(404, { error: 'El colaborador no existe' });
  }

  const duplicada = await connection.query(
    'SELECT 1 FROM SGR_FACTURAS WHERE CEDULA = $1 AND NUMERO_FACTURA = $2',
    [cedula, numero_factura]
  );
  if (duplicada.rows.length > 0) {
    return respuesta(400, { error: 'La factura ya está registrada' });
  }

  const saldo = await obtenerSaldo(cedula);
  if (total > saldo) {
    return respuesta(400, { error: 'El total supera el saldo disponible', saldo });
  }

  const sig = await connection.query('SELECT COALESCE(MAX(ID), 0) + 1 AS id FROM SGR_FACTURAS');
  await connection.query(
    `INSERT INTO SGR_FACTURAS (ID, CEDULA, NUMERO_FACTURA, RUC_PROVEEDOR, TOTAL, FECHA, ESTADO)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'Pendiente')`,
    [sig.rows[0].id, cedula, numero_factura, ruc_proveedor, total]
  );
  await connection.query(
    `INSERT INTO MOVIMIENTOS (CEDULA, TIPO, ORIGEN, REFERENCIA, MONTO, ESTADO, FECHA)
     VALUES ($1, 'Gasto', 'Facturas', $2, $3, 'Pendiente', NOW())`,
    [cedula, numero_factura, total]
  );
  return respuesta(201, {
    cedula,
    numero_factura,
    total,
    estado: 'Pendiente',
    saldo: await obtenerSaldo(cedula),
  });
});

// Sincronizar las facturas 

module.exports.sincronizarFacturas = endpoint(async () => {
  // Inserta las facturas que aún no están en MOVIMIENTOS
  const nuevas = await connection.query(
    `INSERT INTO MOVIMIENTOS (CEDULA, TIPO, ORIGEN, REFERENCIA, MONTO, ESTADO, FECHA)
     SELECT f.CEDULA, 'Gasto', 'Facturas', f.NUMERO_FACTURA, f.TOTAL, f.ESTADO, f.FECHA
     FROM SGR_FACTURAS f
     WHERE f.CEDULA IN (SELECT CEDULA FROM COLABORADORES)
       AND NOT EXISTS (
         SELECT 1 FROM MOVIMIENTOS m
         WHERE m.ORIGEN = 'Facturas'
           AND m.CEDULA = f.CEDULA
           AND m.REFERENCIA = f.NUMERO_FACTURA
       )`
  );

  // Actualiza el estado de las que cambiaron
  const actualizadas = await connection.query(
    `UPDATE MOVIMIENTOS m
     SET ESTADO = f.ESTADO
     FROM SGR_FACTURAS f
     WHERE m.ORIGEN = 'Facturas'
       AND m.CEDULA = f.CEDULA
       AND m.REFERENCIA = f.NUMERO_FACTURA
       AND m.ESTADO IS DISTINCT FROM f.ESTADO
       AND f.CEDULA IN (SELECT CEDULA FROM COLABORADORES)`
  );

  return respuesta(200, { insertadas: nuevas.rowCount, actualizadas: actualizadas.rowCount });
});

// Sincronizar GasClub

module.exports.sincronizarGasClub = endpoint(async () => {
  const nuevos = await connection.query(
    `INSERT INTO MOVIMIENTOS (CEDULA, TIPO, ORIGEN, REFERENCIA, MONTO, ESTADO, FECHA)
     SELECT g.CEDULA, 'Gasto', 'GasClub', g.REFERENCIA, g.TOTAL, NULL, g.FECHA
     FROM SGR_GASCLUB_GASTOS g
     WHERE g.CEDULA IN (SELECT CEDULA FROM COLABORADORES)
       AND NOT EXISTS (
         SELECT 1 FROM MOVIMIENTOS m
         WHERE m.ORIGEN = 'GasClub'
           AND m.REFERENCIA = g.REFERENCIA
       )`
  );

  return respuesta(200, { insertados: nuevos.rowCount });
});