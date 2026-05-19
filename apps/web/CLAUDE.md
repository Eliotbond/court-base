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

Le projet expose plusieurs Cloud Functions (cf. `functions/src/index.ts`). **La plupart sont des triggers** (Firestore writes ou scheduled) — elles tournent automatiquement, rien à faire côté web. Les **callables** (= invocables depuis le client) sont listées ci-dessous :

| Function | Auth requise | Quand |
|---|---|---|
| `runMigrations({ targetVersion? })` | admin / rootAdmin | Settings → ops (premier appel sur projet vierge crée `/_meta/schema`) |
| `setRootAdminClaim({ email, value })` | **rootAdmin uniquement** | Settings → Admin team. Anti-self-revoke. |
| `listRootAdminUids()` | admin / rootAdmin | Settings → Admin team : résout le badge `rootAdmin` (claim Auth, pas dans Firestore). |
| `acceptInvitation()` | signed-in | Auto-appelée par `users.repo.ts` après une sign-in OAuth si `/users/{uid}` est absent. Cherche `/invitations` par email et provisionne le user. |
| `refuseRegistration({ registrationId, reason })` | admin / coach (team scope) | Inscriptions → bouton "Refuser". Écrit `/teams/{id}/refusalLogs`. |
| `cancelRegistration({ registrationId, note? })` | auteur uniquement | Inscriptions → cas dépannage admin. |
| `markTrialInProgress({ registrationId })` | admin / coach (team scope) | Inscriptions → bouton "Planifier essai". Démarre compteur 14j. |
| `confirmRegistration({ registrationId })` | admin / coach (team scope) | Inscriptions → bouton "Confirmer". Crée le member si nouveau, ajoute à `team.playerIds` (déclenche cotisation). |
| `updateCotisation({ cotisationId, activatedAt?, issuedAt?, dueAt?, status?, notes? })` | admin / treasurer / rootAdmin | Cotisations (liste) + Détail membre → "Modifier". Édite dates / statut / note. `status: 'paid'` refusé (flux `markCotisationPaid`). Wrappe la callable serveur `updateDue`. |
| `confirmLicense({ licenseId })` | treasurer / admin / secretary / rootAdmin | Détail membre → onglet "Officiel & coach" → bouton "Confirmer" sur une licence `pending`. Passe `/licenses/{id}` en `active`, poste l'écriture comptable de la charge (débit « Licences fédérales » / crédit trésorerie) et dénormalise `member.officialLicense` / `coachLicense`. Retour `{ ok, alreadyActive, accountingEntryId }` — idempotent (re-confirmer ne re-poste pas d'écriture). |

> `previewSeasonBookings` n'est plus appelée côté client (dry-run retiré 2026-05-14 — les bookings sont désormais créés manuellement via `/bookings`). La Cloud Function reste déployée mais sans wrapper TS ; à supprimer côté Functions quand on fera le nettoyage backend.

**Toujours passer par les wrappers typés** dans `apps/web/src/services/cloudFunctions.ts` :

