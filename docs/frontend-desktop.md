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

## Officials sur le web — page `/officials`

Page admin à **onglets** (accès `admin` / `rootAdmin` uniquement — les officiels travaillent sur mobile, pas de login web officiel). Deux onglets :

### Onglet "Assignations" (par défaut)

Pilotage du staffing des matchs — **à domicile et à l'extérieur**.

- **Tableau de tous les matchs** (`/matches`, `kind` `home` et `away`) avec, pour chaque match, une pastille Lieu (Domicile / Extérieur) et son statut de staffing : nombre d'officiels confirmés vs requis. Les besoins viennent de `matchType.homeOfficialRequirements` (ventilé par niveau) pour un match à domicile, de `matchType.awayOfficialCount` (total simple) pour un match à l'extérieur. Un match sans besoin (`awayOfficialCount: 0`) est marqué "Aucun requis".
- **Panneau de détail par match** : assigner un officiel, override une assignation, ou retirer un officiel. Les `officialAssignments` créés par l'admin démarrent en `status: 'pending'` — l'officiel confirme ou décline ensuite depuis le mobile (même flow qu'une auto-inscription). Le parent Firestore dépend du `kind` : `/bookings/{id}/officialAssignments` pour un match à domicile (porté par le booking), `/matches/{id}/officialAssignments` pour un match à l'extérieur (pas de booking).
- **Notifications manuelles** : l'admin envoie une notif (collection `/notifications`) avec un `type` (`officials_needed`, `urgent`, …) et une audience (`all_officials`, `unassigned_officials`, `assigned_officials`). `relatedBookingId` est renseigné pour un match à domicile, `null` pour un match à l'extérieur.

### Onglet "Officiels"

- **Liste rentabilité** : charge par officiel (nombre de matchs sur la saison) avec code couleur selon les seuils de `config/club.officialsConfig` (cf. `main.md` → "Officials — indicateurs de rentabilité").
- **Export CSV** : bouton "Exporter (CSV)" pour l'export de fin de saison des assignations par membre (les officiels sont payés).

### Hors de cette page

Le niveau d'un officiel (`member.officialLevel`) et la liaison de son compte Auth se règlent dans la **fiche membre** (`/members/{id}`), pas sur `/officials`. La config des besoins officiels par type de match (`matchType.homeOfficialRequirements`) se fait dans Settings → Match types.

## UI library — PrimeVue

Formulaires, tables, dialogs, menus. Pas de composant calendrier-scheduler côté PrimeVue (`Timeline` ≠ scheduler ; `DatePicker` = date picker only). Pour le planning bookings on utilise **vue-cal v4 MIT** (cf. §Bookings ci-dessous).

## Bookings calendar — vue-cal v4 (MIT)

**Choix arbitré 2026-05-14.** Alternatives écartées :
- **PrimeVue** : aucun composant scheduler dispo.
- **Schedule-X** : la `Time grid resource view` (courts en colonnes = notre besoin) est en **premium payant** (~500€/an).
- **FullCalendar** : core MIT mais `@fullcalendar/resource-timegrid` aussi payant (~480€/an).
- **Grille custom** : option viable mais ~600 lignes à maintenir + pas de drag/drop/resize gratuits.

vue-cal v4 (`vue-cal` sur npm) coche tout : MIT, Vue 3, feature `splits` = courts en colonnes dans la vue jour, drag/drop + resize disponibles via plugin (non activé pour MVP), thématisable via `:deep()` CSS pour matcher tailwind.

**Concepts clés vue-cal** :
- **`splits`** : array `{ id, label, class?, hide? }` — chaque entrée est une colonne dans la vue jour. On y mappe `${venueId}__${courtId}`. Les events portent le même composite dans leur prop `split` pour s'aligner.
- **Vue active** : passée via `v-model:active-view` (`'day'` | `'week'` | `'month'`). Les splits ne s'appliquent **qu'en vue jour** — passer `:split-days="[]"` ailleurs.
- **Events** : `{ start, end, title, class, split, … }`. `start`/`end` au format `YYYY-MM-DD HH:MM` (heure locale) ou `Date`. On porte le `bookingId` en clé custom pour retrouver le booking au clic.
- **Pas de types TS** shipped par la lib — shim minimal dans `apps/web/src/types/vue-cal.d.ts`.
- **CSS** : import unique `import 'vue-cal/dist/vuecal.css'` (dans `Bookings.vue` aujourd'hui). Overrides via `:deep(.vuecal__event.<class>)` — éviter `!important`.

**Source unique des données** : `useBookingsStore().allBookings` (toute la saison, single fetch via `listAllBookingsForSeason`). vue-cal filtre client-side selon `selectedDate` + `activeView`. **Plus de query par range hebdomadaire** (`listBookingsInRange` supprimée 2026-05-14) — la navigation `<` `>` `Aujourd'hui` est purement client-side, aucun re-fetch.

**Limitations connues / extensions possibles** :
- Drag/drop + resize non branchés (importer `vue-cal/dist/drag-and-drop.es.js` + plugin si besoin).
- Clic sur cellule vide n'ouvre pas le dialog création (event `cell-click` dispo, à brancher si voulu).
- Pas de virtualisation — OK tant que `< ~1000 bookings/saison` (la query repo est documentée pour cette borne).

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
