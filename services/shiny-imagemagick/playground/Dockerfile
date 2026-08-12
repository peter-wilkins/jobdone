FROM node:24-bookworm-slim

ARG GMIC_VERSION=4.0.3

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl imagemagick \
  && curl -fsSL \
    "https://gmic.eu/files/linux/gmic_${GMIC_VERSION}_debian12_bookworm_amd64.deb" \
    -o /tmp/gmic.deb \
  && apt-get install -y --no-install-recommends /tmp/gmic.deb \
  && rm -rf /var/lib/apt/lists/* /tmp/gmic.deb

WORKDIR /workspace
ENV PORT=8097
ENV MAGICK_BIN=convert
ENV GMIC_BIN=gmic
ENV SOURCE_IMAGE=/input/dog.jpg
ENV OUT_DIR=/out

CMD ["node", "--watch", "services/shiny-imagemagick/playground/server.js"]
