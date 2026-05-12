# Claude Code — `apps/web`

> App Vue.js (admin + coach + official desktop). Pour le domaine et les règles, voir `docs/main.md` et `docs/frontend-desktop.md`.

## À lire pour bosser ici

1. `docs/frontend-desktop.md` — architecture en couches, conventions, structure dossiers
2. `docs/main.md` — règles métier
3. `docs/firebase.md` — schéma (pour typer les repos et stores)
4. Ce fichier — règles spécifiques web

## Stack

Vue 3 (Composition API + `<script setup>`) · Vite · TypeScript strict · PrimeVue · Pinia · Vue Router · Firebase JS SDK modular.

## Architecture en couches — RAPPEL CRITIQUE

```
components/views  →  composables  →  stores (Pinia)  →  repositories  →  Firebase SDK
```

- **Components** : ne touchent **jamais** Firestore ni un repository directement.
- **Stores** : appellent **uniquement** des repositories.
- **Repositories** : **seuls** à importer le SDK Firebase.

Tout raccourci = à refuser ou refactor.

## Conventions

- **TS strict** activé. `any` interdit sans justification inline (`// any: <raison>`).
- **Imports** : alias `@/` → `apps/web/src/`.
- **Composables** : `useXxx`, retournent objet réactif.
- **Stores** : style composition API (`defineStore('name', () => { ... })`).
- **Dates** : `Timestamp` Firestore en storage, `Date` à la frontière repo. `"HH:MM"` strings pour times.
- **Types** : importés depuis `@shared-types` (package workspace).
- **PrimeVue** : import local par fichier (`import Button from 'primevue/button'`, `import DataTable from 'primevue/datatable'`, …), pas d'enregistrement global. Utiliser le composant directement dans le template (`<Button>`, `<DataTable>`). Pas de réimplémentation maison de composants existants.

## Cloud Functions — comment les appeler

Le projet expose 17 Cloud Functions (cf. `functions/src/index.ts`). **La plupart sont des triggers** (Firestore writes ou scheduled) — elles tournent automatiquement, rien à faire côté web. **5 sont callables** (= invocables depuis le client) :

| Function | Auth requise | Quand |
|---|---|---|
| `previewSeasonBookings({ seasonId })` | admin / rootAdmin | Écran `/seasons/:id/activate` (dry-run avant activation) |
| `runMigrations({ targetVersion? })` | admin / rootAdmin | Settings → ops (premier appel sur projet vierge crée `/_meta/schema`) |
| `setRootAdminClaim({ email, value })` | **rootAdmin uniquement** | Settings → Admin team. Anti-self-revoke. |
| `listRootAdminUids()` | admin / rootAdmin | Settings → Admin team : résout le badge `rootAdmin` (claim Auth, pas dans Firestore). |
| `acceptInvitation()` | signed-in | Auto-appelée par `users.repo.ts` après une sign-in OAuth si `/users/{uid}` est absent. Cherche `/invitations` par email et provisionne le user. |

**Toujours passer par les wrappers typés** dans `apps/web/src/services/cloudFunctions.ts` :

```ts
import { previewSeasonBookings } from '@/services/cloudFunctions'

const preview = await previewSeasonBookings({ seasonId: '2025-2026' })
// preview.count, preview.byCourt, preview.byDayOfWeek
```

**Pourquoi les wrappers et pas `httpsCallable()` direct dans les composants :**
1. Types Input/Output garantis.
2. La région `europe-west6` est gérée dans `services/firebase.ts` (sinon le SDK appelle `us-central1` → 404 cryptique).
3. Si le contrat de la function change, un seul endroit à mettre à jour.

**Lieu d'appel** : dans un **store Pinia** ou un **composable**, jamais directement dans un composant (cf. architecture en couches ci-dessus). Le wrapper retourne une Promise typée — le store la wrap en `loading/error/result`.

**Erreurs** : `httpsCallable` throw une `FunctionsError` (sous-classe de `FirebaseError`). Codes typiques :
- `unauthenticated` → user pas signé
- `permission-denied` → user signé mais pas le bon rôle
- `invalid-argument` → input mal formé (fix côté caller)
- `not-found` → ressource cible inexistante
- `internal` → bug serveur (logger côté Function, retry sans risque)

## Routing — allowlist

Chaque route a `meta.allowedRoles: string[]`. Guard global :
1. Si `rootAdmin: true` (claim) → laisse passer.
2. Sinon, intersection `user.roles` ∩ `meta.allowedRoles`.

## Avant de commit

- [ ] `npm run typecheck -w apps/web` passe
- [ ] `npm run lint -w apps/web` passe
- [ ] Si schéma touché : `docs/firebase.md`, `firestore.rules`, `packages/shared-types` à jour
- [ ] Si règle métier touchée : `docs/main.md` à jour

## Ce qu'il NE FAUT PAS faire ici

- Appeler le SDK Firebase depuis un composant.
- Mettre la logique métier dans un composant (la mettre dans store ou composable).
- Importer du code depuis `apps/control-plane/` (deux apps distinctes).
- Hardcoder l'ID du projet Firebase (toujours via `import.meta.env.VITE_FIREBASE_*`).
