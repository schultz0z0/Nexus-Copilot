#!/usr/bin/env bash
# scripts/retire-legacy.sh
# 
# Script auxiliar para varrer e remover rastros das variáveis de ambiente legadas
# nos arquivos de configuração do ecossistema ENS.

set -euo pipefail

echo "==> M7: Descomissionamento de chaves e variáveis do Supabase e Legado"

TARGET_DIR=${1:-/opt/prometeus-marketing}

if [ ! -d "$TARGET_DIR" ]; then
  echo "Erro: Diretório $TARGET_DIR não encontrado."
  exit 1
fi

echo "Buscando referências em arquivos .env na VPS..."

# Purge em app.env
if [ -f "$TARGET_DIR/app.env" ]; then
  echo "Limpando $TARGET_DIR/app.env"
  sed -i '/VITE_SUPABASE_URL/d' "$TARGET_DIR/app.env"
  sed -i '/VITE_SUPABASE_ANON_KEY/d' "$TARGET_DIR/app.env"
  sed -i '/SUPABASE_URL/d' "$TARGET_DIR/app.env"
  sed -i '/SUPABASE_SERVICE_ROLE_KEY/d' "$TARGET_DIR/app.env"
fi

# Opcional: Purge de outros envs se existirem
if [ -f "$TARGET_DIR/.env" ]; then
  echo "Limpando $TARGET_DIR/.env"
  sed -i '/VITE_SUPABASE_/d' "$TARGET_DIR/.env"
  sed -i '/SUPABASE_/d' "$TARGET_DIR/.env"
fi

echo "Verificação de contêineres legados..."
LEGACY_CONTAINERS=$(docker ps -a --filter "name=supabase" --filter "name=neo4j" --format "{{.ID}}")

if [ -n "$LEGACY_CONTAINERS" ]; then
  echo "Parando e removendo contêineres legados encontrados..."
  docker stop $LEGACY_CONTAINERS
  docker rm $LEGACY_CONTAINERS
else
  echo "Nenhum contêiner de nome 'supabase' ou 'neo4j' encontrado em execução local."
fi

echo "==> Limpeza de resíduos da arquitetura legada concluída."
echo "Lembre-se de deletar o projeto físico na plataforma Supabase."
