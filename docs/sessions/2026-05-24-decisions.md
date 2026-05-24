# Session 2026-05-24 — décisions & livrables

> Compilation des décisions importantes et de ce qui a été livré pendant la
> session du 2026-05-24. Pour le détail produit/implémentation, voir les
> briefs et CLAUDE.md référencés.

## 1. License request — refus trésorier asymétrique

**Décision** : le trésorier peut refuser une demande de licence **dès
`parent_docs_submitted`**, sans attendre la validation coach. L'approbation
reste strictement gated sur `coach_validated` + tous les docs trésorier
acceptés.

**Pourquoi** : si le trésorier détecte un faux document ou une info erronée
avant que le coach n'ait fini sa review, lui faire attendre est gaspillage
de temps. La validation coach reste un pré-filtre qui **soulage** le
trésorier mais n'est pas bloquant pour un refus motivé.

**Implémentation** :
- `functions/src/licenses/validateLicenseRequest.ts` — pré-conditions
  asymétriques :
  - `approve` : `status === 'coach_validated'` (strict)
  - `reject` : `status ∈ {parent_docs_submitted, coach_validated}` (inclusif)
- `apps/web/src/views/licenses/LicenseRequestReview.vue` — introduit
  `canReject` (status ∈ {parent_docs_submitted, coach_validated}) et
  `canApprove` (strict). Bouton "Refuser la demande" enabled dès l'arrivée
  des docs parent.
- 3 nouveaux tests dans `validateLicenseRequest.test.ts` (10/10 passent).
- Docs : `docs/licenses/parent-completion-workflow.md` mis à jour.

## 2. Bookings — vue semaine par défaut + sélecteur période

**Décision** :
- Vue par défaut du calendrier `/bookings` passe de `'day'` → `'week'`.
- Sélecteur période repris de `MatchBookingPicker` : "Toute la journée" /
  "Matin (06-12)" / "Après-midi (12-16)" / "Soir (16-22)". Default = toute
  la journée. Caché en vue mensuelle (sans effet).
- Events vue-cal portent un champ `content` secondaire affichant
  **numéro de court · nom du coach**. Crucial en vue semaine où les splits
  par court ne sont pas rendus (vue-cal v4 limitation).

**Fichier** : `apps/web/src/views/Bookings.vue` (+~50 lignes).

## 3. Connexions manquantes branchées (3 agents parallèles)

**Dashboard `apps/web`** :
- `seasonLabel` hardcoded `'2025-26'` → branché sur
  `useSeasonsStore().activeSeason?.name` avec fallback `'—'`.

**Sidebar badges `apps/web`** :
- Badge "Cotisations" branché sur `useCotisationsStore().stats.overdue.count`
  (caché si 0, `'99+'` si > 99). Gated `rootAdmin || roles.includes('admin')`
  pour éviter `permission-denied` côté coach/parent.
- Badges "Payment exceptions" + "Notifications header" **supprimés** — pas de
  store live exploitable. Préférable au mensonge.

**`ProfileSettings.vue` `apps/courtbase-app`** :
- Nouveau store `useMyProfileStore` qui charge member réel + contact privé +
  équipes en parallèle.
- Champs passés en Firestore réel : `phone`, `address`, `linkedMember`
  (firstName/lastName), équipes label, contact privé (email/phone) avec édition.
- Édition contact privé : write client direct via
  `setDoc('/members/{id}/private/contact')` (rules autorisent `isLinkedMember`).
  Catch `permission-denied` → UI bascule en read-only avec helper text FR.
- Toggle push notification désactivé avec helper "Bientôt disponible" (FCM
  hors scope).

## 4. Feature "Photo licence membre" (4 PRs parallèles)

**Brief produit** : `docs/members/license-photo.md` (source de vérité).

**Décisions clés** :
- Photo = pré-requis serveur pour transition coach `parent_docs_submitted →
  coach_validated` (refusée en `failed-precondition` sinon).
- Scope coach **non-exprimable en rules Storage** (convention repo : pas de
  cross-doc lookup Firestore depuis Storage). → autorisation gérée par
  **callables Admin SDK** (`assertCoachOrAdminOfMember`).
- Storage rules permissives (signed-in, ≤ 5 Mo, MIME image) sont juste un
  garde-fou de format ; la vraie authz est côté callable.
- Upload caméra mobile via attribut HTML natif `<input type="file"
  capture="user">` — iOS/Android propose nativement caméra vs galerie, pas
  de double bouton custom.
- Suppression admin/rootAdmin only (coach peut remplacer mais pas
  supprimer sans remplacer).

**Livrables** :
- `packages/shared-types/src/member.ts` — 3 champs nullables :
  `photoStoragePath`, `photoUpdatedAt`, `photoUpdatedByUid`.
