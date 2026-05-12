# Club Management App

SAAS de gestion de club (sport), multi-tenant — **un projet Firebase par client**.

## Stack

- **Web** : Vue 3 + Vite + TypeScript + PrimeVue + Pinia
- **Mobile** : Flutter (iOS + Android) — Phase 2
- **Backend** : Firebase (Firestore, Auth, Functions, Storage, FCM)
- **Control-plane** : projet Firebase éditeur séparé pour orchestrer la flotte

## Structure (monorepo, npm workspaces)

```
apps/
  web/             # Vue.js — app client (admin + coach + official desktop)
  control-plane/   # Vue.js — dashboard éditeur (registre, déploiements)
  mobile/          # Flutter — Phase 2 (hors workspace npm)
functions/         # Cloud Functions partagées (déployées sur chaque projet client)
packages/
  shared-types/    # Types TS partagés web ↔ functions
docs/              # Spec produit (main, firebase, frontend-desktop, mobile-app, deployment)
```

## Quick start

```bash
npm install
npm run dev -w apps/web           # lance le web sur http://localhost:5173
npm run build -w functions        # compile les Functions
```

Pré-requis : Node 20+, npm 10+, Firebase CLI, un projet Firebase de dev configuré dans `apps/web/.env.local`.

## Workflow Git

GitHub Flow — voir [`docs/git-workflow.md`](docs/git-workflow.md).

- `main` est toujours déployable.
- Feature branches : `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
- Conventional Commits.
- PR obligatoire, CI verte, 1 reviewer (ou self-merge si solo).

## Documentation

- [`docs/main.md`](docs/main.md) — vue d'ensemble du domaine, règles métier
- [`docs/firebase.md`](docs/firebase.md) — schéma Firestore, security rules, Functions
- [`docs/frontend-desktop.md`](docs/frontend-desktop.md) — app Vue
- [`docs/mobile-app.md`](docs/mobile-app.md) — app Flutter
- [`docs/deployment.md`](docs/deployment.md) — multi-projet, control-plane, migrations
- [`docs/git-workflow.md`](docs/git-workflow.md) — GitHub Flow, conventions
- [`docs/claude-code-guide.md`](docs/claude-code-guide.md) — comment bosser avec Claude Code sur ce repo

## Pour Claude Code

Voir [`CLAUDE.md`](CLAUDE.md) à la racine et les `CLAUDE.md` locaux dans chaque dossier.
