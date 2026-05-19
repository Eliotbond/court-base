# Claude Code — `apps/courtbase-register`

> App Vue.js publique d'inscription (parents et joueurs). Pour le domaine et le plan d'implémentation, voir `docs/chantier-registrations.md`. Brief design : `docs/design-brief-register.md`.

## À lire pour bosser ici

1. `docs/chantier-registrations.md` — spec produit + lifecycle + schéma
2. `docs/main.md` — règles métier club
3. `docs/firebase.md` — schéma Firestore
4. `docs/design-to-vue-register.md` — playbook pour convertir un bundle claude.design en Vue dans cette app (atoms, mapping E# → routes, doublons avec `apps/web`)
5. Ce fichier — règles spécifiques register

## Stack

Vue 3 (Composition API + `<script setup>`) · Vite · TypeScript strict (`noUncheckedIndexedAccess`) · PrimeVue · Pinia · Vue Router · Firebase JS SDK modular.

Même stack que `apps/web` — patterns à reprendre, pas à réinventer.

## Architecture en couches

```
components/views  →  composables  →  stores (Pinia)  →  repositories  →  Firebase SDK
```

- **Components** : ne touchent **jamais** Firestore ni un repository directement.
- **Stores** : appellent **uniquement** des repositories.
- **Repositories** : **seuls** à importer le SDK Firebase.

## Différences critiques avec `apps/web`

### 1. Pas de deny-orphan

Contrairement à `apps/web` où un user signed-in sans `/users/{uid}` est rejeté (`NotAuthorizedError`), **cette app accepte explicitement les orphelins** : ils sont routés vers `/profile` pour créer leur doc `/users/{uid}` avec `roles: []`. Le rôle `'parent'` est attribué plus tard, par la callable `submitRegistration`, quand le user soumet une inscription "pour un enfant".

Conséquence : `users.repo.ts` côté register **n'appelle pas** `acceptInvitation` et **ne throw pas** sur orphelin. Le store `auth` expose `hasProfile` (boolean) que le guard router utilise pour rediriger vers `/profile` ou `/home`.

### 2. Hosting target distinct, même projet Firebase

L'app vit **dans le même projet Firebase** que l'app web (modèle one-project-per-club préservé). Build target séparé via `firebase.json` (à wirer). URL cible : `inscriptions.{slug}.courtbase.app`.

### 3. Public-facing, pas d'allowlist de rôles

Les routes ne portent pas de `meta.allowedRoles`. Le seul gating est : signed-in + profil complété. Pour l'instant pas de route admin/coach ici — elles vivent dans `apps/web`.

## Conventions

- **TS strict** + `noUncheckedIndexedAccess`.
- **Imports** : alias `@/` → `apps/courtbase-register/src/`.
- **Composables** : `useXxx`, retournent objet réactif.
- **Stores** : style composition API (`defineStore('name', () => { ... })`).
- **Types** : importés depuis `@club-app/shared-types` (workspace).
- **PrimeVue** : import local par fichier (`import Button from 'primevue/button'`). Pas d'enregistrement global. Pas de réimplémentation de composants existants.
- **Lucide icons** : `import { IconName } from 'lucide-vue-next'` (pour les icônes hors lib PrimeIcons).

## Avant de commit

- [ ] `npm run type-check -w @club-app/courtbase-register` passe
- [ ] Si schéma touché : `docs/firebase.md`, `firestore.rules`, `packages/shared-types` à jour
- [ ] Si règle métier touchée : `docs/main.md` ET `docs/chantier-registrations.md` à jour

## Ce qu'il NE FAUT PAS faire

- Importer du code depuis `apps/web/` ou `apps/control-plane/` (apps distinctes).
- Hardcoder l'ID du projet Firebase (toujours via `import.meta.env.VITE_FIREBASE_*`).
- Appeler le SDK Firebase depuis un composant.
- Toucher au flow auth de `apps/web` pour aligner avec ici — les deux apps gèrent l'auth différemment **par design** (deny-orphan vs accept-orphan).
- Ajouter `roles: ['parent']` directement à la création de `/users/{uid}` côté client — c'est la callable `submitRegistration` qui s'en charge serveur-side.

## État actuel (2026-05-14)

**Phase C livrée** (cf. `docs/chantier-registrations.md` §12) :

- Scaffold Vite + Vue 3 + PrimeVue + Pinia + vue-router branché.
- Auth complète : sign-in / sign-up email-password + OAuth Google/Apple + reset password.
- ProfileSetup (adresse + téléphone) qui crée `/users/{uid}` avec `roles: []`.
- **Wizard d'inscription complet — 9 vues** : `Step1Whoami` → `Step2Identity` → `Step3TeamPicker` → `Step4OpenHandbook` / `Step4ConditionalConditions` (variantes selon `team.registrationStatus`) → `Step5Contact` → `Step6TransferLetter` (conditionnel sur `previouslyLicensed`) → `Step7LicenseInfo` → `Step8Confirmation`.
- **Layout & navigation** : `WizardLayout` (header avec bouton retour contextuel + slot footer) et `Stepper` (progress visuelle 1/8 → 8/8).
- **4 composants partagés** dans `src/components/wizard/` : `RelationshipPicker`, `TeamCard`, `MatchFoundDialog`, `DocumentUploadTile` (avec export `UploadState`).
- **Routes** : `/register/step-1` ... `/register/step-7` + `/register/step-4-open` + `/register/step-4-conditional` + `/register/confirmation/:registrationId`.
- **Home câblé** : bouton "Nouvelle inscription" + cards drafts ("Reprendre" + suppression). Persistance `currentDraftId` via sessionStorage.
- **Suppression drafts** : `removeDraft` action dans le store ; rules autorisent `delete` par auteur si `status === 'draft'`.

**À venir (Phase D)** : workflow coach côté `apps/web` (acceptation / refus / trial in progress) — pas dans cette app.

**Firestore rules à étendre** (pas encore fait) :
- Autoriser l'écriture de `/users/{uid}` par le user lui-même (currently admin-only). Sinon `upsertUserProfile` plante en `permission-denied`.
- Cf. `firestore.rules` § `match /users/{uid}` — ajouter `allow create, update: if request.auth.uid == uid` avec validation des champs autorisés (pas de self-promotion à `admin`).

## Composants partagés du wizard — contrat d'utilisation

| Composant | Props | Events | Notes |
|---|---|---|---|
| `WizardLayout` | `current: number`, `title: string`, `backTo?: string`, `closeMode?: boolean`, `total = 8` | (slots : `default` + `#footer`) | Gère le bouton retour : icône `X` si étape 1, `ChevronLeft` sinon. `backTo` pour override la destination. |
| `Stepper` | `current: number`, `title: string`, `total = 8` | — | Utilisé par `WizardLayout`, rarement importé seul. |
| `RelationshipPicker` | `relationship: RegistrationRelationship \| null`, `relationshipOther: string \| null` | `update:relationship`, `update:relationshipOther` | Double `v-model`. |
| `TeamCard` | `team: PublicTeam` | `pick(team)` | Désactive auto si `team.registrationStatus === 'closed'`. |
| `MatchFoundDialog` | `matches: MemberMatch[]`, `visible: boolean` | `confirm(memberId)`, `reject` | Bottom-sheet, contrôlée par le parent. |
| `DocumentUploadTile` | `label: string`, `helper?: string`, `file: UploadState`, `accept?: string` | `pick(file)`, `remove`, `retry` | 4 états : `empty` / `uploading` / `uploaded` / `refused`. |

Le type `UploadState` est exporté depuis `DocumentUploadTile.vue` — importer depuis là, pas depuis `shared-types`.

## Pattern OAuth — race condition résolue

Le store `auth.ts` expose un wrapper interne `runSignIn(action)` qui :

- Await la prochaine notification `onAuthStateChanged` ET la fin du fetch userDoc.
- Pose un timeout défensif de 5s (sinon promesse pendante en cas d'incident SDK).
- Bascule un flag `resolvingProfile: boolean` (exposé par le store) pendant toute la séquence.

Le router `beforeEach` attend `auth.resolvingProfile === false` via `watch` avant de décider du redirect `/profile` vs `/home`.

`ProfileSetup` redirige vers `/home` si `hasProfile === true` au mount — idempotence pour éviter un formulaire vide si un user atterrit ici par accident.

**Règle dure** : ne JAMAIS lire `auth.hasProfile` immédiatement après `signInWithPopup` (la pop-up ferme avant que `onAuthStateChanged` ait propagé + avant que le fetch userDoc ait résolu). Toujours passer par les wrappers du store (`signInWithGoogle`, `signInWithApple`, `signInWithEmailPassword`, …) qui contiennent déjà la logique d'attente.

## Pattern persistance draft via sessionStorage

`useRegistrationsStore.currentDraftId` est persisté dans `sessionStorage` sous la clé `'court-base.register.currentDraftId'`. Restoré au démarrage du store.

Choix `sessionStorage` (et pas `localStorage`) :
- Tab-scoped → évite les fuites cross-user sur la même machine (ex : parent A puis parent B sur le même iPad partagé).
- Effacé à la fermeture du tab → pas de drift entre l'ID stocké et l'ID encore valide en base.

Clé supprimée à `clearDraft()` et à la soumission finale (`submitRegistration` callable OK → reset).

## Catch enrichi obligatoire

Dans tous les stores Pinia de cette app, tout `try/catch` autour d'un appel Firestore ou callable doit faire :

```ts
} catch (err) {
  const code = err instanceof FirebaseError ? err.code : 'unknown'
  console.error(`<actionName> failed [${code}]`, err)
  // …
}
```

Sans ça, les bugs disparaissent silencieusement (cas vécu : index manquant → bandeau "Impossible de charger" persistant sans diagnostic possible côté front). Pattern déjà appliqué dans `loadMyRegistrations` — répliquer partout ailleurs.

## Pattern simple query + JS sort

Pour `listMyRegistrations` et `listEligibleTeams`, le `orderBy` Firestore-side a été retiré au profit d'un tri JS côté client.

**Pourquoi** :
- Plus tolérant aux drafts dont `createdAt` est encore un `serverTimestamp` pending (Firestore ne les ordonne pas tant que le timestamp n'est pas résolu).
- Plus tolérant aux docs `teams` pré-existants qui n'ont pas le champ `active` (ils ne tomberaient pas dans la query si on filtre dessus).
- Acceptable car le volume attendu est faible : < 50 docs / user pour `registrations`, < 100 teams / club.

Au-delà de ces volumes, repasser à une query indexée serveur-side.

## Lecture des cotisations — union `memberId in [...]` ∪ `registeredByUid`

`repositories/dues.repo.ts` lit les cotisations (`/dues`) du user signed-in via une **UNION de deux critères**, fusionnée et dédupliquée par `doc.id` :

1. `where memberId in [chunk]` — couvre les cotisations dont le user est membre lié (`linkedUserId`) ou tuteur (`guardianUserIds`).
2. `where registeredByUid == uid` — couvre le cas où **aucun binding membre n'a pris** : inscription `for: 'self'` sur un member déjà lié à un autre compte. Le compte ayant soumis l'inscription reste l'`registeredByUid` de la cotisation (champ posé par le trigger `initiateDuesOnPlayerActivation`).

La rule `/dues` (`read`) autorise les deux critères : membre lié / tuteur, **ou** `resource.data.get('registeredByUid', null) == request.auth.uid`. La query `registeredByUid == uid` est une égalité simple → **aucun index composite** (cf. CLAUDE.md racine §10).

Les trois fonctions de liste (`listActiveDuesForMembers` / `listPaidDuesForMembers` / `listSettledDuesForMembers`) prennent un 2ᵉ paramètre `uid` (optionnel, `''` pour omettre la query d'union). `getDue` (single-doc) n'a PAS besoin de changement — la rule couvre déjà le submitter. Le store `dues.ts` passe `auth.authSnap.uid` et ne shortcut **pas** sur `memberIds.length === 0` (sinon le cas binding-raté serait manqué).

## Avant de tester sur dev

Avant tout test bout-en-bout sur `court-base-44878`, vérifier dans l'ordre :

1. **Callables déployées** : `firebase functions:list -P court-base-44878` montre `matchExistingMember`, `submitRegistration`, `cancelRegistration`, `refuseRegistration`.
2. **IAM Cloud Run** : pour chaque callable, `gcloud run services get-iam-policy <name-lowercase> --region=europe-west6 --project=court-base-44878` montre `allUsers / roles/run.invoker`. Si absent → `gcloud run services add-iam-policy-binding <name-lowercase> --region=europe-west6 --member=allUsers --role=roles/run.invoker --project=court-base-44878` (cf. [[deploy-functions-v2-invoker-binding]]).
3. **Rules / indexes / storage** : `firebase deploy --only firestore:rules,firestore:indexes,storage -P court-base-44878` après toute modif des fichiers correspondants (cf. [[deploy-firestore-rules-required]]).
4. **Teams côté admin (`apps/web`)** : chaque team doit avoir `registrationStatus: 'open' | 'conditional'` posé. Sans valeur, le wizard la traite comme `'closed'` et la désactive dans `TeamCard`.
