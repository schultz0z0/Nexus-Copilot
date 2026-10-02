FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Root-operated checkouts can have 0700 directories and 0600 files (umask 077).
# Normalize only application code; keep it root-owned and readable by node.
RUN chmod 0644 /app/package.json \
    && find /app/src -type d -exec chmod 0755 {} + \
    && find /app/src -type f -exec chmod 0644 {} +

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
