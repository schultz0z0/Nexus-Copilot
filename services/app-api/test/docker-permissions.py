"""Docker regression: restrictive root checkout must still run as node.

Run explicitly: python services/app-api/test/docker-permissions.py
Requires Docker; builds an isolated image, does not connect to any database.
"""

import io
import os
from pathlib import Path
import subprocess
import tarfile

service = Path(__file__).resolve().parents[1]
tag = f"ens-app-api-permissions-test:{os.getpid()}"


def restrictive_root(entry):
    entry.uid = entry.gid = 0
    entry.uname = entry.gname = "root"
    entry.mode = 0o700 if entry.isdir() else 0o600
    return entry


context = io.BytesIO()
with tarfile.open(fileobj=context, mode="w:gz", format=tarfile.GNU_FORMAT) as archive:
    for name in ["Dockerfile", "package.json", "src"]:
        archive.add(service / name, arcname=name, filter=restrictive_root)

smoke = """
import assert from 'node:assert/strict';
assert.equal(process.getuid(), 1000, 'runtime must remain the node user');
const {createApp} = await import('./src/server.js');
const {loadConfig} = await import('./src/config.js');
const app = await createApp({config: loadConfig({NODE_ENV: 'development'}), db: {}});
try {
  const response = await app.inject({method: 'GET', url: '/health'});
  assert.equal(response.statusCode, 200);
  console.log('PASS: root 0700/0600 checkout starts as node and health returns 200');
} finally { await app.close(); }
"""

try:
    build = subprocess.run(
        ["docker", "build", "--progress=plain", "-t", tag, "-"],
        input=context.getvalue(), capture_output=True,
    )
    if build.returncode:
        raise RuntimeError(build.stderr.decode(errors="replace")[-8000:])
    run = subprocess.run(
        ["docker", "run", "--rm", "--pull", "never", "--network", "none",
         "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
         "--entrypoint", "node", tag, "--input-type=module", "-e", smoke],
        capture_output=True,
    )
    print(run.stdout.decode(errors="replace"), end="")
    if run.returncode:
        raise RuntimeError(run.stderr.decode(errors="replace"))
finally:
    subprocess.run(["docker", "image", "rm", tag], capture_output=True)