```ts
import { runMigrations } from '@/services/cloudFunctions'

const result = await runMigrations()
// result.from, result.to, result.applied
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

## Catch enrichi obligatoire

Cohérence avec `apps/courtbase-register` : dans tous les stores Pinia, tout `try/catch` autour d'un appel Firestore ou callable doit faire :

```ts
} catch (err) {
  const code = err instanceof FirebaseError ? err.code : 'unknown'
  console.error(`<actionName> failed [${code}]`, err)
  // …
}
```

Sans ça, les bugs disparaissent silencieusement (cas vécu côté register : index manquant → bandeau "Impossible de charger" persistant sans diagnostic). À appliquer en particulier aux stores qui chargent des collections : `members`, `teams`, `bookings`, `dues`, `licenses`, `registrations` (à venir Phase D).

## Phase D du chantier registrations — état (2026-05-14)

Voir `docs/registrations/phases.md` §"Phase D" pour le détail complet. Livré dans `apps/web` :

- **Vue `/registrations`** (`src/views/Inscriptions.vue`) — table filtrable par statut (chips) + équipe (Select) + recherche, drawer détail in-page, action **refus motivé** branchée sur `refuseRegistration`. Scope auto par rôle (admin → toute la collection ; coach → ses `teamIds`).
  - **Suppression définitive** (admin / rootAdmin uniquement) : bouton corbeille + dialog type-to-confirm (`SUPPRIMER`), aligné sur la suppression des cotisations. `deleteRegistration` fait un `deleteDoc` direct (rules `/registrations` delete = auteur-draft ∪ admin) — destiné à la correction d'erreur. **Tous statuts confondus**, pas de garde-fou repo : pour `confirmed_pending_dues` / `active`, le dialog affiche un avertissement renforcé (member + cotisation déjà créés non nettoyés → `deleteMember` pour un retrait complet).
- **Repo + store** : `src/repositories/registrations.repo.ts` (read-only — toutes les transitions passent par callables) + `src/stores/registrations.ts` (auto-scope via `useAuthStore`).
- **Wrappers callables** dans `src/services/cloudFunctions.ts` : `refuseRegistration`, `cancelRegistration` (les deux déjà déployées sur dev).
- **Sidebar** : entrée "Inscriptions" dans Operations (icône `ClipboardList`).

**Restant Phase D** :
- Callables manquantes côté `functions/` : `acceptRegistration`, `markTrialInProgress`, `confirmRegistration`, `adminCancelRegistration`. Handlers UI déjà esquissés dans `Inscriptions.vue` (variables non-utilisées qui apparaissent au typecheck — branchement template à finaliser quand les callables seront en place).
- Auto-rerouting via trigger Firestore `onRegistrationRefused`.
- Admin UI pour poser `team.registrationStatus` sur les teams pré-existantes au chantier (cf. leçon Phase C).

## Bookings — planning calendrier (livré 2026-05-14)

L'écran `/bookings` consomme `useBookingsStore` qui expose `allBookings` (saison complète, single fetch) comme source unique. La grille Planning et l'onglet Liste lisent la même array — filtrage client-side, **0 re-fetch sur navigation semaine**.

Composant : `vue-cal` v4 (MIT). Voir `docs/frontend-desktop.md` §Bookings calendar pour le rationale et les concepts (splits, événement → booking lookup, CSS overrides).

**Règles spécifiques à respecter ici** :

1. **Source unique** : tout consumer (grille, liste, drawer) lit `store.allBookings`. Ne JAMAIS rajouter une query Firestore par range ni un nouveau state local de bookings.
2. **Après mutation** (`createManualBooking`/`createSeries`/`editBooking`/`deleteBooking`/`deleteSeries`/`hardDeleteBookingAction`) : le store appelle automatiquement `loadAllBookingsAndSeries()`. Le composant n'a rien à recharger — pas de `@created="store.loadXxx()"` côté vue.
3. **Navigation** : `currentWeekStart` côté store n'est PAS lié à un fetch — c'est juste un pointeur utilisé par certains contextes (label "Semaine du …"). vue-cal a son propre `selectedDate` (state local de `Bookings.vue`).
4. **Splits** : composite key `${venueId}__${courtId}` (séparateur `__` double underscore) — utilisé partout pour aligner events ↔ colonnes. Si tu changes, change aux deux endroits (`courtSplits` computed + `calendarEvents` computed).
5. **Types vue-cal** : shim dans `src/types/vue-cal.d.ts`. Étendre ici plutôt que `// any:` à travers le code si tu actives drag/drop ou autres features.
6. **Format de date des events** : `YYYY-MM-DD HH:MM` heure locale — cohérent avec le repo qui stocke via `Timestamp.fromDate(startOfLocalDay)`.
7. **Couleurs par type** : classes CSS `vc-training` / `vc-match-home` / `vc-match-pending` / `vc-match-away` / `vc-reserve` / `vc-custom` + modifiers `vc-cancelled` / `vc-freed` dans `<style scoped>` de `Bookings.vue`. Si tu changes la palette tailwind globale, sync ici.

## Liaison membre ↔ compte d'inscription (livré 2026-05-14, dialog unifié 2026-05-18)

Quand un parent s'inscrit via `apps/courtbase-register`, un `/users/{uid}` est créé avec rôle `parent`. La page **détail membre** (`/members/:id` → ProfileTab) permet à l'admin de :

