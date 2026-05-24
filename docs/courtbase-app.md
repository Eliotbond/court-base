# courtbase-app — Companion app du club (mobile-first, web)

> Brief produit. Remplace `mobile-app.md` (Flutter, déprécié 2026-05-23 — pivot abandonné pour cause de coût de packaging stores). L'app reprend **les mêmes audiences et les mêmes features** mais sur la stack web du monorepo.
>
> Spec métier : `docs/main.md`. Schéma Firestore : `docs/firebase.md`. App admin desktop équivalente : `apps/web` + `docs/frontend-desktop.md`. App publique inscriptions : `apps/courtbase-register` + `docs/chantier-registrations.md`.

## Pourquoi cette app (et pas étendre `apps/web`)

`apps/web` est l'app **admin desktop** — large layout, drawers, tableaux denses, navigation par sidebar. Les audiences "non-admin" (coach, officiel) la trouvent lourde sur mobile et y voient trop de surface.

`courtbase-app` est leur **client quotidien** :
- **Mobile-first** (375px de base, scale jusqu'à 1280px+).
- **Shell restreint** : router allowlist par rôle, pas de membres / teams / bookings hors scope.
- **PWA installable** (icône home screen, splash, mode standalone).
- **Mêmes Firebase callables** et **mêmes rules** que `apps/web` — pas de duplication de logique métier, on consomme le même backend.

Pour un admin qui veut gérer le club au bureau, `apps/web` reste l'outil. Pour un coach qui prend des présences en bord de terrain ou un officiel qui confirme une assignation depuis le bus, c'est `courtbase-app`.

## Stack

| Layer | Tech |
|---|---|
| Framework | Vue 3 + Vite + TypeScript strict |
| UI | PrimeVue + Tailwind (mêmes tokens que `apps/web`, le design system suit) |
| State | Pinia (`stores/`) |
| Router | Vue Router (`router/index.ts`) + allowlist par rôle |
| Backend | Firebase Web SDK (Auth, Firestore, Functions, Storage, Messaging) |
| Push | FCM Web Push (Service Worker) — limité iOS sauf PWA installée (iOS 16.4+) |
| PWA | `vite-plugin-pwa` (manifest + SW + offline shell minimal) |

Conventions identiques au reste du monorepo (cf. racine `CLAUDE.md`) : architecture en couches `components → composables → stores → repositories → Firebase`, try/catch défensif sur tout appel Firestore/callable, FR uniquement.

## Hosting

- Hosting target Firebase **distinct** (`courtbase-app`), même projet Firebase que le club (one-project-per-client).
- URL conventionnelle : `app.{tenant}.courtbase.ch` (ou équivalent par client). Le portail public d'inscription reste sur `register.{tenant}.courtbase.ch`.
- Build CI : extension du workflow déjà en place pour `apps/web` + `apps/courtbase-register`.

## Audiences & features

Toutes les features ci-dessous **existent déjà** côté backend (callables, rules, fanout). Le travail de cette app = surface UI mobile-first. Pas de nouvelle Cloud Function.

### Coach

| Feature | Source de vérité backend |
|---|---|
| Voir ses équipes + effectif (badges licence / cotisation) | `/teams` filtré sur `coachIds`, `/members` filtré sur `teamIds[]` |
| Créer / éditer / désactiver un joueur | Callables `coachCreateMember` / `coachUpdateMember` / `coachDeactivateMember` |
| Planning d'équipe (vue jour + semaine) | `/bookings` filtré sur `teamId` |
| Attendance d'un training (présent / absent / excusé) | `/bookings/{id}/attendance` (write coach scoped) |
| **Exclusion enforcement** : joueur `duesStatus == "excluded"` → pas d'option "présent", coach marque absent/refusé | UI guard + rule `/attendance` enforce |
| **Badge "exception pending"** sur joueur `excepted` (train normalement) | Lecture `/paymentExceptionRequests` |
| Soumettre une `paymentExceptionRequest` (motivation libre) | Direct write `/paymentExceptionRequests` (rule coach scoped) |
| **Demande de licence** : depuis fiche joueur (CO4) ou kebab sur roster (CO2). Gate cotisation `duesStatus ∈ {paid, pending_grace, excepted}`, parent reçoit un email pour compléter les pièces | Direct write `/licenseRequests` puis callable `requestLicenseDocuments` (Phase backend) — cf. [`docs/licenses/parent-completion-workflow.md`](licenses/parent-completion-workflow.md) |
| Ad-hoc booking (réserver un slot `freed` / `reserve` pour son équipe) | Direct write `/bookings` (rule coach scoped) |
| Cancel un training de son équipe | Update `/bookings/{id}.status = freed` |
| Créer un match à l'extérieur | Callable `coachCreateAwayMatch` |
| Demande de déplacement d'un `match_home` | Direct write `/matchRequests` |
| Gestion des inscriptions de ses équipes (essai en cours, confirmer, refuser) | Callables `markTrialInProgress` / `confirmRegistration` / `refuseRegistration` |

### Officiel

| Feature | Source backend |
|---|---|
| Voir les matchs à pourvoir (domicile + extérieur), filtrés à son niveau | `/bookings` `slotType in [match_home]` + `/matches` `kind == away`, jointures `officialAssignments` |
| Voir ses propres assignations (pending / confirmed / declined) | `/bookings/{id}/officialAssignments` + `/matches/{id}/officialAssignments` filtré sur `memberId` |
| **Self-register** sur un slot ouvert (gaté par `member.officialLicense != null` côté rule) | Direct write `officialAssignment` `status: 'pending'` |
| Confirmer / décliner une assignation créée par admin | Update `officialAssignment.status` |
| Notifs in-app (badge unread via `readBy[]`) + push FCM | `/notifications` + trigger `fanoutNotification` (déjà déployé) |
| Ajouter le match à son calendrier | Génération `.ics` côté client (fallback du `add_2_calendar` Flutter) |
| Rappels J-1 (23:00) + H-2 | Backend (`matchReminders` scheduled Function, **déjà en place**) — l'app reçoit le push, plus de notifs locales |

### Admin restreint (mobile)

Sous-ensemble de `apps/web` pour gérer en mobilité :

| Feature | Source |
|---|---|
| Liste des matchs à pourvoir cross-club + override staffing | `/matches` + `/bookings` `slotType: match_home` |
| Assigner / retirer un officiel sur un slot | Write `officialAssignments` (rule admin) |
| Approuver / rejeter `matchRequest` | Callable `processMatchRequest` (admin) |
| Approuver / rejeter `paymentExceptionRequest` | Direct write (admin scope) |
| Approuver / rejeter `licenseRequest` | Direct write (admin scope) |
| Envoyer une notif manuelle (`urgent`, `officials_needed`, etc.) | `addDoc /notifications` (le trigger `fanoutNotification` push) |

L'admin **plein** reste sur `apps/web` (settings, comptabilité, venues & courts, seasons, etc.). `courtbase-app` est explicitement un outil **terrain**, pas une console.

## Shell restreint — allowlist par rôle

Le router refuse toute route non-listée pour le rôle du user. Pattern identique à `apps/web` mais inversé : ici c'est **deny par défaut**, allow explicite.

```ts
// router/allowlist.ts (sketch)
const ALLOW: Record<UserRole, RouteName[]> = {
  coach:    ['home', 'team', 'team-roster', 'member', 'member-edit',
             'planning', 'training-attendance', 'away-match-create',
             'registrations', 'notifications'],
  official: ['home', 'matches-open', 'my-assignments', 'match-detail',
             'notifications'],
  admin:    ['home', 'staffing', 'staffing-detail', 'requests',
             'license-requests', 'notifications', 'broadcast'],
}
```

Un user avec **plusieurs rôles** voit la **union** des routes. La home est un **single-page unifié** (cf. § "Home unifié single-page" ci-dessous) qui empile les sections par rôle dans l'ordre fixe Coach → Officiel → Admin → Joueur ; pas de role switcher. Le tab bar mobile en dérive (max 4 slots, sélection par priorité de rôle).

## Home unifié single-page

> Refactor 2026-05-24 (PR-M). Brief produit : `docs/courtbase-app/menu-refactor.md`. Détails d'implémentation : `apps/courtbase-app/CLAUDE.md` § "Menu unifié single-page".

L'écran d'accueil est **un seul template** quelle que soit la combinaison de rôles de l'utilisateur. Plutôt qu'un role switcher artificiel, les **sections** propres à chaque rôle (Coach / Officiel / Admin / Joueur) sont empilées dans cet ordre fixe et n'apparaissent que si l'utilisateur porte le rôle. Un user `coach + admin` voit donc les deux univers ensemble, sans bascule. Un user sans rôle voit un fallback `HomeEmpty` (situation théorique post-`acceptInvitation` qui n'aurait pas posé de rôle).

Chaque section charge ses données indépendamment au mount (idempotent — pas de re-fetch si déjà chargé). Si un rôle est absent, sa section n'est pas rendue, donc aucun fetch ne se déclenche pour ce périmètre.

La sidebar desktop suit le même principe : un groupe (`CbNavItemGroup`) par rôle, avec un label section ("COACH" / "OFFICIEL" / "ADMIN" / "JOUEUR"), pour que la navigation reflète visuellement les périmètres dont l'utilisateur dispose.

## Membre inactif — accès coupé

Règle **identique** à celle de l'ex-app Flutter (cf. `docs/main.md` → "Membre actif / inactif", helper `callerSuspended()` de `firestore.rules`).

Au boot de l'app post-login :
1. Charger `/users/{uid}` puis, si `user.memberId` présent, le membre lié.
2. Si `linkedMember.active === false` → afficher un **écran blocant** "compte inactif — contactez le club ou réinscrivez-vous via le portail d'inscription" (lien vers `courtbase-register`).
3. Pas de routage vers les routes coach/official/admin tant que ce check n'est pas passé.

`birthDate == null` ou pas de membre lié → traité comme actif (cohérent avec le helper rules). Les comptes **staff pur** (admin/coach/treasurer/secretary sans linkedMember inactif) ne sont jamais bloqués.

## Notifications push — FCM web push

### Setup
- Service Worker `firebase-messaging-sw.js` (généré par `vite-plugin-pwa` + import du SDK Firebase Messaging).
- Demande de permission à un moment **utile** (pas au démarrage froid) — typiquement après que l'officiel a confirmé sa première assignation ou que le coach a ouvert une équipe.
- Token FCM stocké dans `/users/{uid}/fcmTokens/{token}` (collection déjà en place côté backend, rule + trigger `fanoutNotification` opérationnels).

### Limites navigateur

| Plateforme | Push supporté | Notes |
|---|---|---|
| Chrome / Firefox / Edge (desktop) | ✅ | OK direct |
| Android Chrome | ✅ | OK direct |
| iOS 16.4+ Safari | ⚠️ | Push web **uniquement** si l'app est installée comme PWA depuis le home screen |
| iOS < 16.4 | ❌ | Pas de push web possible. Fallback : in-app notifications + emails. |

Conséquence UX : l'app **doit** proposer l'installation PWA aux users iOS (banner "Ajouter à l'écran d'accueil pour recevoir les notifications"). C'est le seul chemin viable côté Apple sans repasser par un vrai binaire App Store.

### In-app
- Liste paginée `/notifications` (read filtré par `targetAudience` + déduplication via `readBy[]`).
- Badge non-lus dans le tab bar.
- Deep-link sur tap : `notification.deepLink` → route correspondante (`/match/{id}`, `/registration/{id}`, etc.) — convention identique à celle utilisée par le backend Flutter.

## Ce qu'on perd / regagne vs Flutter

### Perdu (ou dégradé)

- **Notifications locales planifiées** côté device (J-1 + H-2) → on s'appuie sur le **scheduled push backend** (`matchReminders`) qui existe déjà. Trade-off : nécessite connexion au moment du push (pas de notif "offline" planifiée localement).
- **Add to Calendar natif** → remplacé par génération `.ics` côté client + lien Google Calendar deep-link. Une vraie capacité native disparaît, mais l'UX reste proche.
- **App Store discoverability** → nulle. Compensée par lien direct envoyé par le club aux membres.

### Regagné

- **Mise à jour instantanée** (CI/CD comme `apps/web`), pas de review Apple/Google.
- **Stack unifié** avec `apps/web` et `apps/courtbase-register` — réutilisation directe des types (`packages/shared-types`), repos, composants UI (PrimeVue + Tailwind).
- **Pas d'iOS APNs `.p8`** à uploader. Pas de signing Xcode, pas de Provisioning Profiles, pas de Play Console à payer.
- **Zéro friction d'install** sur Android (clic lien → PWA). iOS reste 2 taps de plus.

## Migration depuis le code Flutter

`apps/mobile/` reste dans le repo (état "deprecated" — cf. `docs/mobile-app.md`). À **ne pas** continuer à développer, mais à utiliser comme **référence fonctionnelle** :

- Les **callables backend** consommées par l'app (`coachCreateMember`, `coachUpdateMember`, `coachDeactivateMember`, `coachCreateAwayMatch`, `markTrialInProgress`, `confirmRegistration`, `refuseRegistration`, `acceptInvitation`, `fanoutNotification` trigger…) sont **déjà déployées** côté Functions. Aucune nouvelle Function à écrire pour démarrer.
- Les **modèles Dart** (`apps/mobile/lib/models/`) sont alignés sur `docs/firebase.md` ; les types TypeScript équivalents vivent déjà dans `packages/shared-types`.
- L'écran-par-écran de la Flutter app est documenté dans `docs/mobile-app.md` § "État de livraison" — sert de spec d'arrivée pour la PrimeVue version.

Une fois `courtbase-app` livré et déployé en prod sur le projet pilote, `apps/mobile/` peut être **supprimé** dans une PR de clean-up séparée.

## État livré (2026-05-23)

> Phases 0-4 livrées en **mode mock-data** sur une session intensive (un agent Opus 4.7 par vue). Login Firebase Auth **réel** branché. Voir mémoires `courtbase_app_scaffold_done`, `courtbase_app_views_mock_done`, `courtbase_app_literal_rewrite`, `courtbase_app_auth_hybrid` pour les détails.

### Scaffold + design system (Phase 0)

- `apps/courtbase-app/` : Vite + Vue 3 + TS strict + PrimeVue (preset emerald) + Pinia + Vue Router + Firebase Web SDK + `vite-plugin-pwa` + Tailwind (preflight off) + `lucide-vue-next`.
- `src/assets/tokens.css` (~600 lignes) — design tokens + classes utilitaires `.cb-*` portés littéralement du bundle claude.design (rendu via `claude.ai/design`, fetché en gzip, extrait dans `/tmp/courtbase-app-design/`).
- **16 primitives `Cb*`** dans `src/components/ui/` (`CbMobileShell`, `CbDesktopShell`, `CbHeader`, `CbTabBar`, `CbSidebar`, `CbPageHead`, `CbPill`, `CbAvatar`, `CbMemberRow`, `CbMatchCard`, `CbMatchTypeChip`, `CbEmptyState`, `CbBottomBar`, `CbBanner`, `CbNotifItem`, `CbSkel`) + `CbMockBadge` (badge "Données simulées" persistant) + `CbAssignmentActionDialog`.
- `src/composables/useViewport.ts` — switch responsive mobile/desktop ≥ 1024px.
- `src/composables/useShellNav.ts` — retourne `{ tabs, nav, primaryRoleLabel }` role-aware (refactor PR-M-A, 2026-05-24) : tab bar mobile + sidebar `CbNavItemGroup[]` groupée par rôle + label rôle prioritaire pour l'avatar du shell. À utiliser pour toute nouvelle vue (évite la duplication des arrays).
- Showcase visuel sur `/_design` (route hors auth) — reproduit toutes les primitives + frames mobile/desktop.

### Auth réel (Phase 1, partiel)

- `src/services/cloudFunctions.ts` — wrapper callable `acceptInvitation`.
- `src/repositories/users.repo.ts` — Firebase Auth ops + `NotAuthorizedError` + `tryAcceptInvitationOrSignOut` (deny-orphan).
- `src/stores/auth.ts` — **vrai store Firebase Auth** avec `subscribeAuthState` + pattern `waitForNextAuthSettled` (anti-race OAuth). Cf. `courtbase-register/stores/auth.ts` pour le même pattern.
- `src/views/SignIn.vue` — port littéral du JSX bundle. Mobile : layout centré épuré (logo + h1 + 3 boutons OAuth + lien help + footer version). Desktop : **split-screen 1.1fr / 1fr** avec panel gauche gradient `slate-900 → slate-800` (hero marketing "L'outil de terrain du BC Aigles." 38px) et panel droit fond blanc avec form max-width 360px.
- Erreurs Firebase mappées en FR (`auth/invalid-email`, `auth/wrong-password`, `auth/user-disabled`, `auth/email-already-in-use`, `auth/weak-password`, `auth/popup-blocked`, `auth/network-request-failed`, `NotAuthorizedError`).
- Router : `auth.init()` + `waitForProfileResolution()` dans `beforeEach`.

### 24 vues livrées (Phases 2-4)

| Audience | Vues |
|---|---|
| Commun | SignIn, ProfileSetup, MemberInactiveBlocker, Home (single-page unifié — cf. § "Home unifié single-page"), Notifications, ProfileSettings |
| Officiel | OpenMatches, MyAssignments, MatchDetail + dialog CbAssignmentActionDialog |
| Coach | MyTeams, TeamRoster, MemberForm (create+edit), MemberDetail (+ 3 dialogs inline), TeamPlanning (week + day strip), TrainingAttendance (avec enforcement exclusion), AwayMatchCreate, Registrations, RegistrationDetail, MatchMoveRequest |
| Admin | Staffing, StaffingDetail, Requests, RequestDetail, Broadcast |

**Total : ~17 500 lignes Vue**. 15 vues sur 24 sont des **transcriptions littérales du JSX bundle** (les 4 admin + ProfileSetup gardent l'interprétation initiale).

### Couche mock (transitoire)

- `src/repositories/mock/seeds.ts` + `src/repositories/mock/index.ts` — source unique de simulation : 12 joueurs (Mathieu, Sarah, Léo, Inès, Tom, etc.), 3 équipes (U16M Compétition, U14F Loisir, U18M Élite), 4 matches (CSJC, AFBB, Amical, futur), 5 notifications, 3 requests (1 par kind), 3 registrations.
- `src/types/mock.ts` — types autonomes (pas d'import depuis `shared-types`).
- Mutations **log-only** via `logMockAction(action, payload)`. Aucune mutation persistée — voulu pour éviter divergence entre vues.
- **Pattern hybride auth** : le store auth combine Firebase Auth réel (uid/displayName/email) avec un fallback mock pour `linkedMember`, `roles`, `officialLevel` tant que les vraies repos métier ne sont pas branchées. Conséquence : n'importe quel user signed-in voit les données mock de Mathieu. Cf. mémoire `courtbase_app_auth_hybrid`.

### Décisions notables prises en cours de session

1. **Pivot Flutter → PWA web** (matin 2026-05-23) : abandon du chantier `apps/mobile/` (coût packaging stores trop élevé). Le code Flutter reste en archive, deprecated. Backend (5 callables coach* + fanoutNotification trigger) **reste opérationnel** côté Functions — `courtbase-app` consomme exactement les mêmes.
2. **App name** : `courtbase-app` (slug du dossier `apps/courtbase-app/`).
3. **Deny-orphan auth** (comme `apps/web`, **pas** comme `courtbase-register`) — un orphan tente `acceptInvitation`, sinon signOut + toast erreur.
4. **Tailwind preflight: false** — le reset CSS vit dans `tokens.css` pour ne pas écraser PrimeVue.
5. **`@import` avant `@tailwind` dans `style.css`** — sinon ignoré silencieusement par le browser (cf. mémoire `css_import_order_trap` — bug vécu pendant cette session, font Times New Roman sur la première capture d'Eliot).
6. **2 batches d'agents pour les vues** :
   - Batch 1 (24 vues mock) — agents interprétaient le brief + JSX → écart visuel.
   - Batch 2 (15 vues — Home + Officiel + Coach) — instruction stricte de transcription littérale du JSX avec range exact (`/tmp/courtbase-app-design/courtbase-app/project/screens/<file>.jsx` + lignes X-Y). Résultat : -20% de lignes Vue, fidélité visuelle meilleure.
7. **Admin (A1-A4) gardent l'interprétation initiale** — Eliot a explicitement priorisé Home/Officiel/Coach. Refonte admin possible plus tard si écart constaté.
8. **Pas de `<style scoped>` qui invente** — toutes les variations visuelles passent par `.cb-*` (tokens.css) ou `style="..."` inline littéral comme dans le JSX bundle. Règle dure de la stratégie de rewrite.
9. **Composable `useShellNav`** créé en post-batch pour mutualiser les `coachTabs`/`officialNav`/etc. — les 24 agents les avaient inlinés chacun de leur côté.
10. **CbMatchCard click event** + **CbMemberRow hideChev prop** + **CbAvatar tone slate** — refactors mineurs ajoutés en passe d'audit (workarounds repérés dans les outputs agents).

### À venir

- **Phase 1.5** : brancher les vraies repos Firestore (members/teams/matches/registrations/notifications/requests/dues) → retirer le fallback mock du store auth → retirer `<CbMockBadge />`.
- **Phase 5** : Service Worker FCM + permission prompt contextualisé + banner iOS "Ajouter à l'écran d'accueil" (push web limité à PWA installée sur iOS 16.4+).
- **PR séparée déploiement** : convertir `firebase.json` en multi-target hosting (web, register, courtbase-app), `.firebaserc` targets, CI workflow.
- **Fix infra TS** avant premier `npm run build` propre : `@tsconfig/node24` lib options incompatibles avec TS 5.x, `@vue/tsconfig/tsconfig.dom.json` manquant, `@primeuix/utils` moduleResolution.
- **Refonte admin** (5 vues) si Eliot demande après revue visuelle.

## Roadmap d'implémentation

### Phase 0 — Scaffold (1-2 jours)
- `apps/courtbase-app/` Vite + Vue + TS + PrimeVue + Tailwind + Pinia + Vue Router + Firebase Web SDK.
- Reprendre la config (paths absolus `@/`, tsconfig strict, `vue-tsc --noEmit`) de `apps/courtbase-register`.
- `vite-plugin-pwa` + manifest minimal (icône, splash, theme color).
- Hosting target `courtbase-app` ajouté à `firebase.json`.
- Skeleton router avec garde d'auth + allowlist par rôle.

### Phase 1 — Shell + auth + home (1-2 jours)
- Sign-in (Google / Apple / email + magic link optionnel) — réutilise la logique de `apps/courtbase-register/src/repositories/auth.repository.ts`.
- Deny-orphan + acceptInvitation (callable existante).
- Profile completion (premier sign-in si `profileCompletedAt` absent).
- Membre inactif blocker.
- Tab bar role-aware.
- Notifications list + badge unread + deep-link router.

### Phase 2 — Officiel (2-3 jours)
- Matches à pourvoir (filtré niveau + tri par date).
- Self-register (rule check + UI gate sur `member.officialLicense`).
- Mes assignations (3 colonnes par status).
- Détail match (info opponent, venue, autres officiels assignés, CTA confirm/decline/self-register).
- Génération `.ics` + lien Google Calendar.

### Phase 3 — Coach (3-5 jours)
- Mes équipes (liste).
- Effectif (badges licence / cotisation, exclusion / exception).
- Member form (create / edit / désactiver).
- Planning équipe (vue jour, swipe semaine).
- Attendance (présent / absent / excusé, enforcement exclusion).
- Soumettre `paymentExceptionRequest`.
- Toggle licence (`licenseRequest`).
- Booking ad-hoc.
- Cancel training.
- Créer match away.
- Demande de move match home (`matchRequest`).
- Gestion inscriptions (markTrial / confirm / refuse).

### Phase 4 — Admin restreint (1-2 jours)
- Liste matches à pourvoir cross-club.
- Override staffing (assign / retirer officiel).
- Liste requests (match / payment exception / license).
- Approve / reject avec commentaire.
- Broadcast (`addDoc /notifications` avec targetAudience).

### Phase 5 — PWA + push (1-2 jours)
- Service worker FCM.
- Banner "Ajouter à l'écran d'accueil" sur iOS (détection user-agent).
- Permission prompt contextualisé (post first useful action).
- Tester sur Android (Chrome) + iOS 16.4+ (PWA installée).

### Phase 6 — Polish + offline-light (optionnel, 1-2 jours)
- Skeleton loaders.
- Pull-to-refresh sur listes.
- Cache Firestore léger (persistance par défaut suffit pour MVP).
- Snackbar/toast pour feedback callables.

## Hors scope v1

- **Offline-first complet** (writes en file d'attente). On garde le cache Firestore par défaut, mais une `markDuePaid` offline qui sync 6h plus tard n'est pas dans le scope MVP.
- **App native iOS / Android** : si à terme un client demande une vraie app store (visibilité, paiements In-App, etc.), on rouvrira le chantier sur une base déjà éprouvée fonctionnellement.
- **Multilingue** : FR uniquement, comme le reste du monorepo.
- **Mode sombre** : pas avant que `apps/web` ne l'ait (cohérence design system).

## Décisions notables

| Décision | Pourquoi |
|---|---|
| Vue 3 + PrimeVue (et pas React Native / Capacitor / autre) | Réutilisation directe du stack et du design system du monorepo. Pas de nouvelle compétence à embarquer. |
| Hosting target distinct (pas une route de `apps/web`) | Permet une UX et un build totalement différents (mobile-first, shell restreint, PWA isolée). Évite que la home admin charge le bundle officiel/coach et inversement. |
| PWA + FCM web (et pas WebView dans un wrapper Capacitor) | Capacitor demande quand même un Apple Developer + Xcode + soumission stores. Bénéfice marginal vs PWA pure pour notre cas d'usage. |
| Pas de retry queue offline pour les writes | Couvre 95% de l'usage (terrain = connexion ok 98% du temps). Pas la peine de payer la complexité aujourd'hui. |
| `apps/mobile/` conservé en archive | Référence fonctionnelle utile pendant la migration. Sera supprimé une fois prod stable. |
