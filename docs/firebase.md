# Firebase

> Schéma Firestore, security rules, Cloud Functions, Auth. **Un projet par client** : les paths sont plats à la racine (pas de `clubId` prefix). Pour le control-plane et la flotte, voir `deployment.md`.
>
> Les rules vivent dans `firestore.rules`. Garde ce doc et le fichier en sync.

## Firestore — collections (par projet client)

```
/config/club                          (singleton)
/users/{uid}
/members/{memberId}
  /private/contact                    (singleton, ID fixe — email, phone)
/roles/{roleId}
/invitations/{inviteId}
/venues/{venueId}
  /courts/{courtId}
    /timeSlots/{slotId}
/teams/{teamId}
  /refusalLogs/{logId}
/matchTypes/{matchTypeId}
/seasons/{seasonId}
/closurePeriods/{periodId}
/bookingSeries/{seriesId}
/bookings/{bookingId}
  /officialAssignments/{assignmentId}
  /attendance/{attendanceId}
/matches/{matchId}
/matchRequests/{requestId}
/notifications/{notificationId}
/pendingEmails/{emailId}
/dues/{dueId}
/paymentExceptionRequests/{requestId}
/licenseTypes/{licenseTypeId}
/licenseRequests/{requestId}
/registrations/{registrationId}
/accounts/{accountId}
/accountingEntries/{entryId}
/invoices/{invoiceId}
/_meta/schema                         (version + migration log)
```

## Documents — champs clés

### `/config/club` (singleton)
```ts
{
  name: string
  shortCode: string                                  // slug court : "bcls" (URLs, share codes, deep-links mobile)
  logo: string | null
  address: { street, city, zip, country } | null
  contact: { email: string, phone: string }          // contact principal du club (affiché dans l'app)
  banking: {                                         // RIB du club — null tant que pas saisi
    iban: string | null
    bic: string | null
    bankName: string | null
    accountHolder: string | null
    paymentInstructions: string | null               // texte libre (ex. "Indiquer nom + prénom joueur en référence")
  } | null
  officialsConfig: { licenseFee: number, thresholdGreen: number, thresholdOrange: number }
  duesConfig: { gracePeriodDays: number, paymentDueDays: number }
  createdAt: Timestamp
  createdBy: string  // uid
}
```
Le projet *est* le club. Ce doc ne porte que la config.

`shortCode` et `contact` vivent dans `/config/club` (et pas dans un doc séparé) parce qu'ils partagent **la même cadence de mise à jour** (un admin les ajuste ensemble depuis l'écran Settings → General), **la même frontière de sécurité** (write réservé à `admin` + `rootAdmin`, cf. rules ci-dessous), et ne justifient pas un doc dédié.

#### `config.club.banking`

Coordonnées bancaires du club. Diffusées en clair dans les emails de demande de paiement de cotisation (template `dues_payment_request`) et l'écran "Comment payer" côté `apps/courtbase-register`. Tous les sous-champs sont `null` tant que l'admin n'a pas renseigné l'info dans Settings → Cotisations / Banque.

- **`paymentInstructions`** : texte libre concaténé sous l'IBAN dans les emails. Sert à expliquer la convention de référence (ex. `"Indiquer nom + prénom du joueur dans la référence"`).
- **`banking === null`** : autorisé tant que pas saisi. Dans ce cas l'email de demande de paiement omet la section "comment payer" et l'app register affiche un message d'attente.
- **Sécurité** : write admin/rootAdmin uniquement (rule globale `/config/club`). Pas de scope additionnel — les coordonnées sont celles du club, pas PII tierce.

### `/users/{uid}`
```ts
{
  email: string
  displayName: string
  photoURL: string
  roles: string[]           // "admin" | "coach" | "parent" | "official" | "treasurer" (additifs, cumulables)
  memberId: string | null   // lien vers /members si user = membre
  teamIds: string[]         // scope coach
  phone: string | null
  address: UserAddress | null            // { street, zip, city, country (ISO 3166-1 alpha-2) }
  profileCompletedAt: Timestamp | null
  createdAt: Timestamp
}
```
Un user appartient à **un seul projet**. Pas de `clubMemberships[]`.

`phone`, `address`, `profileCompletedAt` sont remplis via l'app `courtbase-register` (cf. `docs/chantier-registrations.md` §4.2). Le user peut self-create son doc et self-update ces champs (rules `firestore.rules:71-89`) — `roles` / `memberId` / `teamIds` restent admin-only.

#### Rôles additifs (`user.roles`)

Énumération canonique : `UserRole` dans `packages/shared-types/src/user.ts`. Tous **additifs** (cf. mémoire `project_roles_additifs`) — un même user peut être `admin + coach`, `treasurer + admin`, etc. `roles` reste typé `string[]` (extensibilité custom).

| Rôle | Effet |
|---|---|
| `admin` | Read/write tout (sauf `/_meta/schema`). |
| `coach` | Read members + scope team via `user.teamIds`. |
| `official` | Auto-inscription assignations. Pas de contact info members. |
| `parent` | Accès aux pupilles via `member.guardianUserIds`. |
| `treasurer` | Read full `/dues`. Marque les dues `paid` via callable `markDuePaid`. **Capability comité** : seul rôle (avec `rootAdmin`) autorisé à poser un montant partiel (`paidAmount < due.amount`) ou à marquer payé un due encore en `pending_grace` (validation anticipée). Pas de droits admin généraux. |

### `/members/{memberId}`
```ts
{
  firstName, lastName: string
  status: "active" | "archived"         // default 'active', archive via callable serveur uniquement
  archivedAt: Timestamp | null          // posé à l'archive, null tant que active
  archivedReason: string | null         // motif libre passé à la callable
  archivedByUid: string | null          // admin/coach ayant déclenché l'archive
  roles: string[]                       // refs vers /roles
  linkedUserId: string | null           // uid Auth
  licenseNumber: string
  officialLevel: number | null          // 1, 2 ; null si pas official. Manuel admin.
  licensed: boolean                     // toggled by admin via licenseRequest approval
  duesStatus: "ok" | "pending_grace" | "due" | "overdue" | "excluded" | "excepted" | "n/a"
  duesStatusUpdatedAt: Timestamp
  active: boolean
  birthDate: Timestamp | null           // null = inconnue (traité comme adulte côté defaults, UI doit avertir)
  guardianUserIds: string[]             // UIDs des tuteurs (users avec rôle 'parent' rattachés)
  comms: MemberCommsConfig              // routage facturation + comms générales (voir sous-structure)
  avs: string | null                    // 756.XXXX.XXXX.XX, null = pas encore connu (réfugié, etc.)
  transferState: "none" | "national_pending" | "international_pending" | "cleared"
}
```
**Pas de `email`/`phone` ici** — voir `/members/{memberId}/private/contact` ci-dessous. Le doc parent est lisible par tous les rôles club (incl. `official`-only). Les contacts sont gated séparément.

**Lecture étendue tuteurs** : un user dont `request.auth.uid` est dans `member.guardianUserIds` peut lire le doc parent **et** la sub `/private/contact` (cf. règles ci-dessous). Permet à un parent d'accéder à la fiche de sa pupille sans rôle admin/coach.

