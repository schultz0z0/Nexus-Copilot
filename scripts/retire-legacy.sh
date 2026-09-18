#!/usr/bin/env bash
# scripts/retire-legacy.sh
# 
# Script de descomissionamento e teardown seguro de credenciais, contêineres
# e volumes legados (Supabase, Neo4j, Graph MCP).
# Compatível com produção (/etc/ens/app.env) e execuções de teste.

set -euo pipefail

echo "==> M7: Descomissionamento de chaves e recursos do Legado"

DRY_RUN=false
TARGET_ENV="${1:-/etc/ens/app.env}"

if [[ "${1:-}" == "--dry-run" ]] || [[ "${2:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[Modo Dry-Run Ativo] Nenhuma alteração destrutiva será gravada."
  if [[ "${1:-}" == "--dry-run" ]]; then
    TARGET_ENV="${2:-/etc/ens/app.env}"
  fi
fi

# 1. Limpeza de variáveis legadas no arquivo de ambiente
clean_env_file() {
  local env_file="$1"
  if [ -f "$env_file" ]; then
    echo "Processando arquivo de ambiente: $env_file"
    local backup_file="${env_file}.bak.$(date +%s)"
    
    if [ "$DRY_RUN" = true ]; then
      echo "  [Dry-run] Faria backup para: $backup_file"
      echo "  [Dry-run] Linhas legadas encontradas:"
      grep -E '^(VITE_)?SUPABASE_|^NEO4J_|^GRAPH_MCP_' "$env_file" || echo "    (Nenhuma linha legada encontrada)"
    else
      echo "  Criando backup de segurança em: $backup_file"
      cp "$env_file" "$backup_file"
      
      sed -i '/^VITE_SUPABASE_/d' "$env_file"
      sed -i '/^SUPABASE_/d' "$env_file"
      sed -i '/^NEO4J_/d' "$env_file"
      sed -i '/^GRAPH_MCP_/d' "$env_file"
      echo "  Arquivo $env_file limpo com sucesso."
    fi
  else
    echo "Arquivo de ambiente $env_file não existe neste host (OK se for teste local)."
  fi
}

clean_env_file "$TARGET_ENV"

# Opcional: verificar diretório local .env se existir
if [ -f "/opt/prometeus-marketing/.env" ] && [ "/opt/prometeus-marketing/.env" != "$TARGET_ENV" ]; then
  clean_env_file "/opt/prometeus-marketing/.env"
fi

# 2. Verificação e limpeza de contêineres legados
echo "==> Verificando contêineres legados no Docker..."
LEGACY_CONTAINERS=$(docker ps -a --filter "name=supabase" --filter "name=neo4j" --filter "name=graph-mcp" --filter "name=legacy-" --format "{{.ID}}" 2>/dev/null || true)

if [ -n "$LEGACY_CONTAINERS" ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "  [Dry-run] Contêineres legados que seriam removidos: $LEGACY_CONTAINERS"
  else
    echo "  Parando e removendo contêineres legados encontrados..."
    docker stop $LEGACY_CONTAINERS 2>/dev/null || true
    docker rm $LEGACY_CONTAINERS 2>/dev/null || true
    echo "  Contêineres legados removidos com sucesso."
  fi
else
  echo "  Nenhum contêiner legado em execução no Docker."
fi

echo "==> Descomissionamento local de resíduos legados concluído."
echo "Lembre-se de deletar o projeto físico no console web do Supabase (fora da VPS)."
