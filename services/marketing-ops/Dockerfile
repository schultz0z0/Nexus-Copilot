FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini tzdata
RUN mkdir -p /app/data/ads && chown node:node /app/data/ads && chmod 700 /app/data/ads
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8091
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