Index requis : `members.guardianUserIds` en `array-contains` (pour lister les pupilles d'un user donné côté UI parent). À déclarer dans `firestore.indexes.json` si on requête `where('guardianUserIds', 'array-contains', uid)`.

#### `member.status` & champs d'archive

`status` est un état cycle de vie distinct du flag `active` (booléen, qui pilote la sélection coach/team). Defaults à `'active'` à la création (`createMember`).

- **Archive (`status='archived'`)** : posée par callable serveur uniquement (`archiveMember`, ou déclenchée automatiquement par `refuseRegistration` quand un member a été pré-créé). Les rules `firestore.rules /members` n'ouvrent **pas** de chemin client dédié — seul l'Admin SDK écrit l'archive (audit centralisé, idempotence, log dans `actionLog` éventuel).
- **`archivedAt`** : `serverTimestamp()` au moment de l'archive.
- **`archivedReason`** : texte libre passé à la callable. Affiché dans l'UI admin (ex. carte "Members archivés" Settings).
- **`archivedByUid`** : UID de l'admin/coach ayant déclenché. Pour audit.
- **Lecture** : les members archivés restent lisibles par les rôles club habituels (admin/coach/official/linkedMember/guardian) — masqués par défaut côté UI via filtre `status == 'active'`.
- **Réactivation** : prévu via une seconde callable `unarchiveMember` (set `status='active'`, clear les champs `archived*`) ; non livré dans la phase courante.

#### `member.birthDate`

`Timestamp | null`. Source unique pour dériver `isMinor(birthDate) = birthDate != null && birthDate < now - 18ans`. `null` est traité comme adulte côté defaults mais l'UI doit avertir l'admin (la date impacte directement le routage des comms). Cf. `main.md` → "Mineurs, tuteurs & communications".

#### `member.guardianUserIds`

`string[]`. UIDs des users portant (ou destinés à porter) le rôle `parent` et rattachés à ce membre. Source de vérité du lien tuteur ↔ pupille (1 membre → 0..N tuteurs, 1 user → N pupilles). Écriture admin uniquement.

#### `member.comms` — `MemberCommsConfig`

```ts
{
  billingRecipients: ("member" | "guardians")[]   // factures, notifs cotisations
  generalRecipients: ("member" | "guardians")[]   // assignations, planning, rappels
  majorityTransition: MajorityTransitionState | null
}
```

Defaults à la création (`createMember`) :
- Mineur (`isMinor(birthDate) === true`) : `billing = ['guardians']`, `general = ['guardians']`.
- Majeur (ou `birthDate == null`) : `billing = ['member']`, `general = ['member']`.

Surcharges autorisées :
- `admin` : tout (ajouter, retirer, remplacer sur `billing` et `general`).
- `coach` d'une équipe du membre : `generalRecipients` uniquement — peut ajouter `'member'` pour un mineur de son équipe. **Pas de droit** sur `billingRecipients`, ni de droit de retirer `'guardians'`.

Toute autre écriture refusée par les rules.

#### `member.comms.majorityTransition` — state machine

```ts
{
  triggeredAt: Timestamp                         // posé par onMajorityReached (scheduled)
  guardiansResponse: MajorityResponse | null     // { answer: 'yes'|'no', respondedAt, respondedByUid }
  memberResponse: MajorityResponse | null
  resolvedAt: Timestamp | null                   // posé quand le résultat est appliqué à comms.generalRecipients
}
```

Trois étapes (voir `main.md` → "Transition à la majorité" pour le détail business) :

1. **Détection** — Function scheduled `onMajorityReached` détecte `birthDate + 18ans <= now && majorityTransition == null` → set `triggeredAt`, bascule `comms.billingRecipients = ['member']` (immédiat, indépendant du flow), écrit `/pendingEmails/{memberId}_majority_guardian_notify`.
2. **Réponse guardian** — callable `respondGuardianConsent` set `guardiansResponse`.
   - `no` → `generalRecipients = ['member']`, `resolvedAt = now`. Fin.
   - `yes` → écrit `/pendingEmails/{memberId}_majority_member_confirm`. Attente étape 3.
3. **Confirmation membre** — callable `respondMemberConsent` set `memberResponse` + `resolvedAt`, applique :
   - `yes` → `generalRecipients = ['member', 'guardians']`.
   - `no` → `generalRecipients = ['member']`.

Invariants :
- Tant que `resolvedAt == null`, les defaults mineurs restent appliqués sur `generalRecipients`.
- `billingRecipients` bascule sur `['member']` dès `triggeredAt`, **indépendamment** du consentement.
- `majorityTransition` reste figé après `resolvedAt` (audit) — on ne le re-déclenche pas.

#### `member.avs` & `member.transferState`

`avs` : numéro AVS au format `756.XXXX.XXXX.XX`. Distinct de `licenseNumber` (ID fédéral). Saisi via l'app register lors d'une inscription ; édité par admin pour les cas particuliers (réfugiés en procédure d'asile, regroupement familial). `null` = pas encore connu.

`transferState` : état de transfert du joueur, mis à jour par l'admin lors d'une procédure de transfert national (clean) ou international (FIBA / Swiss Basketball). Defaults à `'none'`. Lifecycle hors-bande — pas de Function trigger automatique en v1.

### `/members/{memberId}/private/contact` (singleton, ID fixe `contact`)
```ts
{
  email: string
  phone: string
}
```
Lecture : `rootAdmin`, `admin`, `coach`, le membre lui-même (via `linkedUserId == request.auth.uid`), **et** tout user dont l'UID est dans `member.guardianUserIds` (tuteur).
Écriture : `rootAdmin`, `admin`, et le membre lui-même.
Les `official`-only (pas admin, pas coach, pas tuteur) **ne voient pas** ce doc.

### `/roles/{roleId}`
```ts
{ name: string, type: "system" | "custom", color: string, createdAt: Timestamp }
```
System : `player`, `official`, `coach`, `referee`.

### `/invitations/{inviteId}`
```ts
{
  email: string                // lowercased — clé de lookup
  role: string                 // 'admin' pour le MVP
  invitedBy: string            // uid de l'admin qui a invité
  invitedByName: string        // dénormalisé pour UI
  createdAt: Timestamp
}
```
MVP : pas d'email envoyé, l'admin partage manuellement avec l'invité. À sa première sign-in OAuth, le flow auth client appelle `acceptInvitation` (callable) qui crée `/users/{uid}` à partir de l'invitation puis supprime ce doc. Pas de `expiresAt` pour le MVP.

### `/venues/{venueId}`
```ts
{ name, address, coordinates: GeoPoint, closurePeriodIds: string[], customClosures: [{name, startDate, endDate}] }
```

### `/venues/{venueId}/courts/{courtId}`
```ts
{
  name: string
  courtSize: "small" | "normal" | "large"   // pas de hiérarchie
  isCombined: boolean
  combinedCourtIds: string[]                 // si isCombined
  sport: string
  active: boolean
}
```
**Invariants** (enforced UI Venues.vue, voir `main.md → Venues & courts`) :
- `combinedCourtIds` ne référence que des courts de la même salle (same-venue only).
- Un combiné ne peut pas inclure un autre combiné (`isCombined: false` pour tous les courts listés). Pas de chaîne A→B→C.
- `isCombined: true` exige `combinedCourtIds.length > 0` (sinon erreur de validation côté UI).

Réservation d'un court combiné → le booking generator crée N bookings liés (cf. `linkedBookingIds` + `isCombinedCourtEvent: true` sur `/bookings`). Implémentation booking generator côté Cloud Functions à venir (Phase 2).

### `/venues/{venueId}/courts/{courtId}/timeSlots/{slotId}`
```ts
{
  dayOfWeek: number       // 0 = Sunday
  startTime: string       // "HH:MM"
  endTime: string
  label: string
  seasonId: string
  requiresFullCourt: boolean
  teamId: string | null
  slotType: "training" | "match_home" | "match_away" | "reserve" | "custom"
  customTypeName: string | null
  matchTypeId: string | null    // requis si match_home/match_away
  active: boolean
}
```

### `/seasons/{seasonId}`
```ts
{
  name: string                    // "2025-2026"
  startDate, endDate: Timestamp
  status: "draft" | "active" | "archived"
  activeVenueIds: string[]        // venues sélectionnés pour cette saison
  closurePeriodIds: string[]
  generatedAt: Timestamp | null
}
```

### `/closurePeriods/{periodId}`
```ts
{ name, startDate, endDate: Timestamp, type: "holiday" | "custom", createdBy: string }
```

### `/teams/{teamId}`
```ts
{
  name: string                    // "U20F"
  categoryId: string              // ref → /categories/{categoryId}
  gender: "M" | "F" | "mixed"
  coachIds: string[]              // memberIds
  playerIds: string[]             // memberIds
  activeSeasonIds: string[]
  cotisationId: string            // ref → /cotisations/{id}
  schedulingConstraints: {
    preferredDays: [{ dayOfWeek, priority }]
    maxStartTime: string
    minHoursBetweenSlots: number
    trainingsPerWeek: number
    anticipatedMatches: number
    coachAvailability: [{ coachMemberId, unavailableDays, unavailableSlots }]
  }
  tags: [{ tagId: string, display: boolean }]  // ref → /tags/{tagId}, display flag par-équipe
  registrationStatus: "open" | "conditional" | "closed"
  openHandbook: string                   // markdown court, affiché branche équipe ouverte
  conditionalDescription: string         // markdown court, affiché branche sous-conditions
  conditionalCriteria: string[]          // tags chips d'affichage
  publicTagline: string | null           // accroche fiche publique (app register)
  publicHeadCoachMemberId: string | null // ref memberId, null = premier coachIds utilisé
  active: boolean
  createdAt: Timestamp
}
```
`categoryId` est une référence (pas un libellé dénormalisé) — le nom d'affichage et la tranche d'âge sont résolus à la lecture via `/categories/{id}`. Pour la liste des équipes, le repo bat un seul `getDocs('/categories')` puis enrichit chaque team (pas de N+1).

`tags` permet de différencier visuellement des équipes similaires (ex. deux U14M). Chaque entrée référence un `/tags/{id}` et porte un flag `display` propre à l'équipe : un même tag peut être attaché à plusieurs équipes mais n'être affiché que sur certaines (cf. `/tags` ci-dessous et `main.md` → "Tags d'équipes"). Résolu par batch lookup à la lecture (pattern identique aux catégories).

`cotisationId` est également une référence (pas un montant dénormalisé) — le nom et le prix sont résolus à la lecture via `/cotisations/{id}` (résolution batch via `cotisations.repo`, miroir du pattern catégories/tags). Cf. `/cotisations` plus bas et `main.md` → "Cotisations".

#### `team.registrationStatus` et champs publics

`registrationStatus` pilote l'affichage dans le TeamPicker de l'app register (cf. `docs/chantier-registrations.md` §4.5) :
- `open` : pill verte, sélectionnable, affiche le `openHandbook`.
- `conditional` : pill ambre, sélectionnable, affiche `conditionalDescription` + `conditionalCriteria`.
- `closed` : pill rouge, grisée, non-sélectionnable.

`openHandbook` et `conditionalDescription` sont des textes libres rédigés par le coach ou l'admin depuis l'app web. `publicTagline` et `publicHeadCoachMemberId` sont des champs cosmétiques (fiche publique). Aucun n'est dénormalisé sur `/registrations` — tout est résolu à la lecture.

### `/teams/{teamId}/refusalLogs/{logId}`
```ts
{
  registrationId: string
  playerName: string                  // dénormalisé pour debug
  reason: string                      // texte libre, obligatoire
  refusedAt: Timestamp
  refusedByUid: string                // coach
}
```

Écrit uniquement par la callable `refuseRegistration` (Admin SDK, rules `allow write: if false`). Lecture admin uniquement. Vue admin "tous les refus" via `collectionGroup('refusalLogs')` (cf. `firestore_collectiongroup_pattern`).

### `/categories/{categoryId}`
```ts
{
  name: string                    // "U14", "Seniors A", "Loisirs"
  minAge: number | null           // null = catégorie ouverte par le bas (Seniors, Veterans)
  maxAge: number | null           // null = catégorie ouverte par le haut (Seniors+)
  displayOrder: number            // tri stable dans les UIs (chip order, picker)
  active: boolean                 // false = archivée (ne propose plus dans le picker, teams existantes inchangées)
  createdAt: Timestamp
}
```
Référentiel éditable par l'admin (Settings → Catégories). Remplace la heuristique locale `CATEGORY_AGE_RANGES` qui vivait dans `apps/web/src/repositories/teams.repo.ts`. Le nom et la tranche d'âge ne sont **pas** dénormalisés sur `/teams` : une catégorie renommée se reflète automatiquement sur toutes ses équipes (cf. lifecycle dans `docs/main.md`).

Décisions clés :
- **`active: false` vs delete** : on archive plutôt que supprimer pour éviter les FK orphelines sur `/teams.categoryId`. Une catégorie archivée disparaît du picker de création/édition d'équipe mais reste résolvable en lecture.
- **`displayOrder`** : entier, l'admin peut le maintenir manuellement (drag-to-reorder UI). Tie-break secondaire par `minAge` croissant puis `name`.
- **`minAge` / `maxAge` nullable** : pour les catégories ouvertes (Seniors, Loisirs, Veterans 35+). Le label UI dérive : `null,null` → "Ouvert" ; `min,null` → "min ans+" ; `min,min` → "min ans" ; `min,max` → "min-max ans".
- **Pas de `gender` sur catégorie** : le genre reste sur `/teams.gender` — une catégorie "U14" peut produire une équipe M, F ou mixed.

### `/tags/{tagId}`
```ts
{
  name: string                    // "Élite", "Loisir", "U14 A", "Compet"
  color: "emerald" | "sky" | "amber" | "rose" | "violet" | "slate"
  displayOrder: number            // tri stable dans pickers
  active: boolean                 // false = archivée (n'apparaît plus dans le picker, teams existantes inchangées)
  createdAt: Timestamp
}
```
Référentiel éditable par l'admin (Settings → Tags). Permet de **différencier** des équipes similaires (deux U14M, version "compet" vs "loisir", etc.). Référencé par `/teams.tags[].tagId` avec un flag `display` par-équipe (cf. `/teams` plus haut).

`color` est un alias borné sur le design system (variants du composant `Pill` côté web) — pas de hex libre pour rester cohérent avec le reste de l'app. Le nom est résolu à la lecture (pas dénormalisé sur `/teams`).

Décisions clés :
- **`active: false` vs delete** : on archive plutôt que supprimer pour éviter les FK orphelines sur `/teams.tags[].tagId`. Suppression refusée tant qu'au moins une équipe référence le tag.
- **`display` par-équipe et pas par-tag** : un tag peut servir à filtrer/comparer côté admin sans être visible publiquement sur certaines équipes. Stocké inline dans `/teams.tags` plutôt que sur `/tags` (cf. `main.md`).
- **Pas de tag implicite par catégorie** : `categoryId` et `tags` sont orthogonaux — un tag n'hérite jamais d'une catégorie ni l'inverse.

### `/cotisations/{cotisationId}`
```ts
{
  name: string                    // "Cotisation Junior", "Cotisation Senior"
  description: string             // texte libre court
  price: number                   // CHF/an/joueur (>= 0)
  displayOrder: number            // tri stable dans pickers
  active: boolean                 // false = archivée (n'apparaît plus dans le picker, teams existantes inchangées)
  createdAt: Timestamp
}
```
Référentiel éditable par l'admin (Settings → Cotisations). Standardise les montants annuels appliqués aux équipes. Référencé par `/teams.cotisationId` (une équipe **référence** une cotisation, pas un montant libre). Le nom et le prix ne sont **pas** dénormalisés sur `/teams` : un rename/reprice se reflète automatiquement (résolution batch via `cotisations.repo`, pattern identique aux catégories/tags).

Décisions clés :
- **`active: false` vs delete** : on archive plutôt que supprimer pour éviter les FK orphelines sur `/teams.cotisationId`. Suppression refusée tant qu'au moins une équipe référence la cotisation.
- **Prix en CHF/an/joueur** : le repo n'enforce pas la devise — c'est une convention club (un seul `config/club.currency` éventuel à wirer plus tard si besoin multi-devise).
- **Pas de dénormalisation** : nom et prix résolus à la lecture par `teams.repo` (batch lookup, identique aux catégories et tags). Un changement de prix s'applique aux **nouveaux** dues émis, pas rétroactivement aux dues déjà créés (cf. Function `initiateDuesOnPlayerActivation`).

### `/matchTypes/{matchTypeId}`
```ts
{
  name: string
  requiredCourtSize: "small" | "normal" | "large"
  homeOfficialRequirements: [{ level: number, count: number }]
  awayOfficialCount: number
  color: string
  active: boolean
  createdAt: Timestamp
}
```

### `/bookingSeries/{seriesId}`
```ts
{
  seasonId, venueId, courtId: string
  teamId: string | null
  slotType: string                  // "training" | "match_home" | "match_away" | "reserve" | "custom"
  matchTypeId: string | null
  startDate, endDate: Timestamp     // bornes de la récurrence (endDate incluse, obligatoire au MVP)
  startTime, endTime: string        // "HH:MM" appliqué à chaque occurrence
  recurrence: {
    frequency: "weekly" | "monthly"
    interval: number                // 1 au MVP, réservé pour évolution
    weekday: number | null          // 0-6 (0=dimanche) si "weekly", sinon null
    monthlyMode: "dayOfMonth" | "nthWeekday" | null  // null si "weekly"
  }
  considerClosures: boolean         // si true, les occurrences tombant pendant une closure sont skippées à la création
  title: string                     // libellé humain ("Yoga seniors", "Camp préparation")
  notes: string | null
  createdBy: string                 // uid admin
  createdAt: Timestamp
}
```

Modélise une **réservation manuelle récurrente** créée depuis l'écran `/bookings` (pas générée par `generateSeasonBookings`). Pattern Outlook : la série porte la règle, chaque occurrence vit dans `/bookings/{id}` avec `seriesId` pointant ici. Un one-shot manuel (pas récurrent) n'a pas de série — c'est juste un `/bookings/{id}` avec `isManual: true` et `seriesId: null`.

**Édition** : 3 scopes côté UI (Outlook-style) :
- `occurrence` → mute un seul booking (override)
- `future` → réécrit la série et toutes les occurrences futures, split éventuel si déjà entamée
- `all` → réécrit tous les bookings de la série

**Garde-fou** : les occurrences passées (`date < now`) sont immuables sur les champs `date` / `startTime` / `endTime` / `courtId`. Les autres champs (notes, teamId, status pour rétro-cancel) restent éditables.

**Closures** : si `considerClosures: true`, la génération initiale skippe les dates intersectant `/closurePeriods` rattachés au venue + `venue.customClosures`. Idem à l'édition futur/all.

### `/bookings/{bookingId}`
```ts
{
  seasonId, venueId, courtId, timeSlotId: string
  teamId: string | null
  slotType: string                  // mirroré à la génération
  matchTypeId: string | null        // dénormalisé depuis /matches/{matchId}.matchTypeId quand un match est attaché
  opponentName: string | null       // dénormalisé depuis /matches/{matchId}.opponentName ; null pour les bookings non-match
  matchId: string | null            // ref vers /matches/{matchId} pour bookings match_home assignés ; null sinon (pending ou autres slotTypes)
  awayAddress: string | null        // legacy — n'est plus écrit par le nouveau flow matches ; conservé pour compat des anciens docs match_away
  date: Timestamp
  startTime, endTime: string
  status: "scheduled" | "cancelled" | "freed"
  cancelReason: string | null       // "closure" | "holiday" | "manual" | "match_home" | "match_away" | "coach_cancel" | "series_edit"
  linkedBookingIds: string[]        // courts combinés
  isCombinedCourtEvent: boolean
  seriesId: string | null           // ref → /bookingSeries/{seriesId} ; null si one-shot manuel ou booking auto-généré
  originalDate: Timestamp | null    // date d'origine prévue par la série (utile si l'occurrence est déplacée via override) ; null hors série
  isManual: boolean                 // true si créé manuellement (one-shot ou via série) ; false si généré par generateSeasonBookings
  actionLog: [{ at: Timestamp, by: string, action: string, note: string | null }]
}
```
**Append-only** sur `actionLog`. Sub-collections : `officialAssignments/` (sur `match_home`), `attendance/`.

### `/bookings/{bookingId}/officialAssignments/{assignmentId}`
```ts
{
  memberId: string
  officialLevel: number              // au moment de l'assignation
  status: "pending" | "confirmed" | "declined"
  assignedAt: Timestamp
  assignedBy: string
  respondedAt: Timestamp | null
}
```

### `/bookings/{bookingId}/attendance/{attendanceId}`
```ts
{
  bookingId, memberId: string
  status: "present" | "absent" | "excused"
  recordedBy: string
  recordedAt: Timestamp
  note: string | null
}
```

### `/matches/{matchId}`

```ts
{
  bookingId: string | null          // ref → /bookings/{bookingId} pour kind='home' ; null pour kind='away'
  kind: "home" | "away"
  teamId: string                    // notre équipe locale
  matchTypeId: string               // ref → /matchTypes/{matchTypeId}
  opponentName: string | null       // optionnel pour home (peut être inconnu) ; obligatoire pour away
  awayAddress: string | null        // adresse extérieure — uniquement si kind='away'
  date: Timestamp                   // 00:00 local. Dénormalisé depuis le booking pour home, source de vérité pour away
  startTime, endTime: string        // "HH:MM" — dénormalisés pour home, sources pour away
  status: "scheduled" | "cancelled" | "played"
  notes: string | null
  createdAt: Timestamp
  createdBy: string                 // uid admin
}
```

**Référence bidirectionnelle (kind='home')** : `match.bookingId` ↔ `booking.matchId`. Création/suppression via `writeBatch` atomique (cf. `apps/web/src/repositories/matches.repo.ts`). Champs dénormalisés sur le booking (`matchTypeId`, `opponentName`) pour permettre au calendrier de rendre les events sans join supplémentaire.

**Rules** : `read` signed-in, `create/update/delete` admin uniquement.

### `/matches/{matchId}/officialAssignments/{assignmentId}`

```ts
{
  memberId: string
  officialLevel: number              // snapshot au moment de l'assignation
  status: "pending" | "confirmed" | "declined"
  assignedAt: Timestamp
  assignedBy: string
  respondedAt: Timestamp | null
}
```

Assignations d'officiels d'un match **à l'extérieur** (`kind='away'`). Schéma **identique** à `/bookings/{bookingId}/officialAssignments` — mais comme un match away n'a pas de booking, ses assignations sont portées directement par le doc match. Le besoin d'officiels vient de `matchType.awayOfficialCount` (total simple, pas de ventilation par niveau, contrairement à `homeOfficialRequirements`).

**Rules** : identiques à la sous-collection des bookings — `read` signed-in ; `create` admin/rootAdmin ou self-register (`status=='pending'` + `memberId == userDoc().memberId`) ; `update` admin/rootAdmin ou l'official sur `status`/`respondedAt` de sa propre assignation ; `delete` admin/rootAdmin.

Le type partagé `OfficialAssignment` (`packages/shared-types/src/booking.ts`) couvre les deux sous-collections.

### `/matchRequests/{requestId}`
```ts
{
  bookingId: string                  // match_home à déplacer
  requestedBy: string                // coach uid
  requestType: "move_home"
  proposedDate: Timestamp | null
  proposedSlotId: string | null
  reason: string | null
  status: "pending" | "approved" | "rejected"
  reviewedBy: string | null
  reviewedAt: Timestamp | null
  adminComment: string | null
  createdAt: Timestamp
}
```

### `/notifications/{notificationId}`
```ts
{
  type: "new_match" | "officials_needed" | "urgent" | "match_reminder"
  title, body: string
  sentBy: string | null              // null si auto
  targetAudience: "all_officials" | "unassigned_officials" | "assigned_officials"
  relatedBookingId: string | null    // booking lié — match à domicile uniquement ; null sinon
  relatedMatchId: string | null      // /matches lié — renseigné pour les matchs à l'extérieur (pas de booking)
  createdAt: Timestamp
  readBy: string[]                   // uids
}
```

### `/pendingEmails/{emailId}`

```ts
{
  to: string[]                       // emails destinataires
  subject: string
  body: string                       // plain text ou HTML selon le template
  templateKey: string                // "majority_guardian_notify" | "majority_member_confirm" | ...
  context: Record<string, unknown>   // données utilisées par le template (memberId, memberName, etc.)
  createdAt: Timestamp
  sentAt: Timestamp | null           // null tant qu'aucun vendor n'a délivré
  status: "pending" | "sent" | "failed"
  error: string | null
}
```

**Stub d'envoi d'email**. Le vendor réel (SendGrid / Resend / Postmark) sera wiré ultérieurement via une Function trigger `onCreate /pendingEmails/{id}`. Tant que pas de vendor, les docs s'accumulent en `status: 'pending'` et restent inspectables par l'admin.

**Conventions de Doc ID** — déterministes pour idempotence des Functions productrices (cf. mémoire `firestore_functions_phase1` → IDs déterministes) :

| Producteur | Doc ID | `templateKey` | Trigger |
|---|---|---|---|
| `onMajorityReached` | `{memberId}_majority_guardian_notify` | `majority_guardian_notify` | Atteinte des 18 ans (1 mail aux guardians) |
| `respondGuardianConsent` (answer=`yes`) | `{memberId}_majority_member_confirm` | `majority_member_confirm` | Guardians acceptent → mail de confirmation au membre |
| `submitRegistration` | `{registrationId}_submission_ack` | `registration_submitted` | Confirmation au user qui a soumis une registration |
| `initiateDuesOnPlayerActivation` *(ou `issueDuesScheduled` à l'émission)* | `{dueId}_payment_request` | `dues_payment_request` | Émission d'un due `issued` — demande de paiement envoyée aux `member.comms.billingRecipients`. Idempotent via `due.emailedAt`. |
| `markDuePaid` (callable) | `{dueId}_payment_confirmed` | `dues_payment_confirmed` | Paiement enregistré — confirmation envoyée aux `billingRecipients`. |

#### `context` attendu par template

- **`dues_payment_request`** :
  ```ts
  {
    dueId: string
    memberId: string
    memberName: string                    // "Prénom Nom"
    teamId: string
    teamName: string
    seasonId: string
    seasonName: string
    amount: number                        // CHF
    paymentReference: string | null       // ex. "DUE-abc123"
    dueAt: Timestamp                      // J+paymentDueDays
    banking: BankingInfo | null           // copié depuis /config/club.banking au moment de l'émission
    clubName: string
    clubContact: { email: string, phone: string }
  }
  ```
- **`dues_payment_confirmed`** :
  ```ts
  {
    dueId: string
    memberId: string
    memberName: string
    teamId: string
    teamName: string
    seasonId: string
    seasonName: string
    paidAmount: number
    paidAt: Timestamp
    paymentMethod: "cash" | "transfer" | "other"
    recordedBy: string                    // uid admin/treasurer (audit)
    clubName: string
  }
  ```

**Rules** : écriture restreinte aux Functions (et `rootAdmin` pour debug). Lecture admin uniquement.

### `/dues/{dueId}`
```ts
{
  memberId, teamId, seasonId: string
  amount: number                     // copié de team.duesAmount à la création
  activatedAt: Timestamp             // J0
  issuedAt: Timestamp | null         // activatedAt + gracePeriodDays, posé à la création (pas null pendant pending_grace) ; nullable seulement pour tolérer lignes legacy
  dueAt: Timestamp | null            // issuedAt + paymentDueDays
  status: "pending_grace" | "issued" | "paid" | "overdue" | "excepted" | "cancelled"
  paidAt: Timestamp | null
  paidAmount: number | null
  paymentMethod: "cash" | "transfer" | "other" | null
  recordedBy: string | null          // uid admin OU treasurer ayant marqué payé via callable
  exceptionRequestId: string | null
  notes: string | null
  paymentReference: string | null    // référence virement déterministe ("DUE-{shortDueId}") posée à la création
  emailedAt: Timestamp | null        // marqueur idempotence email "à payer" (null = pas encore envoyé)
  createdAt: Timestamp
}
```
Un `due` par joueur/saison/team. Switch d'équipe mid-saison : TBD (probablement garder le due original).

#### `paymentReference` & `emailedAt`

- **`paymentReference`** : référence de virement **déterministe** (typiquement `"DUE-{shortDueId}"` où `shortDueId` est le préfixe canonique du doc ID). Posée par `initiateDuesOnPlayerActivation` à la création. Affichée dans l'email `dues_payment_request`, attendue dans le champ "référence" du virement bancaire. `null` toléré pour les lignes legacy antérieures au chantier — l'email omet alors la référence (l'admin tag manuellement).
- **`emailedAt`** : marqueur d'idempotence pour l'email "à payer". Non-null ⇒ un doc `/pendingEmails` avec `templateKey == 'dues_payment_request'` a déjà été écrit pour ce due — on **ne re-déclenche pas** (même si le trigger est rejoué). Posé par la fonction qui produit l'email :
  - à l'émission `pending_grace → issued` (cas standard, `issueDuesScheduled`),
  - **ou** immédiatement à la création si le due naît déjà `issued` (cas où `gracePeriodDays === 0`).

#### Lecture / écriture côté rôles

| Rôle | Read | Write direct | Action via callable |
|---|---|---|---|
| `admin` / `rootAdmin` | tout | autorisé (filets de sécurité) | — |
| `treasurer` | tout (vue globale paiements) | **refusé** par les rules | `markDuePaid` (pose `paid`, `paidAt`, `paidAmount`, `paymentMethod`, `recordedBy`) ; `updateDue` (édite dates / statut / note) |
| `coach` (scope team) | dues de ses teams | refusé | `paymentExceptionRequest` (cf. `/paymentExceptionRequests`) |
| **Membre lié** (`linkedUserId`) | sa propre cotisation uniquement | refusé | — (paiement par virement externe, marquage par admin/treasurer) |
| **Tuteurs** (`guardianUserIds`) | les cotisations des membres dont ils sont tuteurs | refusé | — |

Le treasurer n'écrit jamais directement dans `/dues` — toute action passe par la callable `markDuePaid` (Admin SDK, validation `treasurer || admin` côté serveur). Idem pour les transitions automatiques (`issueDuesScheduled`, `markOverdueScheduled`, `applyPaymentException`) qui restent dans les Functions.

**Garde "montant partiel" (callable `markDuePaid`)** : la callable accepte n'importe quel `paidAmount` côté input, mais **rejette en `permission-denied`** tout caller qui tente `paidAmount < due.amount` sans avoir le claim `rootAdmin` OU le rôle `treasurer`. Un caller avec rôle `admin` seul ne peut donc poser que `paidAmount === due.amount` (ou laisser le champ vide → default au plein tarif). Le helper `assertCanRecordPartial` vit dans `functions/src/dues/markDuePaid.ts` ; la garde est posée **après** lecture transactionnelle de `due.amount` pour comparer au montant fourni. Cas d'usage : arrangement comité in extremis (cf. `docs/main.md` → Cotisations).

**Édition d'une cotisation (callable `updateDue`)** : édite une cotisation hors flux paiement. Auth : signed-in + (claim `rootAdmin` OU rôle `admin` OU `treasurer`), sinon `permission-denied`. Input wire `{ dueId, activatedAt?, issuedAt?, dueAt?, status?, notes? }` — dates en epoch millis ; champ absent = inchangé ; `null` explicite efface `issuedAt` / `dueAt` / `notes` (`activatedAt` non nullable). **Le montant (`amount`) n'est pas éditable** ; **`status: 'paid'` est refusé** (`invalid-argument`) — le passage à payé passe par `markDuePaid`. L'`update` est fait via Admin SDK ; le trigger `syncMemberDuesStatus` recalcule `member.duesStatus`. Aucun champ `updatedBy` / `updatedAt` ajouté au schéma. Fichier : `functions/src/dues/updateDue.ts`. Wrapper web : `updateCotisation` dans `apps/web/src/services/cloudFunctions.ts`.

**Note rules — lecture parent/membre.** La rule `read` exécute deux `get()` Firestore (`/members/{resource.data.memberId}`) pour vérifier `linkedUserId == auth.uid` puis `auth.uid in guardianUserIds`. Coût : 2 lectures supplémentaires par doc évalué — borné car l'app `courtbase-register` filtre toujours `where memberId in [...]` côté client (chunk ≤ 30 docs). Acceptable pour le volume attendu (1–3 cotisations actives par foyer). Pas de cache rule-side : si une cotisation référence un `memberId` qui n'existe plus, le `get()` échoue et la lecture est refusée — comportement souhaité (cohérence référentielle).

### `/paymentExceptionRequests/{requestId}`
```ts
{
  dueId, memberId, teamId: string
  requestedBy: string                // coach uid
  reason: string
  status: "pending" | "approved" | "rejected"
  reviewedBy: string | null
  reviewedAt: Timestamp | null
  adminComment: string | null
  newIssuedAt: Timestamp | null
  newDueAt: Timestamp | null
  createdAt: Timestamp
}
```
Tant que `pending` → `member.duesStatus = "excepted"`, exclusion suspendue.

### `/licenseTypes/{licenseTypeId}`
```ts
{
  role: "player" | "official" | "coach" | "referee"
  level: number | null              // ordinal propre au rôle ; null = pas de notion de niveau
  name: string                      // libellé ("Officiel J+S", "Joueur Ligue A"…)
  fee: number                       // CHF, prix courant
  displayOrder: number
  active: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}
```
Référentiel éditable par l'admin (Settings → Licences).

**Règle rôle/niveau** : seuls `official`, `coach` et `referee` portent un niveau (numérique, requis). Le rôle `player` a **toujours** `level: null` — les différents types de licence joueur (Junior, Senior, …) sont distingués par leur `name`. Cette règle est validée côté store (`validateRoleLevel`) avant chaque create/update.

**Unicité** : `(role, level)` enforced UI/store **uniquement pour les rôles avec niveau** (où `level !== null`). Pour les joueurs (level=null par convention), pas de contrainte d'unicité côté niveau — l'admin peut avoir plusieurs licences joueur distinguées par leur nom.

`fee` est le prix **courant** ; au moment de l'émission d'une licence (entité `/licenses` à venir), il sera snapshotté dans la transaction comptable pour préserver l'historique malgré les évolutions de grille.

### `/licenseRequests/{requestId}`
```ts
{
  memberId, teamId: string
  requestedBy: string                // coach mobile
  status: "pending" | "approved" | "rejected"
  reviewedBy: string | null
  reviewedAt: Timestamp | null
  adminComment: string | null
  createdAt: Timestamp
}
```
Approval → `member.licensed = true`. Procédure fédérale hors-bande.

### `/registrations/{registrationId}`
```ts
{
  // Auteur de la registration (créateur du compte app register)
  submittedByUid: string

  // Type d'inscription
  registrationFor: "self" | "dependent"
  relationship: "parent" | "legal_guardian" | "sibling" | "caritas" | "other" | null
  relationshipOther: string | null         // si relationship === 'other'

  // Identité joueur (transmise telle quelle ; pas encore un /member)
  player: {
    firstName: string
    lastName: string
    birthDate: Timestamp
    gender: "M" | "F" | "other" | null
    avs: string | null
    avsUnavailable: boolean
    phone: string | null
  }

  // Lien à un /member existant (si AVS match ou confirmation fuzzy match)
  matchedMemberId: string | null

  // Équipe choisie
  teamId: string

  // Historique sportif
  previouslyLicensed: boolean
  previousClubName: string | null
  previousClubAbroad: boolean
  transferLetterStoragePath: string | null  // Storage path, null si pas uploadé
  foreignTransfer: boolean                  // flag transverse

  // Lifecycle
  status: RegistrationStatus
  statusUpdatedAt: Timestamp
  trialStartedAt: Timestamp | null
  refusalReason: string | null
  refusedByUid: string | null

  // Append-only log (transferts, refus, transitions)
  actionLog: RegistrationActionLogEntry[]

  // Notifs
  coachNotifiedAt: Timestamp | null
  adminNotifiedAt: Timestamp | null

  createdAt: Timestamp
}

type RegistrationStatus =
  | "draft"
  | "submitted"
  | "open_pending_trial"
  | "conditional_pending_review"
  | "conditional_pending_trial"
  | "trial_in_progress"
  | "confirmed_pending_dues"
  | "active"
  | "refused"
  | "cancelled"

interface RegistrationActionLogEntry {
  at: Timestamp
  byUid: string
  action: "created" | "submitted" | "status_changed" | "team_changed" | "refused" | "document_uploaded"
  previousStatus?: RegistrationStatus
  newStatus?: RegistrationStatus
  note?: string
}
```

Représente une demande d'inscription faite via l'app `apps/courtbase-register` (portail public parents/joueurs). Crée à l'inscription une `/registrations/{id}` que coachs et admins voient dans l'app web. **N'émet pas de licence** — c'est un workflow séparé (`/licenseRequests`, voir Phase E du chantier). Sub-collection optionnelle `/registrations/{id}/documents/` pour les fichiers liés à la registration elle-même (lettre de sortie principalement).

#### Lifecycle

```
draft → submitted → open_pending_trial → trial_in_progress → confirmed_pending_dues → active
                  ↘ conditional_pending_review → conditional_pending_trial ↗
                                              ↘ refused (terminal, sauf auto-rerouting)

submitted → cancelled (par le user avant validation coach, terminal)
```

`draft` / `submitted` posés par l'app register, `open_pending_trial` / `conditional_pending_review` à la soumission selon `team.registrationStatus`, transitions suivantes posées par le coach (web) via callables. `active` est posé par Function quand le paiement de la cotisation est reçu. `foreignTransfer` est un flag transverse indépendant du status. Détail produit complet : `docs/chantier-registrations.md` §6.

#### Rules

- Lecture : auteur (`submittedByUid`), tuteur du `matchedMemberId` (si défini), coach de la `teamId`, admin.
- Création : auteur uniquement (`request.auth.uid == submittedByUid`).
- Update client : autorisé **uniquement** sur `status == "draft"` par l'auteur (autosave wizard). Toutes les autres transitions passent par les callables (`submitRegistration`, `refuseRegistration`, etc.) — garantit l'intégrité du lifecycle.
- Delete : `false` (jamais).

### `/accounts/{accountId}`
```ts
{
  number: string                    // code comptable, unique (ex. "3000")
  name: string
  nature: "actif" | "passif" | "charge" | "produit"
  isTreasury: boolean               // true = compte de trésorerie (Caisse/Banque)
  description: string | null
  isDefault: boolean                // true = compte seedé par défaut (protégé en suppression)
  active: boolean
  displayOrder: number              // tri stable
  createdAt: Timestamp
}
```
Plan comptable du module Comptabilité. Édité par le trésorier (Settings / Comptabilité). `nature` détermine le sens du solde (`actif`/`charge` → Σdébit−Σcrédit ; `passif`/`produit` → Σcrédit−Σdébit). `isTreasury` marque les comptes utilisables comme contrepartie automatique dans la saisie simplifiée. Comptes par défaut seedés au démarrage du module (`isDefault: true`) — voir `docs/compta.md` pour la table. Accès : `treasurer` + `rootAdmin` uniquement. Détail : `docs/compta.md`.

### `/accountingEntries/{entryId}`
```ts
{
  date: Timestamp
  label: string
  reference: string | null          // n° de pièce / libellé externe
  source: "credit" | "invoice" | "manual"
  invoiceId: string | null          // ref /invoices si source === 'invoice'
  lines: AccountingEntryLine[]       // >= 2 lignes, équilibrées : Σ debit === Σ credit
  reversed: boolean                  // true si contre-passée
  reversalOfEntryId: string | null   // si cette écriture EST une contre-passation
  createdBy: string                  // uid trésorier / rootAdmin
  createdAt: Timestamp
}

interface AccountingEntryLine {
  accountId: string
  debit: number                     // >= 0
  credit: number                    // >= 0 — exactement un des deux > 0, l'autre = 0
}
```
Journal des écritures en partie double. **Append-only** : `allow delete: if false` — l'annulation d'une écriture passe par une contre-passation (écriture inverse, `reversed` + `reversalOfEntryId`). Invariant équilibre `Σ debit === Σ credit` validé côté applicatif. Accès : `treasurer` + `rootAdmin`. Détail : `docs/compta.md`.

### `/invoices/{invoiceId}`
```ts
{
  supplierName: string
  invoiceNumber: string | null
  issueDate: Timestamp
  dueDate: Timestamp | null
  amount: number                     // total, CHF
  currency: string                   // 'CHF' par défaut
  storagePath: string | null         // fichier uploadé (accounting/invoices/...)
  status: "to_pay" | "paid" | "cancelled"
  expenseAccountId: string | null    // compte de charge imputé
  entryId: string | null             // écriture liée (null tant que pas comptabilisée)
  ocrStatus: "none" | "pending" | "done" | "failed"   // 'none' en v1 (OCR différé)
  ocrRawText: string | null
  notes: string | null
  createdBy: string                  // uid trésorier / rootAdmin
  createdAt: Timestamp
}
```
Factures fournisseurs du module Comptabilité. Saisie **manuelle** en v1 — les champs `ocrStatus` / `ocrRawText` sont réservés (OCR différé) et restent inertes (`ocrStatus: 'none'`). Comptabilisation : débit `expenseAccountId` / crédit `2000 Créditeurs`, l'écriture créée est référencée par `entryId`. Accès : `treasurer` + `rootAdmin`. Détail des flux : `docs/compta.md`.

### Activity feed — feed dashboard (TBD)

Le Dashboard expose un feed "Activité récente" (cf. `apps/web/src/views/Dashboard.vue`).
Pas de collection dédiée pour l'instant ; les entrées sont **dérivées** côté
client ou via une callable agrégeant :
- `bookings/*.actionLog[]` (actions coach append-only)
- `dues/*` updates (`paidAt`, `status` transitions)
- `licenseRequests/*` updates (`status` transitions)
- `paymentExceptionRequests/*` updates (`status` transitions)
- `officialAssignments/*` updates (`status` transitions par les officiels)

**Décision pending** : créer une collection `/activityLog/{entryId}` alimentée
par Functions (push event-sourced) si le feed devient lent ou si on veut
support multi-tenant analytics. Tant que le besoin est purement UI dashboard,
on reste sur dérivation à la lecture.

### `/_meta/schema` (singleton)
```ts
{
  version: number
  migrationLog: [{ version, appliedAt, appliedBy, notes }]
}
```
Lu par le migration runner et les Functions au cold start. Voir `deployment.md`.

## Security rules — principes

Un projet = un club, donc pas de filtrage `clubId`.

- **`rootAdmin`** (claim) : read/write partout. Bypass.
- **`admin`** : read/write tout sauf `_meta/schema` (réservé migration runner).
- **`coach`** : read members, venues, courts, timeSlots, bookings. Write bookings de **ses** slots (reserve/cancel). Create/read `matchRequests`. Write `attendance` sur bookings de son équipe.
- **`treasurer`** : read full `/dues` (vue globale paiements, pas de scope team). Pas de write direct — passe par la callable `markDuePaid` (Admin SDK valide `treasurer || admin` côté serveur). Cumulable avec `admin`/`coach`.
- **`official`** :
  - Read `/members/*` parent docs (nom, roles, licensed, duesStatus, officialLevel) — pas de contact info (gated dans `/members/{id}/private/contact`, official-only n'y accède pas).
  - Read `bookings` `match_home` (upcoming + passés pour export).
  - Read tous les `officialAssignments` sur ces bookings.
  - Create propre `officialAssignment` (self-register, `pending`).
  - Update son `officialAssignment` (`status` + `respondedAt` uniquement).
  - Read `notifications`, update `readBy[]` avec son uid.
- **`player`** (futur) : own stats + attendance.
- **`/_meta/schema`** : writable seulement par migration runner (service account ou `rootAdmin`).
- **`/config/club`** : read auth users, write admin + `rootAdmin`.
- **`/dues/`** : admin (all), treasurer (all, read-only via rules), coach (joueurs de ses équipes). Write admin + Functions. Coachs et treasurers **jamais** d'écriture directe — treasurer passe par la callable `markDuePaid`.
- **`/paymentExceptionRequests/`** : coach crée pour ses joueurs, lit les siens. Admin lit/écrit tout.
- **`/licenseRequests/`** : idem. `member.licensed` écrit seulement par admin (ou Function sur approval).
- **`/users/{uid}`** : self-create autorisé (par l'app register) avec contraintes whitelist — `request.auth.uid == uid`, `roles.size() == 0`, `memberId == null`, `teamIds.size() == 0`. Self-update sur les champs profil (`displayName`, `photoURL`, `phone`, `address`, `profileCompletedAt`) ; les champs `roles` / `memberId` / `teamIds` restent admin-only.
- **Module Comptabilité** (`/accounts`, `/accountingEntries`, `/invoices`) : read/write réservés à `treasurer` + `rootAdmin`. L'`admin` standard est **explicitement exclu** (aucune rule ne mentionne `isAdmin()` sur ces collections, et aucun wildcard `/{document=**}` ne les couvre). `/accountingEntries` est append-only (`allow delete: if false` — annulation par contre-passation). Cf. `docs/compta.md`.
- **`/registrations/`** : auth required (app register). Lecture par auteur (`submittedByUid`), tuteur du `matchedMemberId`, coach de la `teamId`, admin. Create par auteur uniquement. Update client seulement sur `status == "draft"` par auteur (autosave wizard) ; toutes autres transitions via callables.
- **`/teams/{}/refusalLogs/`** : write `false` (callable `refuseRegistration` only, Admin SDK), read admin uniquement. CollectionGroup `refusalLogs` également admin-only (vue admin "tous les refus").
- **Route guards** : **allowlist** des rôles par route. `rootAdmin` implicitement dans toutes.
- **collectionGroup queries** : exigent une règle séparée `match /{path=**}/<name>/{id}` — les rules de sous-collection ne couvrent **pas** les `collectionGroup()` queries (limitation Firestore). Présent pour `courts` (utilisé par Venues + Bookings). À ajouter au cas par cas si une nouvelle `collectionGroup()` query apparaît côté client (ex. `attendance`, `officialAssignments` côté web aujourd'hui : leurs lectures sont catch-failed, mais à corriger si on veut les activer).

## Firebase Storage — paths

Cf. `storage.rules`. Les seuls paths autorisés :

| Path | Read | Write | Notes |
|---|---|---|---|
| `/club/logo/{file}` | signed-in | signed-in (≤ 2 MB, `image/*`) | Logo du club. La garde admin réelle est sur `/config/club.logo` (Firestore rule write admin-only) — un non-admin peut uploader mais ne peut pas faire pointer la config vers le fichier. Le repo `settings.repo.ts` (`uploadClubLogo` / `deleteClubLogoByUrl`) gère le path `club/logo/logo_<timestamp><.ext>` pour cache-busting. |
| `/registrations/{uid}/{regId}/{file}` | signed-in | auteur (≤ 10 MB, `image/*` ou PDF) | Pièces de registration (lettre de sortie). Cf. `docs/chantier-registrations.md` §12. |
| `/licenseRequests/{uid}/{requestId}/{file}` | signed-in | auteur (≤ 10 MB, `image/*` ou PDF) | Pièces de demande de licence. Mapping uid ↔ memberId enforced côté callable, pas côté Storage rules (limitation cross-doc). |
| `/accounting/invoices/{invoiceId}/{file}` | signed-in | signed-in (≤ 10 MB, `image/*` ou PDF) | Scans/PDF des factures fournisseurs (module Comptabilité). La garde treasurer/rootAdmin est sur la collection Firestore `/invoices` (write treasurer-only) qui porte le `storagePath` — Storage rules ne peuvent pas faire de cross-doc lookup. Cf. `docs/compta.md`. |

Tout autre path est deny par défaut.

### `/users/{uid}` — whitelist `affectedKeys` sur update self

Self-update est autorisé **uniquement** sur les champs profil strictement modifiables après création :

```
allow update: if request.auth.uid == uid
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['displayName', 'photoURL', 'phone', 'address', 'profileCompletedAt']);
```

Conséquences pratiques pour les repos qui écrivent dans `/users/{uid}` :

- **`email` est figé à la création.** Toute tentative de réécriture (même avec la même valeur) fait échouer l'update — Firestore considère le champ comme `affectedKey` dès qu'il apparaît dans le payload. Pattern : exclure `email` du payload côté repo lors d'un update self.
- **`roles` / `memberId` / `teamIds` restent admin-only** — ne pas tenter de les écrire depuis le client en self-update.
- **Avant d'ajouter un nouveau champ profil self-editable**, mettre à jour la whitelist `hasOnly([...])` dans `firestore.rules`, redéployer (cf. `docs/deployment.md` "Firestore rules / indexes deploy — gotchas"), puis seulement écrire le champ côté repo.

Sans cette discipline, un repo qui dénormalise un nouveau champ déclenchera `permission-denied` côté client sans cause apparente (le code lit/écrit "correctement", mais la rule rejette le diff).

## Firestore indexes — `fieldOverrides` vs `indexes`

`firestore.indexes.json` distingue **deux** sections :

```json
{
  "indexes": [ /* composites multi-champs uniquement */ ],
  "fieldOverrides": [ /* single-field overrides (ex. DESC sur un champ top-level) */ ]
}
```

### Quand utiliser quoi

- **`indexes`** : pour les index **composites** (deux champs ou plus). Ex. `(uid ASC, createdAt DESC)`.
- **`fieldOverrides`** : pour configurer un **single-field index** (ex. DESC sur un champ top-level pour un `orderBy(field, 'desc')` sans `where`). Firestore crée automatiquement l'index ASC sur tout champ top-level — il **n'est pas** nécessaire de le déclarer. Seuls le DESC, l'`array-contains` désactivé, ou un `collectionGroup` scope custom passent par `fieldOverrides`.

### Erreur typique

Mettre un single-field DESC dans `indexes` déclenche au deploy :

```
HTTP 400 — this index is not necessary, configure using single field index controls
```

**Fix** — basculer la déclaration vers `fieldOverrides` :

```json
{
  "indexes": [ /* composites uniquement */ ],
  "fieldOverrides": [
    {
      "collectionGroup": "refusalLogs",
      "fieldPath": "refusedAt",
      "indexes": [
        { "order": "DESCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

`queryScope` vaut `COLLECTION` (scope un seul `collectionId`) ou `COLLECTION_GROUP` (scope tous les sous-paths avec ce `collectionId`, utilisé pour `collectionGroup()` queries — cf. `refusalLogs` en exemple).

## Cloud Functions

Déployées sur **chaque projet client** via CI cross-projet (voir `deployment.md`). Code identique partout.

| Function | Trigger | Rôle |
|---|---|---|
| `generateSeasonBookings` | Saison → `active` | Génère bookings (1 par slot par date), hors closures. |
| `previewSeasonBookings` | Callable | Dry-run : retourne plan sans écrire. |
| `applyClosurePeriod` | Closure ajouté à saison `active` | Cascading cancel (`cancelReason: "closure"`). |
| `handleMatchSlotChange` | Slot devient `match_home`/`match_away` | Suspend ou libère `training` même équipe ce jour. |
| `autoOfficialsNeededNotification` | Scheduled | Notif si un match (domicile **ou** extérieur) < 7j et pas full staff. |
| `matchReminders` | Scheduled | J-1 (23:00) + H-2 aux officiels confirmés. |
| `initiateDuesOnPlayerActivation` | `team.playerIds` augmenté | Crée `due` (`pending_grace`), set `member.duesStatus`. |
| `issueDuesScheduled` | Daily ~06:00 | `pending_grace` + `issuedAt <= now()` → `issued`, set `dueAt`. |
| `markOverdueScheduled` | Daily | `issued` + `dueAt < now()` → `overdue`, `member.duesStatus = "excluded"`. |
| `syncMemberDuesStatus` | `/dues/*` write | Recompute `member.duesStatus` (source unique pour UI). |
| `applyPaymentException` | `paymentExceptionRequests/*` update | Approve → applique new dates au `due`. Reject → restore. |
| `applyLicenseRequest` | `licenseRequests/*` update | Approve → `member.licensed = true`. |
| `runMigrations` | Callable (admin-only) | Applique migrations en attente jusqu'à version cible. Idempotent. |
| `setRootAdminClaim` | Callable (rootAdmin-only) | Toggle le claim `rootAdmin` sur un user (par email). Préserve les autres claims. Le caller ne peut pas se révoquer lui-même. Bootstrap du tout premier rootAdmin : via script Admin SDK hors-app. |
| `listRootAdminUids` | Callable (admin-only) | Retourne `{ uids: string[] }` — les uids portant le claim `rootAdmin: true`. Le claim vit côté Auth (pas Firestore) ; cette callable résout le badge rootAdmin sur l'écran Settings → Admin team. Pagination via `admin.auth().listUsers()`. |
| `acceptInvitation` | Callable (signed-in) | Cherche `/invitations` par email du caller, crée `/users/{uid}` à partir de l'invitation et supprime le doc. Appelée par le flow auth client quand un sign-in OAuth orphelin a une invitation pending. Codes : `not-found` (pas d'invitation), `already-exists` (/users/{uid} existe déjà). |
| `matchExistingMember` | Callable (auth required) | Lookup AVS + fuzzy match (lastName/firstName/birthDate) pour le wizard d'inscription. Retourne `MemberMatch[]`. Cf. `docs/chantier-registrations.md` §4.4. |
| `submitRegistration` | Callable (auth required) | Finalise un `/registrations/{id}` (status `draft` → `submitted`), set `coachNotifiedAt`/`adminNotifiedAt`, file un email user via `/pendingEmails`, ajoute `roles: ['parent']` sur `/users/{uid}` si registration "pour un enfant". Idempotent. |
| `refuseRegistration` | Callable (coach scope) | Set `status = 'refused'`, écrit `/teams/{teamId}/refusalLogs/{id}` (motif obligatoire), déclenche auto-rerouting si une autre équipe `open` existe dans la catégorie. |
| `cancelRegistration` | Callable (auteur) | Annulation par le user lui-même tant que `status ∈ {draft, submitted, open_pending_trial, conditional_pending_review}`. Au-delà, l'annulation passe par l'admin (callable séparée à venir). Idempotent. |
| `onRegistrationStatusChanged` | Firestore trigger (`/registrations/{id}` update) | Crée notifs (`new_registration_*`, `registration_accepted`, `registration_refused`, `trial_started`), maintient `member.duesStatus` lifecycle à l'atteinte de `confirmed_pending_dues`. |
| `onTrialExpired` | Scheduled (daily 03:00 zurich) | Notifs aux registrations en `trial_in_progress` depuis ≥ 14 jours sans transition. Pas de bascule auto vers `refused` — décision coach. |
| `generateLicenseForm` | Callable (admin ou coach) | Génère le PDF de formulaire pré-rempli pour une `/licenseRequests/{id}` (depuis `member` + `licenseRequest`) ; renvoie un Storage path. |
| `respondLicenseDocReview` | Callable (admin) | Accepte / refuse un document de licence uploadé via app register, notifie le user (`license_doc_refused` si refus avec motif). |
| `becomeOwnerOfMyMember` | Callable (user, signed-in) | Permet à un membre devenu majeur de prendre la main sur son propre dossier : set `member.linkedUserId = uid`, retire les guardians. Garde-fous : âge ≥ 18 ans ET `member.comms.majorityTransition.resolvedAt != null`. |

## Auth

- Firebase Auth = source de vérité. `/users/{uid}` mirror : profil + `roles` + `memberId`.
- Officials et coachs ont toujours un compte Auth. Joueurs (futur) aussi.
- **Custom claim `rootAdmin: true`** : per-project root. Créé au provisioning. L'ancien `superAdmin` est supprimé.
- **Editor global root** : pas un user Auth — identité GCP IAM (Owner ou rôle custom). Admin SDK + `gcloud`.
- Link Member ↔ User via `linkedUserId` (member) et `memberId` (user).
- `user.roles` (app access, guards) vs `member.roles` (classification club-interne). La "capacité official" dérive de `member.officialLevel != null`, pas de `user.roles`.
