# CinemaOS

CinemaOS is an early-stage cinema operations platform for content delivery, scheduling, hall monitoring, playlists, automation and future AI-assisted workflows.

## Current build

This repository is the live development base for CinemaOS.

Included:
- Dashboard
- Movie Library
- Content Delivery
- Schedule
- Playlists
- Halls
- Automation
- AI Assistant UI
- Reports
- Settings
- Central-storage workflow concept
- Browser-persistent demo data

## Architecture direction

Production target:
- Web frontend
- Cloud API
- Database
- CinemaOS Agent installed inside the cinema
- Hardware adapter layer
- Central cinema storage
- Distributor Portal
- Authorized DCP/KDM workflows

CinemaOS will not bypass DCI/KDM protections or cinema-server security requirements. Real equipment integration must use supported/authorized protocols, certificates and vendor interfaces.

## Cloudflare Pages

This version is static and can be deployed directly.

Recommended:
- Production branch: main
- Framework preset: None
- Build command: leave empty
- Build output directory: /

## Roadmap

1. Cloudflare Pages live deployment
2. Cloudflare Worker API
3. Real authentication and roles
4. D1/PostgreSQL data model
5. Cinema profiles
6. Content/version records in backend
7. CinemaOS Agent
8. Authorized DCP metadata ingest (ASSETMAP / PKL / CPL)
9. Distributor Portal
10. Hardware adapters
11. KDM request/import/validity management
12. Realtime hall telemetry
