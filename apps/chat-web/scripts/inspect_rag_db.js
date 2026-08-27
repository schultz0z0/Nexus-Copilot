import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const run = async () => {
  const password = process.env.SUPABASE_DB_PASSWORD;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

  if (!password || !projectRef) {
    console.error('Missing SUPABASE_DB_PASSWORD or SUPABASE_PROJECT_REF in .env');
    process.exit(1);
  }

  const tryConnect = async (config, name) => {
    const client = new Client(config);
    try {
      await client.connect();
      console.log(`✅ Connected to Supabase DB (${name})`);
      return client;
    } catch (e) {
      console.warn(`❌ Failed to connect via ${name}: ${e.message}`);
      await client.end().catch(() => {});
      return null;
    }
  };

  let client = null;

  if (dbUrl) {
    client = await tryConnect(
      {
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
      },
      'Env URL',
    );
  }

  const poolerHosts = [
    'aws-0-sa-east-1.pooler.supabase.com',
    'aws-0-us-east-1.pooler.supabase.com',
    'aws-0-us-west-1.pooler.supabase.com',
    'aws-0-eu-central-1.pooler.supabase.com',
  ];

  if (!client) {
    for (const host of poolerHosts) {
      client = await tryConnect(
        {
          host,
          port: 6543,
          database: 'postgres',
          user: `postgres.${projectRef}`,
          password,
          ssl: { rejectUnauthorized: false },
        },
        `Supavisor (${host})`,
      );
      if (client) break;
    }
  }

  if (!client) {
    console.error('🔥 All connection strategies failed.');
    process.exit(1);
  }

  try {
    const dbInfo = await client.query('select current_database() as db, current_user as usr, version() as version;');
    console.table(dbInfo.rows);

    // 1. Check Table Structure
    console.log('\n--- Table Structure ---');
    const structureQuery = `
      SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name = 'chatbot_rag_documents';
    `;
    const structureRes = await client.query(structureQuery);
    if (structureRes.rows.length === 0) {
      console.error('❌ Table "chatbot_rag_documents" DOES NOT EXIST!');
    } else {
      console.table(structureRes.rows);
    }

    console.log('\n--- Embedding Column Type (pg_catalog) ---');
    const embeddingTypeRes = await client.query(`
      SELECT
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'chatbot_rag_documents'
        AND a.attname = 'embedding'
        AND a.attnum > 0
        AND NOT a.attisdropped;
    `);
    if (embeddingTypeRes.rows.length) console.table(embeddingTypeRes.rows);
    else console.warn('⚠️ Column "embedding" not found in pg_catalog');

    console.log('\n--- match_chatbot_rag Signatures (pg_proc) ---');
    const fnRes = await client.query(`
      SELECT
        p.oid,
        p.proname,
        pg_get_function_identity_arguments(p.oid) AS identity_args,
        pg_get_function_result(p.oid) AS result_type,
        p.proargnames AS arg_names
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'match_chatbot_rag'
      ORDER BY identity_args;
    `);
    if (!fnRes.rows.length) {
      console.warn('❌ Function public.match_chatbot_rag NOT found');
    } else {
      console.table(
        fnRes.rows.map((r) => ({
          identity_args: r.identity_args,
          result_type: r.result_type,
          arg_names: (r.arg_names || []).join(','),
        })),
      );
    }

    // 2. Data Count
    console.log('\n--- Data Count ---');
    try {
        const countRes = await client.query('SELECT count(*) FROM chatbot_rag_documents;');
        console.log(`Total Rows: ${countRes.rows[0].count}`);
    } catch (e) {
        console.error('Could not count rows (table missing?)');
    }

    // 3. Sample Data
    console.log('\n--- Sample Data (First 1 Row) ---');
    try {
        const sampleRes = await client.query('SELECT id, substring(content, 1, 50) as content_preview, metadata FROM chatbot_rag_documents LIMIT 1;');
        if (sampleRes.rows.length > 0) {
            console.log(JSON.stringify(sampleRes.rows[0], null, 2));
        } else {
            console.log('Table is empty.');
        }
    } catch (e) {
        console.error('Could not fetch sample.');
    }

    console.log('\n--- Embedding Dimension Sanity Check (First 3 Rows With Embedding) ---');
    const embeddingInfo = structureRes.rows.find((r) => r.column_name === 'embedding');
    const dataType = embeddingInfo?.data_type;
    const udtName = embeddingInfo?.udt_name;

    const runDimsQuery = async (sql) => {
      const r = await client.query(sql);
      if (!r.rows.length) {
        console.log('No rows with embedding.');
        return;
      }
      console.table(r.rows);
    };

    if (udtName === 'vector') {
      await runDimsQuery(`
        SELECT
          id,
          vector_dims(embedding) AS embedding_dims,
          length(embedding::text) AS embedding_text_len
        FROM chatbot_rag_documents
        WHERE embedding IS NOT NULL
        LIMIT 3;
      `);

      const dimsDist = await client.query(`
        SELECT vector_dims(embedding) AS dims, count(*)::int AS rows
        FROM chatbot_rag_documents
        WHERE embedding IS NOT NULL
        GROUP BY 1
        ORDER BY 1;
      `);
      console.table(dimsDist.rows);
    } else if (dataType === 'jsonb') {
      await runDimsQuery(`
        SELECT
          id,
          jsonb_typeof(embedding) AS embedding_kind,
          CASE
            WHEN jsonb_typeof(embedding) = 'array' THEN jsonb_array_length(embedding)
            ELSE NULL
          END AS embedding_dims
        FROM chatbot_rag_documents
        WHERE embedding IS NOT NULL
        LIMIT 3;
      `);
    } else if (dataType === 'text' || dataType === 'character varying') {
      await runDimsQuery(`
        SELECT
          id,
          length(embedding) AS embedding_text_len,
          array_length(
            regexp_split_to_array(
              replace(replace(replace(trim(embedding), '[', ''), ']', ''), ' ', ''),
              ','
            ),
            1
          ) AS embedding_dims_guess
        FROM chatbot_rag_documents
        WHERE embedding IS NOT NULL
        LIMIT 3;
      `);
    } else {
      console.warn(`⚠️ Unsupported embedding column type for dimension check: data_type=${dataType} udt_name=${udtName}`);
    }

  } catch (err) {
    console.error('❌ Connection/Query Error:', err.message);
  } finally {
    await client.end();
  }
};

run();
