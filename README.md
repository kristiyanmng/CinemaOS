# CinemaOS

CinemaOS is the live development repository for a cinema operations platform.

## v0.3 foundation

The project now has:
- Cloudflare Worker backend entrypoint
- Static frontend served from `public/`
- `/api/health` endpoint
- `/api/bootstrap` endpoint
- D1-ready SQL schema draft in `schema.sql`
- Central storage / halls / schedule / delivery UI

## Current deployment

Cloudflare Workers with Static Assets.

- Worker entry: `src/worker.js`
- Static assets: `public/`
- Config: `wrangler.jsonc`

## Next production step

Create a Cloudflare D1 database and bind it as `DB`. Then CinemaOS can move movies, halls, schedules and users out of browser localStorage and into shared persistent storage.

## Safety

CinemaOS does not bypass DCI/KDM protections or cinema-server security requirements. DCP/KDM and equipment integrations must use authorized content workflows, valid certificates and supported vendor interfaces.
