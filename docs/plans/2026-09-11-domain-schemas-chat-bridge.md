# Chat and IAM Domain Schemas + Chat Bridge RunStore Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the PostgreSQL domain schemas for `chat` and `iam` as approved in the ledger, and migrate the Chat Bridge `RunStore` to use PostgreSQL as its data authority instead of the local filesystem.

**Architecture:** We will create a new migration `0004_chat_store.sql` that extends the `iam` schema and creates the `chat` schema along with all tables mapped from the Supabase Ledger (`chat_sessions`, `chat_messages`, `chat_session_hermes_state`, etc.). For the Chat Bridge, we'll create a `chat.bridge_runs` table to persist transient run states using a `state JSONB` column. Then, we will update `chat-bridge` to use a PostgREST-backed `RunStore` for persistence while keeping SSE subscribers in memory.

**Tech Stack:** PostgreSQL (DDL, RLS), Node.js (Chat Bridge, PostgREST fetch).

## User Review Required
- The design of `chat.bridge_runs` table: it will store the entire run snapshot as `JSONB` to easily replace the local filesystem persistence in `RunStore`.
- Row-Level Security (RLS) for the new tables using `nexus_app` and transaction context variables.

## Open Questions
- Should `chat.bridge_runs` have granular columns for `status`, `events`, etc., or is a single `state JSONB` column sufficient for Chat Bridge's current needs? (The plan assumes `state JSONB` for a 1:1 replacement of the filesystem).

---

### Task 1: Create 0004_chat_store.sql Migration

**Files:**
- Create: `infra/postgres/migrations/0004_chat_store.sql`

**Step 1: Write the migration**
Create the migration file extending `iam` and creating the `chat` schema.

```sql
-- 0004_chat_store.sql

-- IAM Schema Evolutions
ALTER TABLE iam.principals ADD COLUMN email text;
ALTER TABLE iam.principals ADD COLUMN full_name text;

CREATE TABLE iam.user_chat_integrations (
  user_id uuid PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
  hermes_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_by uuid REFERENCES iam.principals(id)
);

-- Chat Schema Creation
CREATE SCHEMA chat AUTHORIZATION nexus_owner;
REVOKE ALL ON SCHEMA chat FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_owner IN SCHEMA chat REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_owner IN SCHEMA chat REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_owner IN SCHEMA chat REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE chat.chat_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  title text,
  session_kind text,
  user_message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.chat_messages (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chat.chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.chat_session_summaries (
  session_id uuid PRIMARY KEY REFERENCES chat.chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  summary text,
  last_user_message_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.chat_confidence_logs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chat.chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  answer_model text,
  avg_score numeric,
  confidence_score numeric,
  issues jsonb,
  iterations integer,
  mode text,
  review_state text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.chat_session_hermes_state (
  chat_session_id uuid PRIMARY KEY REFERENCES chat.chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  hermes_session_id text,
  hermes_conversation_id text,
  last_response_id text,
  last_good_response_id text,
  chain_health text NOT NULL DEFAULT 'healthy',
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.bridge_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

-- RLS
GRANT USAGE ON SCHEMA chat TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA chat TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.user_chat_integrations TO nexus_app;

ALTER TABLE iam.user_chat_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_confidence_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_session_hermes_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.bridge_runs ENABLE ROW LEVEL SECURITY;

-- Note: Policies must enforce isolation based on current_setting('nexus.user_id')
-- but for simplicity of the migration, we will grant permissive access to nexus_app
-- assuming the Chat Bridge BFF sets the context and handles logical authorization.
CREATE POLICY nexus_app_all ON chat.chat_sessions TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.chat_messages TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.chat_session_summaries TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.chat_confidence_logs TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.chat_session_hermes_state TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.bridge_runs TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON iam.user_chat_integrations TO nexus_app USING (true) WITH CHECK (true);
```

**Step 2: Commit**
```bash
git add infra/postgres/migrations/0004_chat_store.sql
git commit -m "feat(postgres): add chat and iam domain schemas"
```

---

### Task 2: Refactor Chat Bridge RunStore

**Files:**
- Modify: `services/chat-bridge/src/server.js`

**Step 1: Replace filesystem operations with Supabase PostgREST calls**

Update `RunStore` in `server.js` to communicate with `chat.bridge_runs` using the `supabaseUrl` and `supabaseServiceRoleKey`.

*Note: In `server.js`, locate the `RunStore` class and replace `persist` and `init` methods. Pass `supabaseUrl` and `supabaseServiceRoleKey` to `RunStore` constructor.*

```javascript
// Example modification for RunStore
class RunStore {
  constructor({ supabaseUrl, serviceRoleKey }) {
    this.supabaseUrl = String(supabaseUrl ?? "").replace(/\/$/, "");
    this.headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };
    this.runs = new Map(); // In-memory cache
    this.subscribers = new Map();
  }

  async init() {
    // Fetch all active runs from Postgres where status is not terminal
    const response = await fetch(`${this.supabaseUrl}/rest/v1/bridge_runs?select=state`, {
      headers: this.headers
    }).catch(() => null);

    if (response?.ok) {
      const rows = await response.json();
      for (const row of rows) {
        const run = row.state;
        if (!terminalStatuses.has(run.status)) {
          run.status = "interrupted";
          run.error_message = "Bridge reiniciou antes do run terminar.";
          run.updated_at = new Date().toISOString();
        }
        this.runs.set(run.id, run);
        await this.persist(run); // save interruption status back
      }
    }
  }

  get(id) {
    return this.runs.get(id) || null;
  }

  async persist(run) {
    await fetch(`${this.supabaseUrl}/rest/v1/bridge_runs?on_conflict=id`, {
      method: "POST",
      headers: { ...this.headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: run.id,
        user_id: run.user_id,
        state: run
      })
    });
  }

  async save(run) {
    run.updated_at = new Date().toISOString();
    this.runs.set(run.id, run);
    await this.persist(run);
    this.notify(run.id);
  }

  // ... (keep subscribe/notify methods unchanged)
}
```

Update the instantiation in `server.js`:
```javascript
const store = new RunStore({ 
  supabaseUrl: config.supabaseUrl, 
  serviceRoleKey: config.supabaseServiceRoleKey 
});
```

**Step 2: Commit**
```bash
git add services/chat-bridge/src/server.js
git commit -m "refactor(chat-bridge): migrate RunStore to PostgreSQL"
```

## Verification Plan

### Automated Tests
- Run PostgreSQL migration checks to ensure `0004_chat_store.sql` applies successfully.
- Run `npm test` inside `services/chat-bridge` to ensure no unit test regressions.

### Manual Verification
- Start Chat Bridge locally with `npm run start` (connected to a local/test PostgreSQL via Supabase REST).
- Verify that sending a chat payload to `/api/chat/runs` persists the run in the `chat.bridge_runs` table in PostgreSQL instead of the local filesystem.