1. **Voir les données enrichies des tuteurs** — `GuardianRef` enrichi avec `phone`, `address`, `profileCompletedAt`. Le bloc Tuteurs affiche email + téléphone + adresse formatée + Pill "Profil complété" / "Profil incomplet".
2. **Lier un membre à un compte Auth** — un **dialog unifié** `LinkUserDialog.vue` (remplace les anciens `ManageLinkedUserDialog.vue` + `ManageGuardiansDialog.vue`, supprimés). Un seul point d'entrée bouton **"Lier un user"** (présent dans la card Tuteurs et la card "Compte Firebase Auth"). Le dialog propose un `SelectButton` de rôle : **Propriétaire** (compte du membre → `setLinkedUser`) ou **Tuteur** (parent → `addGuardian`). Recherche par email (`searchUsersByEmail`, debounce 200ms), validations selon le rôle (refus si déjà propriétaire/tuteur, avertissement amber "Remplacer" si le membre a déjà un propriétaire). Les **retraits** restent inline dans ProfileTab : bouton "Retirer" par tuteur, "Délier" (confirmation 2-clics) pour le propriétaire.

**Implémentation clé** : `setLinkedUser(memberId, uid | null)` dans `members.repo.ts` — `writeBatch` atomique bidirectionnel (`/members/{id}.linkedUserId` + `/users/{uid}.memberId`) avec nettoyage des deux types d'orphelins (ancien lien côté member + ancien lien côté user). `addGuardian` / `removeGuardian` gèrent l'invariant `/users.roles` ⊃ `parent`. Les rules existantes couvrent ces writes (admin-only — pas de modif `firestore.rules` nécessaire).

### Toggle Actif / Inactif (livré 2026-05-18)

`member.active` (bool) pilote l'accès du membre à l'app mobile / au club (enforcé côté `firestore.rules`). Distinct de l'archive (`status: 'active' | 'archived'`). La ligne "Statut" de la card Identité affiche deux Pills séparées : `active` → emerald "Actif" / amber "Inactif", et une Pill rose "Archivé" en plus si `status === 'archived'`. Un bouton "Désactiver / Activer" (gaté `canEdit`) bascule le flag via `membersStore.setMemberActive` → `setMemberActive(memberId, active)` dans `members.repo.ts` (simple `updateDoc`). Le passage en **inactif** ouvre une confirmation (perte d'accès mobile) ; le passage en actif est immédiat.

## Cotisations — paiement & arrangement comité (livré 2026-05-15)

Deux canaux UI pour marquer une cotisation payée — règles strictes côté frontend, doublées d'une garde serveur dans `markDuePaid`.

### Page `/cotisations` (liste globale) — canal "quotidien"

Le dialog "Marquer payé" **ne propose plus de champ montant** : affichage read-only du tarif plein (`row.amount`) avec mention "Validation au montant intégral. Un arrangement comité passe par la page Détail membre." Le `markPaidForm.amount` est pré-rempli à `row.amount` à l'ouverture (`openMarkPaidDialog`) et le submit l'envoie tel quel. C'est le flux pour confirmer un paiement reçu — pas pour négocier.

### Page `/members/:id` → tab Cotisations — canal "arrangement"

Le dialog "Enregistrer un paiement" expose **en haut un switch "Cotisation payée intégralement"** (ON par défaut), conditionné à `canAdjustAmount = auth.rootAdmin || auth.roles.includes('treasurer')`. Quand OFF, un champ "Montant versé (CHF)" apparaît, capé à `cotisation.amount`. Pour l'admin standard, le switch est invisible — il ne peut que valider au plein tarif (cohérent avec la liste globale).

**Exception comité supplémentaire** : sur ce tab, le bouton "Marquer payé" est aussi exposé pour les cotisations en `pending_grace` (validation anticipée) si `canAdjustAmount` est vrai. Un admin standard ne voit pas le bouton sur grace period — il attend la transition `issued` automatique (cf. `docs/main.md` § Cotisations).

### Pourquoi cette double règle

- Le canal "liste globale" est utilisé en volume → on évite toute saisie qui prêterait à arrangement informel. Plein tarif, fin de l'histoire.
- Le canal "fiche membre" est où l'on traite les cas individuels → c'est le bon endroit pour l'arrangement comité.
- La garde côté serveur (`assertCanRecordPartial` dans `functions/src/dues/markDuePaid.ts`) ferme la porte au DOM-bypass : un admin standard qui appellerait le callable directement avec un `paidAmount < due.amount` reçoit `permission-denied`.

