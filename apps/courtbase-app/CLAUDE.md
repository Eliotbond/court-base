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

## Menu unifié single-page (refactor 2026-05-24, PR-M)

> **Source de vérité produit** : `docs/courtbase-app/menu-refactor.md`. Ce
> bloc est le résumé d'implémentation — toute évolution du modèle (sections,
> sélection tabs, grouping sidebar) doit d'abord être actée dans le brief.

L'ancien `Home.vue` (~1500 lignes) dupliquait 5 variants quasi-identiques
(`HomeDesktop`, `HomeMultiRoleMobile`, `HomeCoachMobile`, `HomeOfficialMobile`,
`HomeAdminMobile`) avec role switcher artificiel pour les users multi-rôles
et data loading non-scopé. Le refactor PR-M le remplace par **un seul
template Home** + **sections conditionnelles** empilées par rôle, dans un
ordre fixe (Coach → Officiel → Admin → Joueur). Pas de role switcher : un
user `coach + admin` voit les deux univers ensemble.

### Architecture cible

- **`Home.vue` (≤ 150 lignes)** — coquille qui choisit `CbMobileShell` vs
  `CbDesktopShell` via `useViewport()` puis empile les sections conditionnelles
  selon `auth.isCoach / isOfficial / isAdmin / isPlayer`. Si aucun rôle → `HomeEmpty`.
- **`components/home/HomeCoachSection.vue`** — bloc coach (équipes,
  registrations à traiter, license reviews, exclusions cotisation,
  planning court terme).
- **`components/home/HomeOfficialSection.vue`** — bloc officiel
  (assignations en cours, matchs ouverts au niveau, no-license banner).
- **`components/home/HomeAdminSection.vue`** — bloc admin (broadcast,
  requests pending, staffing court terme).
- **`components/home/HomePlayerSection.vue`** — bloc joueur (mes matchs,
  mes cotisations).
- **`components/home/HomeEmpty.vue`** — fallback quand `auth.roles.length === 0`.

`useShellNav()` retourne désormais `{ tabs, nav, primaryRoleLabel }` (cf.
§ Composables ci-dessous) et `CbSidebar` accepte un `CbNavItemGroup[]`
(grouping par rôle avec label section "COACH" / "OFFICIEL" / "ADMIN" /
"JOUEUR"). Le `CbNavItem[]` plat reste accepté en fallback (un seul groupe
sans titre) pour la rétro-compat.

### Règle "scope data per section"

Chaque section est **isolée** : elle ne charge ses données qu'au `onMounted`
**si** le rôle correspondant est présent. Concrètement, la coquille `Home.vue`
ne déclenche **aucun** fetch — c'est chaque sous-composant section qui appelle
son store (`teamsStore.loadForCoach` dans `HomeCoachSection`,
`assignmentsStore.loadForOfficial` dans `HomeOfficialSection`, etc.). Si
l'user n'a pas le rôle, la section n'est pas rendue, donc aucun fetch ne
se déclenche. Pattern d'idempotence obligatoire (cache hit = pas de
re-fetch), cohérent avec les autres stores du repo.

### Sélection tabs mobile

Max 4 slots : Slot 1 = Home (toujours). Slots 2-4 = 1 onglet par rôle actif
dans l'ordre Coach > Officiel > Admin > Joueur, avec l'onglet le plus
représentatif (Coach → Équipes, Officiel → Mes assignations, Admin →
Staffing, Joueur → Mes matchs). Si > 3 rôles : slot 4 devient "Plus" (sheet
avec le 4e rôle + Notifications + Profil).

### Ancien Home multi-variant (déprécié)

Les variants `HomeDesktop`, `HomeMultiRoleMobile`, `HomeCoachMobile`,
`HomeOfficialMobile`, `HomeAdminMobile` sont **remplacés** par la coquille
unifiée + les 5 composants de section ci-dessus. Toute référence à ces
variants dans le code restant doit être migrée. Le role switcher est
**supprimé** — multi-role = empilement direct.

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
| Communs | `SignIn`, `ProfileSetup`, `MemberInactiveBlocker`, `Home` (single-page unifié, sections empilées par rôle — cf. § "Menu unifié single-page"), `common/Notifications`, `common/ProfileSettings`, `DesignSystem`, `NotFound` |
| Officiel | `official/OpenMatches`, `official/MyAssignments`, `official/MatchDetail` + dialog `dialogs/CbAssignmentActionDialog` |
| Coach | `coach/MyTeams`, `coach/TeamRoster`, `coach/MemberForm` (create+edit), `coach/MemberDetail`, `coach/TeamPlanning`, `coach/TrainingAttendance`, `coach/AwayMatchCreate`, `coach/Registrations`, `coach/RegistrationDetail`, `coach/MatchMoveRequest` |
| Admin | `admin/Staffing`, `admin/StaffingDetail`, `admin/Requests`, `admin/RequestDetail`, `admin/Broadcast` |