- `storage.rules` — section `/members/{memberId}/{fileName}`.
- `functions/src/members/setMemberLicensePhoto.ts` +
  `removeMemberLicensePhoto.ts` (Admin SDK + scope re-vérifié + tests).
- `functions/src/licenses/coachReviewLicenseDoc.ts` — gate photo dans la
  transaction.
- `apps/courtbase-app/src/components/member/MemberPhotoSection.vue` +
  intégration `MemberDetail.vue` + gate UI `LicenseRequestReview.vue`.
- `apps/web/src/components/member-detail/MemberPhotoSection.vue` +
  intégration `ProfileTab.vue` + thumbnail `LicenseRequestReview.vue`.

**Déployé sur dev** (`court-base-44878`) :
- Storage rules.
- 3 Functions (`setMemberLicensePhoto`, `removeMemberLicensePhoto`,
  `coachReviewLicenseDoc` update).
- IAM bindings `allUsers/run.invoker` posés sur les 2 nouvelles Functions v2.

**Apps non déployées** — bloqueur PR-4 (signable docs license workflow)
introduit des champs/statuts dans `shared-types/src/license.ts` sans
synchroniser les consommateurs. À résoudre dans cette PR séparée, **pas**
dans la feature photo.

## 5. Shadow files `.vue.js` / `.js` — fix permanent courtbase-app

**Symptôme** : page blanche sur `courtbase-app` après PR-3 wiring +
`auth` store installed **2 fois** dans la console.

**Cause** : `apps/courtbase-app/package.json` exposait
`"type-check": "vue-tsc --build"` (au lieu de `--noEmit`). Chaque run
générait 55 fichiers shadows (`.vue.js` + `.js`) à côté des sources. Vite
résolvait normalement `.ts` en priorité, **mais le service worker PWA**
précachait les `.js` shadow → au reload, 2 versions des stores chargées
en parallèle (HMR + SW cache).

**Fix permanent** :
- Purge des 55 shadows.
- `package.json` : `vue-tsc --build` → `vue-tsc --noEmit` (aligné sur
  `apps/web`, cf. mémoire `vite_js_shadow_trap`).
- `.gitignore` couvrait déjà `src/**/*.vue.js` + `src/**/*.js` — pas de
  modif nécessaire.

**Action utilisateur post-fix** : Unregister SW + Clear site data dans
DevTools, puis hard reload, pour vider l'ancien cache.

## 6. Menu unifié single-page courtbase-app (4 PRs parallèles)

**Brief produit** : `docs/courtbase-app/menu-refactor.md`.

**Décision** : remplacer les 5 variants quasi-identiques du `Home.vue`
(`HomeDesktop`, `HomeMultiRoleMobile`, `HomeCoachMobile`,
`HomeOfficialMobile`, `HomeAdminMobile`) par **un seul template**
empilant des **sections conditionnelles** par rôle. Pas de role switcher :
multi-role = empilement direct.

**Ordre fixe des sections** : Coach → Officiel → Admin → Joueur.

**Architecture cible** :
- `Home.vue` (passé 1500 → **85 lignes**, -94%) — coquille qui choisit
  `CbMobileShell` vs `CbDesktopShell` puis empile les sections.
- 5 composants section dans `apps/courtbase-app/src/components/home/` :
  - `HomeCoachSection`, `HomeOfficialSection`, `HomeAdminSection`,
    `HomePlayerSection`, `HomeEmpty`.
- Chaque section a son propre `onMounted` (scope data per section) — la
  coquille `Home.vue` ne charge **rien**.
- `useShellNav()` nouvelle API : `{ tabs, nav, primaryRoleLabel }` (au lieu
  des 9 collections legacy `coachTabs/coachNav/...`). Legacy préservé pour
  rétro-compat temporaire.
- `CbSidebar` accepte désormais `CbNavItemGroup[]` (grouping par rôle avec
  label "COACH" / "OFFICIEL" / "ADMIN" / "JOUEUR"). Fallback `CbNavItem[]`
  plat.
- Tab bar mobile **max 4 items** : Accueil + 1 par rôle actif (Coach >
  Officiel > Admin > Joueur). Slot 4 devient "Plus" si > 3 rôles.

### Migration 17 vues legacy (3 agents parallèles)

Bug rapporté : "quand je clique sur team je ne vois plus admin et
l'officiel disparaît". Cause : 17 vues consommaient encore les collections
legacy `coachTabs`/`coachNav`/etc. — scopées 1 seul rôle.

Vues migrées vers `{ tabs, nav, primaryRoleLabel }` :
- 7 coach : MyTeams, TeamRoster, TeamPlanning, Agenda, AwayMatchCreate,
  Registrations, LicenseRequestsToReview.
