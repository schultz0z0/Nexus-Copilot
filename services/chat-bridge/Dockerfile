FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN apk add --no-cache su-exec && npm install --omit=dev

COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/chat-bridge-entrypoint.sh

RUN mkdir -p /app/data && \
    chown -R node:node /app && \
    chmod +x /usr/local/bin/chat-bridge-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/chat-bridge-entrypoint.sh"]
CMD ["node", "src/server.js"]