**~22 000 lignes Vue** au total. Mock user multi-rôle (`coach + official + admin`)
pour naviguer dans toute l'app via un seul login.

### Composables disponibles

- `useViewport()` — switch responsive mobile/desktop ≥1024px.
- `useShellNav()` — retourne **3 valeurs** role-aware (refactor PR-M-A,
  2026-05-24) :
  - `tabs: ComputedRef<CbTab[]>` — tab bar mobile, max 4 items, sélection
    par priorité Coach > Officiel > Admin > Joueur.
  - `nav: ComputedRef<CbNavItemGroup[]>` — sidebar desktop, **groupée par
    rôle** (un group par rôle utilisateur, label "Coach" / "Officiel" /
    "Admin" / "Joueur").
  - `primaryRoleLabel: ComputedRef<string>` — label du rôle prioritaire
    pour l'avatar du shell.

  À utiliser pour toute nouvelle vue qui a besoin d'un shell mobile +
  desktop (évite de re-inliner les arrays `CbTab[]` / `CbNavItemGroup[]`).
  L'ancienne API exposait 9 collections (`coachTabs`, `officialTabs`,
  `adminTabs`, `playerTabs`, `multiRoleTabs`, `coachNav`, `officialNav`,
  `adminNav`, `playerNav`) — elle a été remplacée par le triplet ci-dessus.

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

### Fondation Bookings (read + coach cancel) — livrée 2026-05-24

Couche `bookings` opérationnelle en mode **hybride mock + Firestore réel**
(même pattern que `licenseRequests` / `teams`).

**Fichiers livrés** :
- `src/repositories/bookings.repo.ts` — read-only + cancel coach uniquement
  (pas de create/series/edit : ces opérations restent côté `apps/web`).
  Exporte `listBookingsForSeason(seasonId, { teamIds? })`,
  `listVenuesWithCourtsLite()`, `listTeamsLite(teamIds[])`,
  `cancelTrainingBooking({ bookingId, callerUid, note? })`.
- `src/stores/bookings.ts` — Pinia source unique `allBookings` (saison
  complète, single fetch), `venues`, `teams`. Actions
  `loadActiveContext()` (idempotent), `cancelTraining({ bookingId, note? })`,
  `invalidate()`. Getters `bookingsForTeam`, `bookingsInRange`,
  `freedUpcoming`. En mode mock : dérive depuis `MOCK_MATCHES`.
- `src/utils/bookingColors.ts` — mapping pur slotType+status → kind visuel,
  libellé FR, classe CSS `.cb-bk-*`, tone `CbPill`. Source unique des
  couleurs pour les 3 vues consommatrices.
- `src/assets/tokens.css` — classes `.cb-bk-{training,match-home,match-away,
  reserve,custom,freed,cancelled}` (fond léger + bordure 3px, dashed pour
  freed, line-through+opacity pour cancelled).
- `package.json` — ajout `vue-cal@^4.10.2` (même version qu'`apps/web`,
  cohérent pour la grille calendrier).

**Annulation coach** : write client direct via `updateDoc` —
`firestore.rules` lignes 339-342 autorisent
`affectedKeys().hasOnly(['status', 'cancelReason', 'actionLog'])`. Pas de
callable serveur nécessaire. Idempotent via `arrayUnion` (immunise des
races coach → coach).

**Convention pour les 3 vues consommatrices** :
1. **Ne JAMAIS importer `bookings.repo.ts` depuis un composant** — toujours
   via `useBookingsStore()`.
2. **Appeler `store.loadActiveContext()` au mount** — idempotent, OK en
   plusieurs vues.
3. **Filtrer côté JS** sur `store.allBookings` (`bookingsForTeam`,
   `bookingsInRange`, `freedUpcoming`). 0 re-fetch sur navigation
   semaine/mois.
