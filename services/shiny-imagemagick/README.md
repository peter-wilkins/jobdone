# Shiny ImageMagick Renderer

Small Cloud Run service for deterministic Shiny Art Shop previews.

## Contract

```http
POST /render
Authorization: Bearer <RENDER_TOKEN>
Content-Type: application/json
```

```json
{
  "sourceImage": {
    "mimeType": "image/jpeg",
    "dataBase64": "..."
  },
  "designDirection": {
    "material": "copper_effect"
  },
  "size": "1024x1024"
}
```

Response:

```json
{
  "ok": true,
  "provider": "google-imagemagick",
  "generatorVersion": "google-imagemagick:v1",
  "mimeType": "image/png",
  "dataBase64": "..."
}
```

## Local Run

Requires ImageMagick installed and available as `magick`.

```bash
RENDER_TOKEN=dev-token npm start
```

## Cloud Run

Use the repo script from the root:

```bash
GCP_PROJECT_ID=your-project \
GCP_REGION=europe-west2 \
SHINY_IMAGEMAGICK_SERVICE_TOKEN='long-random-token' \
bash scripts/deploy-shiny-imagemagick.sh
```

Cloud Run is allowed unauthenticated at the Google layer for MVP Vercel
simplicity. The service itself rejects requests without the bearer token.
