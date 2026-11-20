# [https://jerks.mattjarrett.dev](https://jerks.mattjarrett.dev)

Scanners ask every site on my bookshelf Kubernetes homelab for files like `/.env` and `/wp-login.php`. This page sweeps the last 30 days of their requests across a US map, one dot per city, on a loop.

The numbers come from [homelab-stats](https://github.com/cujarrett/homelab-stats), which reads the Traefik access logs. Only US requests are kept, and a source is reported as a city.

## Run it locally

```bash
npm install
npm start
```

Open http://localhost:4200. The page reloads when a file changes.

Pick where the numbers come from:

| Command | Stats from |
|---|---|
| `npm start` | The live site, `mattjarrett.dev` |
| `npm run start:local` | homelab-stats from source on `localhost:18080`. Start it first with `just dev` in that repo |

## Checks

```bash
npm run ci      # format check, lint and unit tests
npm run build   # production build in dist/
```

## Deployment

Runs on the homelab cluster as a `Spa` in the `mattjarrett-dev` workspace. Image: `ghcr.io/cujarrett/jerks`. ARM64.
