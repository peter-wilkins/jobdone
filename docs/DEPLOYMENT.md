# Deployment

JobDone uses a staging-first Vercel flow for beta-era changes.

## URLs

Staging:

- Frontend: <https://jobdone-staging.vercel.app>
- Backend: <https://jobdone-backend-staging.vercel.app>

Production:

- Frontend: <https://jobdone-production.vercel.app>
- Backend: <https://jobdone-backend-production.vercel.app>

`jobdone-production.vercel.app` is the temporary explicit production install
route. Replace it with the owned JobDone domain when the production domain is
ready.

The backend Vercel project must not have SSO deployment protection enabled for
these `.vercel.app` aliases, otherwise browser QA and phone testing receive
Vercel 401 pages before the API is reached.

Legacy production aliases may still exist while dogfooding, but agents should
prefer the explicit staging/production URLs above.

## Phone Installs

Use the explicit frontend URLs when installing on Android:

- Install staging from <https://jobdone-staging.vercel.app>. It uses
  the PWA name **JobDone Staging** and shows a yellow staging banner.
- Install production from <https://jobdone-production.vercel.app>. It
  uses the PWA name **JobDone Production** and currently shows a green
  production banner while dogfooding.

These are separate install routes. The manifests use different app identities,
so Android can keep both installed side by side.

## Staging

Deploy the current commit to staging:

```bash
npm run deploy:staging
npm run deploy:check:staging
```

`deploy:staging` writes `.deploy/last-staging.env` with the immutable frontend
and backend deployment URLs. Do not edit that file by hand before promotion.
It uses Vercel production-target builds with `--skip-domain`, so staging is
public but production aliases are not moved.

## QA Gate

Before promotion, run the smallest useful checks for the change:

```bash
npm run deploy:check:staging
QA_BASE_URL=https://jobdone-staging.vercel.app npm --prefix frontend run qa:smoke
```

For frontend-visible changes, also do a focused manual check on staging. Keep it
small and specific to the current change.

## Promote

Promote the last staged immutable deployments to production aliases:

```bash
npm run deploy:promote
npm run deploy:check:production
```

Promotion moves aliases to the staged frontend and backend deployments. It does
not rebuild.

## Rollback

Find the previous good immutable deployment URLs:

```bash
npx vercel ls --cwd frontend
npx vercel ls --cwd backend
```

Then repoint aliases:

```bash
npx vercel alias set <frontend-deployment-url> jobdone-production.vercel.app --cwd frontend
npx vercel alias set <backend-deployment-url> jobdone-backend-production.vercel.app --cwd backend
npm run deploy:check:production
```
