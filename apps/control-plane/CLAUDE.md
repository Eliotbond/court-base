# Claude Code — `apps/control-plane`

> Dashboard éditeur (registre clients, déploiements, migrations). Vue.js séparé de `apps/web`. **Pas Phase 1**, mais Phase 0.

## À lire pour bosser ici

1. `docs/deployment.md` — topologie multi-projet, control-plane, provisioning
2. `docs/firebase.md` — schéma client (référence pour migrations)
3. Ce fichier

## Distinct de `apps/web`

- Deux projets Vue séparés. **Pas d'import croisé.**
- Stack identique (Vue 3 + Vite + TS + PrimeVue + Pinia) pour cohérence.
- Connecté au **projet Firebase éditeur** (control-plane), pas à un projet client.
- Auth : claim `editorRoot: true` (pas `rootAdmin`).

## Features (MVP)

- Liste clients : status, schema version, last deploy, alerts
- Wizard provisioning nouveau client
- Bouton "Deploy release to fleet" (staged rollout)
- Bouton "Run migration to vN" per-client / fleet-wide
- Live deployments + migration runs (`/registry/deployments`, `/registry/migrations`)
- Incidents (`/registry/incidents`)

## Accès

- IAM Google Cloud (Owner ou rôle custom) sur le projet control-plane.
- + claim Firebase Auth `editorRoot: true`.

## TODO (Phase 0)

- Setup projet + Firebase config control-plane
- `/registry/clients` CRUD UI
- Wizard provisioning (appelle un Cloud Function éditeur qui exécute le script)
- Polling `/registry/deployments` + `/registry/migrations`
- Auth + guard `editorRoot`