4. **Couleurs** : utiliser `BOOKING_CLASS[visualKindOf(b)]` (classe wrapper)
   et `BOOKING_PILL_TONE[visualKindOf(b)]` (CbPill).
5. **Cancel** : `await store.cancelTraining({ bookingId, note })` — l'UI
   se met à jour via `allBookings` réactif (le row passe en `status: 'freed'`).

**À faire par Eliot** : `npm install` à la racine pour récupérer `vue-cal`
(dépendance ajoutée mais pas encore installée).

### Vue TeamPlanning (Planning équipe) — réécrite 2026-05-24

Vue `coach/TeamPlanning.vue` **entièrement réécrite** sur `vue-cal` v4 (MIT) —
remplace l'ancienne grille mock manuelle. Branchée sur la fondation bookings
(`useBookingsStore`).

- **3 modes Jour / Semaine / Mois** via segmented control en toolbar (mobile +
  desktop). Drill-down mois → jour via `@cell-click` (`activeView = 'day'`).
- **Plage horaire complète 00:00 → 24:00** (pas 30 min) — l'utilisateur veut
  voir toute la journée (contrairement à `apps/web` qui borne 06:00-22:00).
- **Source unique** : `bookingsStore.bookingsForTeam(teamId)` mappé vers
  `VueCalEvent[]` (start/end Date, class `cb-bk-*`, `bookingId` portée pour
  lookup au clic). 0 re-fetch sur navigation.
- **Annulation training** : clic sur un event `slotType === 'training' &&
  status === 'scheduled'` → dialog confirm + textarea note 0-200 chars →
  `bookingsStore.cancelTraining({ bookingId, note })`. Toast emerald
  "Créneau libéré" sur succès, rose avec message FR sur erreur.
- **Mobile-first** : `CbMobileShell` avec toolbar custom (segmented + nav
  prev/today/next) + label période (Intl.DateTimeFormat fr-FR) + vue-cal.
  Desktop : `CbDesktopShell` + `CbPageHead` avec actions en haut.
- **Couleurs** : classes `.cb-bk-*` overridées avec spécificité via
  `:deep(.vuecal__event.cb-bk-*)` dans `<style scoped>` (vue-cal pose la
  classe sur `.vuecal__event` hors scope Vue). Mapping `visualKindOf(b)` →
  `BOOKING_CLASS[kind]` ; pas de palette locale.
- **Shim TS vue-cal** : `src/types/vue-cal.d.ts` créé (aligné sur le shim
  `apps/web/src/types/vue-cal.d.ts`). À enrichir si on active drag/drop.

À tester par Eliot :
- Naviguer vers `/teams/:teamId/planning`.
- Switcher vue Jour / Semaine / Mois.
- Cliquer un training pour ouvrir le dialog d'annulation.
- Vérifier sur mobile que la plage 00h-24h est scrollable.

### Vue Agenda (Calendrier + Liste unifiés) — refonte 2026-05-24

Route unique `agenda` (path `/agenda`, fichier `coach/Agenda.vue`) qui
**remplace** les anciennes vues `AllBookings.vue` (route `bookings-list`) et
`FreeSlots.vue` (route `free-slots`), supprimées avec leurs routes. Entrée
principale dans la sidebar/tab bar coach (icône `CalendarDays`).
`TeamPlanning.vue` reste accessible depuis `TeamRoster` (planning par équipe,
hors menu principal).

**2 tabs** (state local, default `calendar` — pas de query string MVP) :

1. **Calendrier** — `vue-cal` v4 connecté à `useBookingsStore.allBookings`
   (saison entière du club, pas seulement teams du coach).
   - Vue Semaine par défaut, plage horaire **17h-22h** (toggle "Soir / Journée"
     bascule sur 6h-24h).
   - Toggle **"Mes équipes / Tout le club"** (default Mes équipes) — quand
     "Tout le club" : overlay des events des autres équipes avec classe
     modifier `.cb-bk-other` (opacité 0.45).
   - Toggle **"Créneaux libres"** (default ON) — inclut/exclut les events
     `status === 'freed'` du rendu.
   - Vues Jour / Semaine / Mois via segmented control. Drill-down mois → jour.
   - Click sur **mes** trainings scheduled → dialog cancel (pattern repris
     de `TeamPlanning.vue`). Click sur autres équipes → no-op silencieux.

