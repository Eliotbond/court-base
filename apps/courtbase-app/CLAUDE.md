# Claude Code — `apps/courtbase-app`

> App **companion** mobile-first (PWA) pour coachs, officiels et admins du
> club. Remplace l'ex-app Flutter `apps/mobile/` (dépréciée 2026-05-23).
>
> Spec produit : `docs/courtbase-app.md`. Brief design : `docs/design-brief-courtbase-app.md`.
> Référence visuelle : route locale `/_design` (showcase des primitives `Cb*`).

## À lire pour bosser ici

1. `docs/courtbase-app.md` — scope, audiences, allowlist par rôle, push FCM web
2. `docs/main.md` — règles métier (mêmes que `apps/web`, l'app companion est un autre client)
3. `docs/firebase.md` — schéma (déjà déployé, **pas** de nouvelle Function à écrire pour le MVP)
4. `docs/design-brief-courtbase-app.md` — système (S1–S11), écrans détaillés, conventions visuelles
5. Ce fichier

## Stack

Vue 3 (Composition API + `<script setup>`) · Vite · TypeScript strict
(`noUncheckedIndexedAccess`) · PrimeVue (preset emerald custom) · Pinia ·
Vue Router · Firebase Web SDK · `vite-plugin-pwa` · `lucide-vue-next`.

**Même stack que `apps/courtbase-register`** — patterns à reprendre, pas à
réinventer (`src/services/firebase.ts`, store auth Pinia, router guards, etc.).

## Architecture en couches (rappel CLAUDE.md racine)

```
components/views  →  composables  →  stores (Pinia)  →  repositories  →  Firebase SDK
```

- **Components** : ne touchent **jamais** Firestore ni un repository directement.
- **Stores** : appellent **uniquement** des repositories.
- **Repositories** : **seuls** à importer le SDK Firebase.

## ⚠️ Pièges connus

### CSS — `@import` avant `@tailwind` obligatoire

Le spec CSS exige que tout `@import` apparaisse **avant** les autres règles. Mettre `@import './assets/tokens.css'` après `@tailwind base/components/utilities` fait que le browser **l'ignore silencieusement** — toutes les classes `.cb-*` disparaissent et l'app rend en font système default sans layout. Bug vécu 2026-05-23. Cf. mémoire `css_import_order_trap`. Pattern correct (déjà en place dans `src/style.css`) :

```css
@import './assets/tokens.css';   /* ← EN PREMIER */

@tailwind base;
@tailwind components;
@tailwind utilities;
```

### `.vue.js` / `.ts → .js` shadow files

`vue-tsc --build` génère des artefacts `.vue.js` à côté de chaque `.vue`. Vite résout `.ts` avant `.js` (cf. `vite.config.ts > resolve.extensions`), donc pas de pollution réelle, mais ces fichiers polluent `find/grep` si non-filtrés. Le `.gitignore` les exclut. Cf. mémoire `vite_js_shadow_trap`.

### PWA Service Worker stale cache

Après un `npm run build`, `dist/sw.js` est généré (precache ~95 entries). Si on teste depuis `dist/` puis qu'on rebuild, le SW peut servir l'ancienne CSS. **Toujours `Unregister` le SW + `Clear site data` dans DevTools après une modification de tokens.css ou des styles globaux.**

## Différences avec `apps/web` (et `courtbase-register`)

### 1. Deny-orphan (comme `apps/web`)

Cette app gère des comptes **invités** par un admin (pas de self-registration
publique). Un user signed-in via OAuth sans `/users/{uid}` :

- Tente `acceptInvitation` (callable existante) — si une invitation matche
  son email, le doc `/users/{uid}` est créé serveur-side avec le rôle indiqué.
- Sinon : `signOut` + toast "Compte non autorisé. Demandez à un admin de
  votre club de vous inviter."

Identique au flow `apps/web`. À ne pas confondre avec `courtbase-register`
qui **accepte les orphelins** (eux ont vocation à devenir des parents/joueurs
via le flow d'inscription).

### 2. Shell restreint — allowlist par rôle

Routes deny-by-default. `src/router/allowlist.ts` liste les routes
autorisées **par rôle** (`coach`, `official`, `admin`). Le user voit l'union
de ses rôles. Le claim `rootAdmin` bypass (cf. router guard).

À chaque ajout de route nommée :
1. Ajouter dans `routes` (`src/router/index.ts`).
2. Ajouter dans `ALLOW[<role>]` du moins **un** rôle (sinon inatteignable).

### 3. Mobile-first (vs desktop-first `apps/web`)

Toutes les vues partent du shell mobile (`CbMobileShell`, viewport 375px).
La sidebar desktop n'apparaît qu'au-dessus de **1024px**. Pas de "version
desktop" repensée — c'est le même contenu, juste avec un shell différent.

### 4. PWA + FCM web push

`vite-plugin-pwa` configuré dans `vite.config.ts` (manifest + workbox
minimal). Le **service worker FCM** (`public/firebase-messaging-sw.js`)
sera ajouté en Phase 5 du roadmap (cf. `docs/courtbase-app.md`).

**Limite iOS** : web push uniquement sur iOS 16.4+ ET app installée comme
PWA depuis le home screen. L'app doit proposer le banner "Ajouter à
l'écran d'accueil" aux users iOS — sinon pas de notifications.

### 5. Pas de Cloud Functions à écrire

L'app consomme les callables **déjà déployées** par l'ex-app Flutter :
`coachCreateMember`, `coachUpdateMember`, `coachDeactivateMember`,
`coachCreateAwayMatch`, `markTrialInProgress`, `confirmRegistration`,
`refuseRegistration`, `acceptInvitation`, `processMatchRequest`, etc.
Le trigger `fanoutNotification` (push FCM automatique sur création d'un
`/notifications`) est lui aussi opérationnel.

Cf. `docs/firebase.md` § Cloud Functions + mémoire `mobile_chantier_status`.

## Conventions

- **TS strict** + `noUncheckedIndexedAccess`. Pas de `any` sans justification.
- **Imports** : alias `@/` → `apps/courtbase-app/src/`.
- **Composables** : `useXxx`, retournent objet réactif.
- **Stores** : style composition API (`defineStore('name', () => { ... })`).
- **Types** : importés depuis `@club-app/shared-types` (workspace).
- **PrimeVue** : import local par fichier (`import Button from 'primevue/button'`).
  Pas d'enregistrement global. Pas de réimplémentation de composants existants.
- **Lucide icons** : `import { IconName } from 'lucide-vue-next'`. Préférer
  toujours lucide aux SVG inline (le bundle design utilisait des SVG ad-hoc,
  on les a tous remappés sur lucide).
- **CSS** : utiliser les classes utilitaires `.cb-*` exposées par
  `src/assets/tokens.css` plutôt que d'écrire des styles scoped redondants.
  Si une variation manque, l'ajouter dans tokens.css (en commentant le cas
  d'usage), pas dans une `<style scoped>`.

## Design system — primitives `Cb*`

Tous les composants UI partagés vivent dans `src/components/ui/`. Conventions :

| Composant | Brief | Rôle |
|---|---|---|
| `CbMobileShell` | S1 | Shell mobile : header + body scrollable + tab bar |
| `CbDesktopShell` | S2 | Shell desktop : sidebar 240px + main |
| `CbHeader` | S1 | Header sticky 56px (logo / back, titre, cloche, kebab) |
| `CbTabBar` | S3 | Tab bar bottom mobile (2–4 items role-aware) |
| `CbSidebar` | S2 | Sidebar desktop (brand + nav + userchip) |
| `CbPill` | S4 | Status pill (6 tons sémantiques + variantes solid/dot) |
| `CbAvatar` | — | Avatar à initiales (xs/sm/md/lg + 5 tones) |
| `CbMemberRow` | S5 | Row dense joueur (avatar + nom + pills + chevron) |
| `CbMatchCard` | S6 | Card match avec staffing + officiels assignés |
| `CbMatchTypeChip` | — | Mapping `MatchType` → pill colorée |
| `CbEmptyState` | S7 | Empty state (icône + titre + body + actions) |
| `CbBottomBar` | S8 | Sticky bottom CTAs (mobile) |
| `CbBanner` | — | Banner pleine largeur (4 tones) |
| `CbNotifItem` | S10 | Notif item (type → icône + couleur dérivés) |
| `CbSkel` | — | Skeleton loader atomique |

Référence visuelle live : route `/_design`.

## Avant de commit

- [ ] `npm run type-check -w @club-app/courtbase-app` passe
- [ ] Toute nouvelle route nommée a été ajoutée à `router/allowlist.ts`
- [ ] Si schéma touché : `docs/firebase.md`, `firestore.rules`, `packages/shared-types` à jour
- [ ] Si règle métier touchée : `docs/main.md` ET `docs/courtbase-app.md` à jour

## Ce qu'il NE FAUT PAS faire

- Importer du code depuis `apps/web/`, `apps/courtbase-register/` ou
  `apps/mobile/` (apps distinctes — `apps/mobile/` est en plus déprécié).
- Hardcoder l'ID du projet Firebase (toujours via `import.meta.env.VITE_FIREBASE_*`).
- Appeler le SDK Firebase depuis un composant.
- Ajouter une route sans l'ajouter à l'allowlist (sinon inatteignable).
- Réimplémenter en `<style scoped>` un effet déjà couvert par `.cb-*`.

## Déploiement (à wirer)

`firebase.json` est encore en mode **single-target hosting** (pointe sur
`apps/web/dist`). Pour exposer `courtbase-app` :

1. Convertir `hosting` en tableau multi-target (`web`, `register`, `courtbase-app`).
2. Ajouter `.firebaserc` `targets` mapping target → site Firebase Hosting.
3. CI : étendre le workflow `apps/web` pour build `apps/courtbase-app` et déployer
   sur le bon target.

À faire dans une PR de déploiement séparée — pas dans la PR d'initialisation.

## État actuel (2026-05-23)

### Scaffold + design system livrés

- Vite + Vue 3 + TS + PrimeVue + Pinia + Tailwind + Firebase + PWA branchés.
- Design tokens (`src/assets/tokens.css`) portés depuis le bundle claude.design,
  adaptés en classes responsives `.cb-*`.
- **16 primitives `Cb*`** Vue (`src/components/ui/`) + dialog `CbAssignmentActionDialog`
  (`src/components/dialogs/`).
- Showcase visuel sur `/_design`.

### Toutes les vues livrées (24/24) — **EN MODE MOCK**

⚠️ **Aucune donnée réelle**. Toutes les vues consomment `@/repositories/mock`
(`MOCK_SESSION`, `MOCK_MEMBERS`, `MOCK_TEAMS`, `MOCK_MATCHES`,
`MOCK_REGISTRATIONS`, `MOCK_NOTIFICATIONS`, `MOCK_REQUESTS`, etc.). Le badge
`CbMockBadge` ("Données simulées") est visible en permanence pour le rappeler.

| Audience | Vues |
|---|---|
| Communs | `SignIn`, `ProfileSetup`, `MemberInactiveBlocker`, `Home` (role-aware), `common/Notifications`, `common/ProfileSettings`, `DesignSystem`, `NotFound` |
| Officiel | `official/OpenMatches`, `official/MyAssignments`, `official/MatchDetail` + dialog `dialogs/CbAssignmentActionDialog` |
| Coach | `coach/MyTeams`, `coach/TeamRoster`, `coach/MemberForm` (create+edit), `coach/MemberDetail`, `coach/TeamPlanning`, `coach/TrainingAttendance`, `coach/AwayMatchCreate`, `coach/Registrations`, `coach/RegistrationDetail`, `coach/MatchMoveRequest` |
| Admin | `admin/Staffing`, `admin/StaffingDetail`, `admin/Requests`, `admin/RequestDetail`, `admin/Broadcast` |

**~22 000 lignes Vue** au total. Mock user multi-rôle (`coach + official + admin`)
pour naviguer dans toute l'app via un seul login.

### Composables disponibles

- `useViewport()` — switch responsive mobile/desktop ≥1024px.
- `useShellNav()` — tabs + nav sidebar role-aware avec badges réactifs.
  À utiliser pour toute nouvelle vue qui a besoin d'un shell mobile + desktop
  (évite de re-inliner les arrays `CbTab[]` / `CbNavItem[]`).

### Mock — conventions

Toutes les mutations sont **log-only** via `logMockAction(action, payload)`.
La couche mock ne conserve aucun changement (un `markPaid` mock n'altère pas
le store). Volontaire — évite que deux vues qui partagent un même mock se
contredisent.

Quand on branchera Firebase :
1. Remplacer les imports `@/repositories/mock` par les vraies repos.
2. Faire passer toutes les fonctions en `async` (les vues sont prêtes — les
   computed/refs gèrent le state initial null).
3. Retirer `<CbMockBadge />` de `App.vue`.

### À venir

- **Phase 1** : auth réelle (Google/Apple/Email + acceptInvitation + deny-orphan)
  qui remplace le store mock. Cf. `docs/courtbase-app.md` Phase 1.
- **Phase 2-4** : déjà livré en mock — restera à brancher les vraies repos
  Firebase au remplacement, sans réécrire les templates.
- **Phase 5** : Service worker FCM + permission prompt + banner iOS PWA.
- **Phase 6** : polish + offline-light.

## Lancer en dev

```bash
npm install
npm run dev:courtbase-app
# → http://localhost:5175
# → http://localhost:5175/_design  (showcase)
```

Pas besoin de `.env.local` pour le showcase. Pour les vues qui touchent
Firebase (à venir), créer `apps/courtbase-app/.env.local` à partir de
`apps/courtbase-app/.env.example` (mêmes valeurs que les autres apps du
projet client).