- 3 official : OpenMatches, MyAssignments, MatchDetail.
- 5 admin : Staffing, StaffingDetail, Requests, RequestDetail, Broadcast.
- 2 common : Notifications, ProfileSettings.

Bonus découvert : `CbTabBar` et `CbSidebar` font **déjà l'auto-active**
depuis `route.name` (lignes 43-45 + 110). Les props `:active="N"` /
`:active-tab="N"` hardcodés sont devenus inutiles et ont été retirés
partout. Les hardcodes `:user-role="'Coach'"` remplacés par
`:user-role="primaryRoleLabel"`.

### Flags de rôle inclusifs

**Décision** : `auth.isCoach` / `auth.isOfficial` deviennent **inclusifs** :
- `isCoach = roles.includes('coach') || hasActiveCoachLicense`
- `isOfficial = roles.includes('official') || hasActiveOfficialLicense`
- `isAdmin` inchangé (pas de notion "admin actif via licence").

**Pourquoi** : aligné sur la sémantique du badge "Officiel actif" / "Coach
actif" côté admin web. Avoir une licence confirmée pour la saison **vaut**
rôle pour l'affichage UI (sections Home + tabs/nav via `useShellNav`).

**Sécurité préservée** : le router guard
(`apps/courtbase-app/src/router/index.ts:274`) lit `auth.roles`
**directement** (l'array brut), pas les flags `is*`. L'inclusivité ne
contourne pas la sécurité, elle aligne juste l'UI sur la réalité métier.

**Effet de bord à fixer en Phase 2** : `auth.linkedMember` retombe encore
sur mock Mathieu (mémoire `[[courtbase_app_auth_hybrid]]`). Donc
`hasActiveOfficialLicense` reflète l'état de Mathieu, pas du vrai user.
Quand `linkedMember` lira le vrai member via `useMyProfileStore`, le
comportement deviendra individuel.

## 7. Pattern `useShellNav.activeRoles` — toujours lire les flags `is*`

**Règle à retenir** : tout code qui dérive des comportements UI par rôle
doit lire `authStore.isCoach` / `isOfficial` / `isAdmin` (flags
**inclusifs**), pas `authStore.roles.includes(...)` (array brut).

Le router guard est l'**unique** exception : il vérifie l'allowlist
sécurité contre `roles` brut pour éviter qu'une licence accidentelle
ouvre des routes.

## 8. Sidebar / TabBar — auto-active route detection (pré-existant)

`CbTabBar` (lignes 43-45) et `CbSidebar` (ligne 110) détectent
**automatiquement** l'item actif depuis `useRoute().name` matché contre
`item.routeName` (+ `activeRoutes?`). Convention :

> **Ne plus passer `:active="N"` / `:active-tab="N"` hardcodés depuis les
> vues consommatrices.** Laisser le composant détecter.

Pré-existait dans le code mais beaucoup de vues l'ignoraient (legacy 22
vues qui passaient des index hardcodés). Toutes nettoyées dans la session.

## Mémoires créées / mises à jour

- `feedback_inclusive_role_flags.md` — flags `is*` inclusifs avec licence
  active, router reste strict.
- `single_page_home_pattern.md` — pattern Home sections conditionnelles +
  brief.
- `validate_license_reject_asymmetric.md` — pré-conditions asymétriques
  approve/reject.
- `license_photo_workflow_done.md` — feature livrée + déployée dev.
- `useshellnav_new_api.md` — `{ tabs, nav, primaryRoleLabel }` + 9 legacy
  deprecated.

## TODOs résiduels (post-session)

- **PR-4 signable docs** : débloquer le typecheck `apps/web` +
  `apps/courtbase-app` (champs `signableDocStoragePath`,
  `parent_signed`, `awaiting_parent_signature`, `form_confirmed`,
  `sent_paid` ajoutés à `shared-types/src/license.ts` sans synchroniser
  consommateurs).
- **Auth `linkedMember`** : brancher sur `useMyProfileStore` pour que
  `hasActive*License` reflète le **vrai** member (au lieu de Mathieu mock).
  Phase 2.
- **9 collections legacy `useShellNav`** : retirer une fois certain qu'aucune
  vue ne les utilise (post-stabilisation).
- **Dashboard handlers `noop()`** L189-191 : Export / Refuser / Accepter /
  Voir saison à brancher.
- **Payment exceptions store** : créer ou route fonctionnelle, badge
  réactivable.
- **Notifications header** : décider modèle (compteur agrégé ou collection
  dédiée), badge réactivable.
- **FCM push enregistrement** (Phase 5).
- **`member.officialLevel` mock** : seed pas fiable en prod, à brancher
  quand `member.officialLicense.level` sera fiable partout.
