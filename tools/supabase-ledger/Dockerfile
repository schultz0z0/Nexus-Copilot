FROM python:3.11.16-slim-bookworm@sha256:528257d48c1da0dcecc2e725d1ae34498d60c965f1241e39cd6a85a8859bdf84

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

RUN groupadd --gid 10001 ledger \
    && useradd --uid 10001 --gid ledger --no-create-home --shell /usr/sbin/nologin ledger

WORKDIR /app

COPY requirements.lock /app/requirements.lock
RUN python -m pip install --no-cache-dir --require-hashes -r /app/requirements.lock

COPY ledger.py pyproject.toml Dockerfile compose.yaml .dockerignore /app/
COPY src /app/src
COPY tests /app/tests

USER ledger

ENTRYPOINT ["python", "/app/ledger.py"]
