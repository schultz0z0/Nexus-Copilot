import pg from "pg";

const { Pool } = pg;

export function createDatabase(dbConfig) {
  const pool = new Pool(
    dbConfig.connectionString
      ? { ...dbConfig, connectionString: dbConfig.connectionString }
      : dbConfig
  );

  pool.on("error", (err) => {
    console.error("[db] Unexpected idle client error:", err);
  });

  const query = (text, params) => pool.query(text, params);

  const withClient = async (callback) => {
    const client = await pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  };

  const withTransaction = async (callback) => {
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  };

  const withUserContext = async ({ userId, tenantId }, callback) => {
    return withTransaction(async (client) => {
      if (userId) {
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(userId)]);
      }
      if (tenantId) {
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantId)]);
      }
      return callback(client);
    });
  };

  const close = () => pool.end();

  return {
    pool,
    query,
    withClient,
    withTransaction,
    withUserContext,
    close,
  };
}