2. **Liste** — reprend l'ancien `AllBookings.vue` :
   - Filtres locaux : fenêtre temporelle (À venir/Passé/Tout), équipe, type
     visuel (chips multi sur les 7 `BookingVisualKind`).
   - Cards à bordure gauche colorée par kind. Click → `planning/:teamId`.

**Store** : `loadActiveContext` charge désormais **TOUS** les bookings du
club (le filtre `teamIds` du fetch a été retiré). Les getters
`myTeamIds: ReadonlyArray<string>` et `isMyBooking(b)` permettent de
discriminer "mes events" vs "autres équipes" côté composant — pas d'index
composite requis. Volumétrie attendue : quelques centaines de docs par
saison, acceptable côté MVP. `bookingsForTeam` et `freedUpcoming` restent
exposés (consommés par TeamPlanning).

**Allowlist** : `agenda` remplace `bookings-list` et `free-slots` dans
`ALLOW.coach`, `ALLOW.admin`, `ALLOW.player`. Plus aucune référence aux
anciennes routes — `/bookings` et `/free-slots` retombent en 404.

### Photo licence membre (livrée 2026-05-24, PR-C)

Permet au coach d'attacher une **photo passeport** à un member depuis la fiche
détail joueur. Cette photo devient un **pré-requis** pour valider l'ensemble
des documents d'une demande de licence (transition `parent_docs_submitted →
coach_validated`). Brief complet : `docs/members/license-photo.md`.

**Fichiers livrés (PR-C)** :

- `src/components/member/MemberPhotoSection.vue` — composant réutilisable
  (thumbnail 96x96 + actions). Props : `memberId`, `photoStoragePath`,
  `photoUpdatedAt`, `canEdit`, `canDelete`. Events : `updated` / `removed`.
  Pas de Firestore direct : passe par `useMembersStore().uploadPhoto` /
  `removePhoto`. Pré-validation MIME (jpeg/png/webp) + taille (≤ 5 Mo)
  côté client + ré-validation repo.
- `src/repositories/members.repo.ts` — `uploadMemberPhoto(memberId, file)`
  (Storage `uploadBytes` puis callable `setMemberLicensePhoto`),
  `removeMemberPhoto(memberId)` (callable `removeMemberLicensePhoto`),
  `getMemberPhotoDownloadUrl(storagePath)`. Snapshot adapter étendu pour
  populer `MockMember.photoStoragePath` + `photoUpdatedAt` (ces champs
  sont devenus optionnels sur le type `MockMember`).
- `src/stores/members.ts` — actions `uploadPhoto` / `removePhoto` + patch
  in-place dans tous les caches `byTeamId` (re-render auto).
- `src/services/cloudFunctions.ts` — wrappers typés
  `setMemberLicensePhoto` / `removeMemberLicensePhoto` (PR-B). Ajoutés ici
  pour permettre l'avancement parallèle ; PR-B peut écraser si besoin.
- `src/views/coach/MemberDetail.vue` — section "Photo licence" insérée
  entre la card identité et la section cotisation. `canEdit = isCoach ||
  isAdmin`, `canDelete = isAdmin`. Refetch via `loadFromFirestore` après
  mutation pour récupérer le vrai `photoUpdatedAt`.
- `src/views/coach/LicenseRequestReview.vue` — charge le member lié à la
  `licenseRequest` (`getMemberReal(lr.memberId)`) pour évaluer
  `photoMissing`. Si manquante :
  - Banner rouge top de page avec CTA "Ouvrir la fiche membre".
  - **Tous** les boutons "Valider" (per-doc + bottom-bar) sont désactivés,
    tooltip "Photo membre requise". Refus restent actifs.
  Choix pragmatique : disable global tant que `photoMissing` (plus simple
  à raisonner pour le coach que "seul le dernier Valider est bloqué").
- `src/types/mock.ts` — `MockMember.photoStoragePath?` +
  `photoUpdatedAt?: { seconds: number } | null` (optionnels, pas de
  migration).

**Pattern picker fichier+caméra mobile** :

```html
<input type="file" accept="image/jpeg,image/png,image/webp" capture="user">
```

- `capture="user"` ouvre la caméra **frontale** par défaut sur mobile
  (idéal selfie / passeport) ;
- desktop ignore `capture` → file picker classique ;
- iOS/Android propose nativement "Prendre une photo / Galerie" via sheet
  système — pas de double bouton custom à coder.

**À déployer côté serveur** : `firebase deploy --only storage` pour les
rules `/members/{memberId}/{fileName}` (déjà posées par PR-A) + déployer
les callables `setMemberLicensePhoto` / `removeMemberLicensePhoto` (PR-B).

### Vues coach review de licence (PR2 UI) — livrées 2026-05-24

Couches livrées pour permettre au coach de valider/refuser les documents de
licence soumis par le parent (workflow `parent_docs_submitted →
coach_validated` côté serveur via la callable `coachReviewLicenseDoc`,
backend livré le même jour — cf. `docs/licenses/parent-completion-workflow.md`).

**Fichiers livrés** :
- `src/services/cloudFunctions.ts` — wrapper `coachReviewLicenseDoc(input)`
  + types `CoachReviewLicenseDocInput` / `CoachReviewLicenseDocResult`.
- `src/repositories/licenseRequests.repo.ts` —
  `listLicenseRequestsForCoach(teamIds, { status? })` (query `where teamId in
  <chunk>` chunké par 10 + filtre status JS-side + try/catch défensif +
  isPermissionDenied helper) et `getLicenseDocDownloadUrl(storagePath)`
  (résout l'URL Storage pour l'aperçu doc — retourne `null` pour les paths
  `mock://...` ou en cas d'erreur).
