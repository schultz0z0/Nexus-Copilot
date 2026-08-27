FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache su-exec

COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/artifact-server-entrypoint.sh

RUN mkdir -p /app/data && \
    chown -R node:node /app && \
    chmod +x /usr/local/bin/artifact-server-entrypoint.sh

EXPOSE 8095

ENTRYPOINT ["/usr/local/bin/artifact-server-entrypoint.sh"]
CMD ["node", "src/server.js"]
