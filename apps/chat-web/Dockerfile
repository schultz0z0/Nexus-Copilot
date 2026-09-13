FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_APP_API_URL=""
ARG VITE_CHAT_STREAM_FILE_HOSTS=""
ENV VITE_APP_API_URL=$VITE_APP_API_URL \
    VITE_CHAT_STREAM_FILE_HOSTS=$VITE_CHAT_STREAM_FILE_HOSTS
RUN npm run build



FROM nginx:1.27-alpine

RUN addgroup -g 1001 -S app && adduser -S -D -H -u 1001 -G app app

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

RUN chown -R 1001:1001 /usr/share/nginx/html

USER 1001

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
