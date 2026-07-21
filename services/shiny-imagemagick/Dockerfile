FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.js ./

ENV NODE_ENV=production
ENV PORT=8080
ENV MAGICK_BIN=convert
CMD ["node", "server.js"]