- `src/stores/licenseRequests.ts` — state `pendingReviewByRequestId` (Map
  reactive), actions `loadPendingReviewForCoach()` / `getPendingReview(id)`
  / `reviewDoc({ requestId, kind, decision, refusalReason? })`, getter
  `pendingReviewList` trié createdAt DESC. Optimistic update sur le cache
  (patch `coachReview` + `status` post-callable, retire la demande du cache
  si elle quitte `parent_docs_submitted`).
- `src/views/coach/LicenseRequestsToReview.vue` — liste des demandes à
  reviewer (mobile + desktop shell, card cliquable avec avatar + nom + team
  + pill amber "À valider" + chevron).
- `src/views/coach/LicenseRequestReview.vue` — détail per-doc : section par
  doc avec méta fichier + lien aperçu (downloadURL Storage) + boutons
  Valider / Refuser + dialog motif refus (textarea 5–500 chars + counter)
  + BottomBar récap "X/Y validés" + toasts emerald/rose/sky. Quand tous
  validés → toast info "Demande validée et transmise au trésorier" puis
  retour à la liste.
- `src/router/index.ts` — routes `license-reviews` (path
  `/license-reviews`) + `license-request-review` (path
  `/license-reviews/:requestId`).
- `src/router/allowlist.ts` — `'license-reviews'` +
  `'license-request-review'` ajoutés à `ALLOW.coach`.
- `src/components/home/HomeCoachSection.vue` — card "Demandes de licence
  à valider" affichée conditionnellement (`licenseReviewsCount > 0`) dans
  la section coach du Home unifié (cf. § "Menu unifié single-page"). Pas
  d'item séparé dans la sidebar / tab bar — accès via Home ou deep link
  `/license-reviews`.

  (Avant le refactor PR-M, cette card vivait directement dans `Home.vue`
  variantes coach mobile + desktop ; elle a été migrée dans la section.)

**Pattern hybride mock + Firestore réel** :
- Mode firestore : `listLicenseRequestsForCoach` query Firestore + callable
  `coachReviewLicenseDoc` réelle ; le store met à jour le cache
  optimistement.
- Mode mock : fallback sur `MOCK_LICENSE_REQUESTS.filter(status ==
  'parent_docs_submitted')` (le fixture `lr-sarah-2025` matche). Le
  `reviewDoc` mock log-only via `logMockAction` + simule un patch local du
  cache pour que l'UI reflète l'action sans backend.

**À tester par Eliot** :
- Mode réel : créer une demande de licence avec `status:
  parent_docs_submitted` + `uploadedDocs` peuplé (via parcours complet
  parent dans `courtbase-register`), puis naviguer dans
  `courtbase-app /license-reviews`. Vérifier que la liste affiche la
  demande, que l'aperçu fichier ouvre une nouvelle fenêtre, que
  Valider/Refuser appelle la callable et que la demande quitte la liste
  quand tous les docs sont validés.
- Mode mock (dev sans backend) : fallback `lr-sarah-2025` doit apparaître
  dans la liste, et un click sur Valider doit logguer
  `licenseRequests.reviewDoc` dans la console.

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