### Pattern à respecter pour toute nouvelle UI de paiement

Si tu ajoutes un autre endroit où marquer une cotisation payée (ex. mobile, vue récap), applique la même règle : montant verrouillé sauf comité (rootAdmin OU treasurer), et n'oublie pas que la garde serveur compte sur `paidAmount < due.amount` — un montant supérieur n'est PAS bloqué (overpayment hors scope, à traiter si besoin).

## Matches — page liste + création (livré 2026-05-15)

Page `/matches` (route `ADMIN_COACH`, entrée sidebar dans Operations). Un match **est** un booking avec `slotType in [match_home, match_away]` — pas d'entité dédiée.

### Fichiers livrés

- `src/views/Matches.vue` — DataTable filtrable (chips Tous / À venir / Passés / À domicile / À l'extérieur / Annulés) + recherche + drawer détail. Source : `useBookingsStore().allBookings` filtré côté JS.
- `src/components/matches/MatchFormDialog.vue` — dialog création (Home / Away). Pour Home : intègre `MatchBookingPicker`. Pour Away : DatePicker + Select horaire (pas de 30 min entre 06:00 et 22:00) + adresse Textarea.
- `src/components/matches/MatchBookingPicker.vue` — vue-cal v4 réutilisable, filtre période (Matin / Après-midi / **Soir par défaut**), navigation jour, splits courts. Émet `@select` avec `{ venueId, courtId, date, startTime, endTime }` après détection conflit côté JS.
- `src/stores/matchTypes.ts` + `src/repositories/matchTypes.repo.ts` — store/repo minimal read-only (pas de CRUD pour MVP — la page `/match-types` reste un placeholder).

### Schéma `/bookings` étendu

Deux champs nullables ajoutés à `BookingData` (cf. `packages/shared-types/src/booking.ts`) :
- `opponentName: string | null` — nom équipe adverse. Pertinent uniquement si `slotType in [match_home, match_away]`.
- `awayAddress: string | null` — adresse du gymnase extérieur. Pertinent uniquement si `slotType = match_away`.

**Pas de modif `firestore.rules`** : les nouveaux champs tombent sous la règle admin-only existante sur `/bookings`.

### Création d'un match — auto-free trainings

`createMatchBooking` dans `bookings.repo.ts` fait deux opérations :
1. `addDoc('/bookings')` avec le nouveau booking match.
2. Appelle `freeConflictingTrainings({ teamId, date, startTime, endTime, reason })` qui passe en `status: 'freed'` (avec `cancelReason = 'match_home'` ou `'match_away'`) tous les bookings `training` ou `reserve` (status `scheduled`) de la même équipe qui chevauchent le créneau.

**Best-effort** : si le free trainings plante après l'addDoc, le match reste créé. Le rapport (`{ bookingId, freedBookingIds }`) est remonté à l'UI qui affiche une bannière info "X entraînement(s) automatiquement libéré(s)".

À **distinguer** du trigger Cloud Function `handleMatchSlotChange` qui couvre les transitions de `timeSlots` récurrents (pas les one-shot manuels créés via `/matches`).

### Match away — venueId/courtId vides

Pour un `match_away`, `venueId = ''` et `courtId = ''` (le match n'occupe pas de court interne). Le calendrier `/bookings` filtre déjà via `splits` — un booking sans court ne s'affiche pas dans la grille. La page `/matches` les liste normalement avec `awayAddress` dans la colonne "Lieu".

### Limites MVP

- Pas d'édition / suppression depuis `/matches` (passe par `/bookings`).
- Pas de scope coach (un coach voit tous les matchs, pas filtré par ses équipes — à raffiner si besoin).
- Officials assignments non créées à la création d'un `match_home` côté repo. Si on a besoin de l'auto-création des `officialAssignments`, monter une Cloud Function ou étendre `createMatchBooking`.

## Match types CRUD (livré 2026-05-15)

Le référentiel `/matchTypes` est désormais entièrement éditable depuis Settings → Saison / Compétition → **Match types** (la route `/match-types` et l'entrée sidebar associée ont été supprimées — tout passe par Settings).

### Fichiers livrés / étendus

- `src/repositories/matchTypes.repo.ts` — étendu avec `createMatchType` / `updateMatchType` / `deleteMatchType` + `isMatchTypeUsed` (garde-fou anti-delete).
- `src/stores/matchTypes.ts` — étendu avec actions `create` / `update` / `remove` (alignées sur le pattern `categories` / `licenseTypes` : upsert local, try/catch enrichi `FirebaseError`).
- `src/views/Settings.vue` — section `matchTypes` avec list-view (DataTable inline), dialog création/édition unifié (mode `create | edit`), dialog confirmation suppression.
- `src/stores/settings.ts` — type `SettingsSection` étendu avec `'matchTypes'`.

### Garde-fou anti-delete

`deleteMatchType(id)` interroge `/bookings where matchTypeId == id limit(1)` avant la suppression. Si au moins un booking le référence, throw `'matchType in use…'`. L'UI affiche le message dans le dialog de suppression et suggère la désactivation (`active: false`) à la place. Pas de soft-delete séparé — le flag `active` existant fait le job (les pickers de création de match consomment `activeMatchTypes` qui filtre les inactifs).

### Helpers UI

- `formatOfficialReqs(reqs)` — `[{level:2,count:1},{level:1,count:2}]` → `"1× N2 + 2× N1"`.
- `HEX_COLOR_RE` — valide `#RRGGBB` strict (refuse les 3-digit forms).
- Editor inline pour `homeOfficialRequirements` (ajout/suppression de lignes `{level, count}`).

### Pas de modif rules

La règle `/matchTypes` existait déjà (`isAdmin || isRootAdmin` pour write, `isSignedIn` pour read) — pas de modif `firestore.rules` nécessaire.

## Module Comptabilité (livré 2026-05-15)

Module financier réservé au **trésorier + rootAdmin** (l'`admin` standard est exclu, y compris dans `firestore.rules`). Comptabilité en **partie double**. Source de vérité produit : `docs/compta.md`. Schéma : `docs/firebase.md` (`/accounts`, `/accountingEntries`, `/invoices`).

### Routing & accès

7 routes sous `/comptabilite` (`meta.allowedRoles: ['treasurer']`, le `rootAdmin` bypasse le guard) : `/comptabilite` (hub), `/comptes`, `/credits`, `/factures`, `/journal`, `/bilan`, `/resultat`. Section « Comptabilité » dans `AppSidebar.vue`, gatée `rootAdmin || roles.includes('treasurer')`.

### Fichiers livrés

- **Repos** : `accounts.repo.ts` (CRUD comptes + `seedDefaultAccounts` idempotent + garde-fou delete sur `isDefault`/compte utilisé), `accountingEntries.repo.ts` (moteur partie double), `invoices.repo.ts` (factures + upload Storage), `accountingReports.repo.ts` (lecture seule).
- **Stores** : `accounts.ts`, `accountingEntries.ts`, `invoices.ts`, `accountingReports.ts`.
- **Vues** : `src/views/accounting/` — `AccountingHome`, `Accounts`, `Credits`, `Invoices`, `Journal`, `Bilan`, `IncomeStatement`.
- **Composants** : `src/components/accounting/` — `AccountFormDialog`, `AccountDeleteDialog`, `CreditFormDialog`, `InvoiceFormDialog`, `ManualEntryDialog`, `InvoiceBookDialog`, `ReportPeriodFilter`.

### Moteur d'écritures — `accountingEntries.repo.ts`

Toute écriture comptable passe par ce repo. `postEntry(input)` valide l'invariant `Σdebit === Σcredit` (tolérance arrondi CHF `0.005`, helper `validateEntryBalance` exporté) avant tout `addDoc`. Helpers métier : `postCredit` (saisie simplifiée d'un crédit → débit trésorerie / crédit compte), `reverseEntry` (annulation = contre-passation atomique `writeBatch`, jamais de delete physique). **Les autres features (factures via `bookInvoice`/`markInvoicePaid`, saisie manuelle) réutilisent `postEntry` — ne pas réimplémenter de moteur.**

### Comptes par défaut

10 comptes seedés via le CTA de la page Comptes quand `/accounts` est vide (`seedDefaultAccounts`, idempotent). Le compte « Créditeurs » est résolu par `number === '2000'` avec repli sur le premier compte actif de nature `passif`. Les comptes `isDefault` sont protégés en suppression.

### Calculs de rapports

Toute la logique de bilan/résultat/journal vit dans le store `accountingReports.ts` (getters `accountBalances`, `balanceSheet`, `incomeStatement`, `journalRows`), pas dans les vues. Solde orienté par nature (`actif`/`charge` → débit−crédit ; `passif`/`produit` → crédit−débit). Les contre-passations ne sont pas filtrées — elles se neutralisent naturellement avec leur écriture d'origine.

### OCR différé

L'import de factures est **manuel** en v1. Les champs `invoice.ocrStatus` / `ocrRawText` existent mais restent inertes (`'none'` / `null`). Fichiers uploadés dans Storage à `accounting/invoices/{invoiceId}/{file}`.

## Niveaux officiel/coach & Licences fédérales (livré 2026-05-18)

Gestion, depuis la fiche membre, des **qualifications** numériques (niveau officiel / niveau coach) et des **licences fédérales** émises (`/licenses`).

### Modèle métier — qualification vs actif

- `member.officialLevel` / `member.coachLevel` : QUALIFICATIONS numériques `1..N`, réglées **manuellement** par l'admin. Avoir un niveau ≠ être actif.
- Officiel/coach **ACTIF** = a une licence `/licenses` `status:'active'` pour ce rôle ET la saison courante. Dérivation : `member.officialLicense != null && officialLicense.seasonId === <id saison active>` (réf dénormalisée posée par la callable serveur `confirmLicense`).
- Cycle licence : `pending` (créée par l'admin, write client direct) → `active` (via `confirmLicense`, réservée treasurer/admin/secretary/rootAdmin) → ou `cancelled` (terminal).

### Onglet "Officiel & coach" (`member-detail/OfficialTab.vue`)

L'ancien onglet "Officiel" est généralisé. Il est désormais **toujours visible** (la qualification peut être posée sur n'importe quel membre) et porte 3 blocs :

1. **Qualifications** — édition du niveau officiel ET coach via dialog `InputNumber` (entier `1..N`, plus de L1/L2 en dur). Bouton "Retirer le niveau" → remet `null`. Badges dérivés "Officiel actif" / "Coach actif" (saison-précis). Passe par `memberDetail` store → `applyProfilePatch` → `updateMember` (whitelist `MemberPatch` étend `coachLevel`).
2. **Licences** — DataTable des licences du membre (type, saison, montant, Pill statut `pending` ambre / `active` emerald / `cancelled` slate). Bouton "Créer une licence" (dialog Select type + Select saison). Bouton "Confirmer" sur les `pending`, **visible uniquement** si treasurer/admin/secretary/rootAdmin.
3. **Rentabilité officiel** — section existante préservée, conditionnée à `officialLevel != null`.

### Couches

- **Repo** `repositories/licenses.repo.ts` : `listMemberLicenses(memberId)` (query simple `where memberId == X` + tri JS `createdAt` desc — pas d'index composite) ; `createLicense({ memberId, seasonId, licenseTypeId })` qui lit le `LicenseType` et **snapshotte** `role`/`level`/`name`→`licenseName`/`fee`→`feeSnapshot` dans `/licenses` (`status:'pending'`).
- **Store** `stores/licenses.ts` : scopé au membre courant (`load`/`reset`/`create`/`confirm`), try/catch enrichi `FirebaseError`.
- **Callable** `confirmLicense` dans `services/cloudFunctions.ts` (cf. table des callables).

### Compte comptable

`seedDefaultAccounts` (`accounts.repo.ts`) seede un compte de charge **`Licences fédérales`** (number `4300`). Le nom exact est **load-bearing** : la callable serveur `confirmLicense` résout ce compte **par son nom** pour y poster la charge. Ne pas renommer.

### Rôle `secretary`

Rôle staff additif. Côté web : guard du bouton "Confirmer une licence" (`canConfirmLicense` = treasurer/admin/secretary/rootAdmin) et ajout aux routes `members` / `members/:id` (constante `MEMBERS_ACCESS`) pour que le secrétaire atteigne la fiche membre.
