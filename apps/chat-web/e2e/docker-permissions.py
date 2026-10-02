"""Regression: the actual Nginx runtime stage must accept a root 0600 config.

Run: python apps/chat-web/e2e/docker-permissions.py
Requires Docker. Uses a static fixture instead of rebuilding the React app;
tests runtime permissions and HTTP serving, not frontend behavior or API proxy.
"""

import io
import os
from pathlib import Path
import subprocess
import tarfile

app = Path(__file__).resolve().parents[1]
tag = f"ens-chat-web-permissions-test:{os.getpid()}"
dockerfile = (app / "Dockerfile").read_text(encoding="utf-8")
runtime_marker = "FROM nginx:1.27-alpine"
assert dockerfile.count(runtime_marker) == 1, "Review test for changed runtime base"
runtime = runtime_marker + dockerfile.split(runtime_marker, 1)[1]
fixture_build = """FROM node:20-alpine AS build
RUN mkdir -p /app/dist && printf 'permission-smoke' > /app/dist/index.html \\
    && chmod 0700 /app/dist && chmod 0600 /app/dist/index.html
"""

context = io.BytesIO()
with tarfile.open(fileobj=context, mode="w:gz", format=tarfile.GNU_FORMAT) as archive:
    for name, data in [
        ("Dockerfile", (fixture_build + runtime).encode()),
        ("nginx.conf", (app / "nginx.conf").read_bytes()),
    ]:
        entry = tarfile.TarInfo(name)
        entry.uid = entry.gid = 0
        entry.uname = entry.gname = "root"
        entry.mode = 0o600
        entry.size = len(data)
        archive.addfile(entry, io.BytesIO(data))

smoke = """
set -eu
test "$(id -u)" = 1001
test "$(stat -c '%u' /etc/nginx/nginx.conf)" = 0
nginx -t
nginx -g 'daemon off;' &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT
attempt=0
while [ "$attempt" -lt 20 ]; do
  if body=$(wget -q -T 1 -O - http://127.0.0.1:8080/); then
    test "$body" = permission-smoke
    printf 'PASS: root 0600 config, UID 1001, Nginx config valid and HTTP fixture served\n'
    exit 0
  fi
  kill -0 "$server_pid"
  attempt=$((attempt + 1))
  sleep 0.2
done
exit 1
"""

try:
    build = subprocess.run(
        ["docker", "build", "--progress=plain", "-t", tag, "-"],
        input=context.getvalue(), capture_output=True, timeout=180,
    )
    if build.returncode:
        raise RuntimeError(build.stderr.decode(errors="replace")[-8000:])
    run = subprocess.run(
        ["docker", "run", "--rm", "--pull", "never", "--network", "none",
         "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL",
         "--security-opt", "no-new-privileges", "--entrypoint", "/bin/sh",
         tag, "-c", smoke],
        capture_output=True,
    )
    print(run.stdout.decode(errors="replace"), end="")
    if run.returncode:
        raise RuntimeError(run.stderr.decode(errors="replace"))
finally:
    subprocess.run(["docker", "image", "rm", tag], capture_output=True)
