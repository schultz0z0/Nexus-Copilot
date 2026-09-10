# ENS Supabase ledger

Development-only, offline inventory tooling for the Supabase-to-local-services
migration. It parses the explicitly allowlisted historical SQL without executing
it and writes sanitized facts, proposed decisions and a Markdown view.

## Local commands

From the repository root:

```text
npm run test:supabase-ledger
npm run scan:supabase-ledger -- --source <historical-project-root>
npm run verify:supabase-ledger
```

The historical root is read-only input. Never point the scanner at dumps,
credentials, `.env` files, production data or the VPS.

## Docker Desktop parity

The image is pinned to Python 3.11.16 slim-bookworm by digest. Runtime services
have no network, run as UID/GID 10001, drop all capabilities and use a read-only
root filesystem.

```text
docker compose -f tools/supabase-ledger/compose.yaml build --pull
docker compose -f tools/supabase-ledger/compose.yaml run --rm test
docker compose -f tools/supabase-ledger/compose.yaml run --rm verify
```

For an intentional rescan, set `ENS_LEGACY_ROOT` in the current shell to the
historical project root and run the `scan` profile. The Compose mounts that root
at `/legacy:ro`; generated artifacts are the only writable bind mount.

This Compose is not a production service and must not be connected to the ENS
runtime, PostgreSQL, Traefik or any VPS network. Production remains human-operated.
