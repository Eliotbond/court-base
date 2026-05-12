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
- **PrimeVue** : `<PButton>`, `<PInputText>`, etc. Pas de réimplémentation maison de composants existants.

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
