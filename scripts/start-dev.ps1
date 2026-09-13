<#
.SYNOPSIS
  Inicia o ambiente de desenvolvimento local (Docker Desktop + Serviços ENS).
.DESCRIPTION
  Verifica se os contêineres PostgreSQL e Hermes estão ativos e saudáveis,
  configura o ambiente e pode iniciar o Chat Bridge, App API e Chat Web.
#>

param(
  [switch]$CheckOnly,
  [switch]$SeedUser
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot

Write-Host "=== ENS - Inicializador do Ambiente de Desenvolvimento ===" -ForegroundColor Cyan

# 1. Verificar Docker Desktop
try {
  $dockerVer = docker version --format '{{.Server.Version}}' 2>$null
  if (-not $dockerVer) {
    Write-Error "Docker Desktop não está respondendo. Inicie o Docker Desktop primeiro."
    exit 1
  }
  Write-Host "[OK] Docker Desktop conectado (Engine $dockerVer)" -ForegroundColor Green
} catch {
  Write-Error "Falha ao consultar o Docker: $_"
  exit 1
}

# 2. Verificar/Subir PostgreSQL
Write-Host "Verificando container PostgreSQL (porta 55432)..." -ForegroundColor Yellow
$pgState = docker inspect -f '{{.State.Health.Status}}' ens-postgres-postgres-1 2>$null
if ($pgState -ne "healthy") {
  Write-Host "Subindo container ens-postgres-postgres-1..." -ForegroundColor Yellow
  docker compose -f "$rootDir/infra/postgres/compose.yaml" -f "$rootDir/infra/postgres/compose.development.yaml" up -d --wait postgres
}
Write-Host "[OK] PostgreSQL 18.6 ativo e saudável em 127.0.0.1:55432" -ForegroundColor Green

# 3. Verificar/Subir Hermes
Write-Host "Verificando container Hermes (porta 18642)..." -ForegroundColor Yellow
$env:API_SERVER_KEY = "ens-local-parity-key-dev-1234567890"
$hermesState = docker inspect -f '{{.State.Health.Status}}' ens-hermes-hermes-1 2>$null
if ($hermesState -ne "healthy") {
  Write-Host "Subindo container ens-hermes-hermes-1..." -ForegroundColor Yellow
  docker compose -f "$rootDir/infra/hermes/compose.yaml" -f "$rootDir/infra/hermes/compose.parity.yaml" up -d
}
Write-Host "[OK] Hermes Agent (Profile ens) ativo em 127.0.0.1:18642" -ForegroundColor Green

# 4. Seed do Usuário Dev (se solicitado)
if ($SeedUser) {
  Write-Host "Executando seed de usuário dev..." -ForegroundColor Yellow
  node "$rootDir/scripts/seed-dev-user.mjs"
}

# Resumo do Ambiente
Write-Host ""
Write-Host "================ STATUS DO AMBIENTE DEV ================" -ForegroundColor Cyan
Write-Host "PostgreSQL 18.6 : 127.0.0.1:55432  (DB: nexus, User: nexus_app)" -ForegroundColor White
Write-Host "Hermes Runs API : 127.0.0.1:18642  (Key: ens-local-parity-key-dev-1234567890)" -ForegroundColor White
Write-Host "Usuário de teste: admin@ens.local / AdminDev123!" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

if ($CheckOnly) {
  exit 0
}

Write-Host "Comandos para iniciar os serviços em terminais separados:" -ForegroundColor Cyan
Write-Host "1. Chat Bridge (Porta 8082):" -ForegroundColor Yellow
Write-Host '   $env:PORT="8082"; $env:BRIDGE_PORT="8082"; $env:BRIDGE_ALLOW_INSECURE_LOCAL_AUTH="true"; $env:HERMES_API_BASE_URL="http://127.0.0.1:18642"; $env:HERMES_API_KEY="ens-local-parity-key-dev-1234567890"; npm --prefix services/chat-bridge start' -ForegroundColor Gray
Write-Host ""
Write-Host "2. App API / BFF (Porta 3000):" -ForegroundColor Yellow
Write-Host '   $env:PORT="3000"; $env:PGHOST="127.0.0.1"; $env:PGPORT="55432"; $env:PGUSER="nexus_app"; $env:PGPASSWORD_FILE="infra/postgres/secrets/postgres_app_password"; $env:CHAT_BRIDGE_URL="http://127.0.0.1:8082"; npm --prefix services/app-api start' -ForegroundColor Gray
Write-Host ""
Write-Host "3. Frontend Chat Web (Porta 8081 / Vite):" -ForegroundColor Yellow
Write-Host '   $env:VITE_APP_API_PROXY_TARGET="http://127.0.0.1:3000"; npm --prefix apps/chat-web run dev' -ForegroundColor Gray
Write-Host ""
