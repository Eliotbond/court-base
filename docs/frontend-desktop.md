# Frontend — Web Desktop (Vue.js)

> Voir aussi : `firebase.md` (schéma), `deployment.md` (multi-projet), `main.md` (règles métier).

## Stack

| Layer | Tech |
|---|---|
| Framework | Vue 3 (Composition API + `<script setup>`) |
| Build | Vite |
| Langue | TypeScript (strict) |
| UI | PrimeVue |
| State | Pinia |
| Router | Vue Router |
| Backend | Firebase JS SDK (modular v9+) |
| Deploy | Firebase Hosting |

## Contexte multi-tenant

Chaque client = projet Firebase distinct. À runtime, le web parle à **un seul** projet — le sien.

- Pas de notion d'"active club" dans l'app : le projet *est* le club.
- Local dev : `apps/web/.env.local` (`VITE_FIREBASE_*`).
- Prod : à décider (déploiement Hosting per-project ou tenant-by-subdomain — open question dans `deployment.md`).

## Architecture en couches

**Strict, top-down. Une couche ne saute jamais celle d'en-dessous.**

```
components/views   (UI)
      ↓
composables        (UI logic, reactive)
      ↓
stores (Pinia)     (state)
      ↓
repositories       (Firestore — seule couche qui touche Firebase)
      ↓
Firebase SDK
```

Règles :
- **Components** n'appellent jamais Firestore ni un repository directement.
- **Stores** appellent uniquement les repositories.
- **Composables** : logique UI pure + appels stores.
- **Repositories** : seuls à importer le SDK Firebase.

Comme les paths sont plats, les repos ne prennent **pas** de `clubId`.

## Structure de dossiers

```
apps/web/src/
  main.ts
  router/
    index.ts            # routes + guards allowlist
  stores/               # Pinia stores
    auth.ts
    members.ts
    teams.ts
    ...
  composables/          # useXxx() helpers
  repositories/         # interface Firestore
    members.repo.ts
    teams.repo.ts
    ...
  services/             # Firebase init, cross-cutting (i18n, date, ...)
    firebase.ts
  views/                # pages = composants haut niveau routés
    auth/
    config/
    members/
    teams/
    seasons/
    bookings/
    officials/
    dues/
    license-requests/
    root-admin/
  components/           # composants partagés
  types/                # types partagés (souvent depuis @shared-types)
  assets/
```

## Routing — allowlist

Chaque route déclare `meta.allowedRoles: string[]`. Un guard `beforeEach` global :
1. Si user a `rootAdmin: true` (claim) → laisse passer (court-circuit).
2. Sinon, intersection entre `user.roles` (`/users/{uid}`) et `meta.allowedRoles`.
3. Sinon redirect login ou /forbidden.

**Ajouter un rôle** (ex. `player`) = l'ajouter aux allowlists pertinentes. Pas de modif du guard.

## Root admin UI

Per-project root admin (claim `rootAdmin: true`) :
- Même UI qu'admin + badge "Root" dans le layout.
- Menu "Root admin tools" : force-delete, fix manuel `duesStatus`, override sans exception request, promote user en admin/rootAdmin, etc.
- Tous les guards bypass par claim.

Editor global root → utilise **uniquement** le control-plane (`apps/control-plane`), jamais le web client.

## Officials sur le web

Web = surtout admin + coach. Les officiels bossent mobile, mais le web doit supporter :

- **Admin** : config MatchTypes (officials requis), créer/override `officialAssignments`, envoyer notifs manuelles, export fin saison.
- **Member management** : set `officialLevel`, link Auth account.
- **UI optionnelle official** : login web autorisé, mêmes guards.

## UI library — PrimeVue

Formulaires, tables, dialogs, calendriers, menus. Le vue saison (grille hebdo des slots/bookings) est complexe — considérer `FullCalendar` PrimeVue ou grille custom sur primitives.

## Conventions

- **TS strict**. Pas de `any` sans justif inline.
- **Dates** : Firestore `Timestamp` en storage, `Date` à la frontière repo. `"HH:MM"` strings pour les time-of-day.
- **Types** : dérivés du schéma `firebase.md`, partagés via `packages/shared-types`.
- **Composables** : nommés `useXxx`, retournent un objet réactif.
- **Stores Pinia** : composition API style (`defineStore('name', () => { ... })`).
- **Imports** : alias `@/` pour `apps/web/src/`.

## Non-négociables Phase 1

1. **Firestore rules d'abord**, avant tout composant.
2. **Toute nouvelle collection / champ** → MAJ `firebase.md` + `firestore.rules` dans la même PR.
