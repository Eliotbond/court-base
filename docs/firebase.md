# Firebase

> Schéma Firestore, security rules, Cloud Functions, Auth. **Un projet par client** : les paths sont plats à la racine (pas de `clubId` prefix). Pour le control-plane et la flotte, voir `deployment.md`.
>
> Les rules vivent dans `firestore.rules`. Garde ce doc et le fichier en sync.

## Firestore — collections (par projet client)

```
/config/club                          (singleton)
/users/{uid}
  /fcmTokens/{tokenId}                 (tokens push FCM des appareils — ID = token)
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
/licenses/{licenseId}
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
  basketplan?: {                                     // intégration Swiss Basketball — undefined = off
    clubId: number                                    // id Basketplan du club (ex. 60 pour Marly)
    defaultFederationId: number                       // ex. 9 = AFBB Fribourg
    enabled: boolean
    lastSyncAt?: Timestamp | null
    lastSyncError?: string | null
  }
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

#### `config.club.basketplan`

Configuration de l'intégration Swiss Basketball / Basketplan (ORCA Systems). Voir `docs/basketplan-integration.md` (brief technique) et `docs/chantier-basketplan.md` (plan PRs). `undefined` ou `enabled: false` = intégration désactivée (le scheduler de sync nocturne no-op, mais l'UI Settings reste accessible pour la première saisie).

- **`clubId`** : id numérique Basketplan du club court-base (ex. 60 pour Marly). Filtré côté serveur dans `listClubTeamsInLeague` (étape 3 de la cascade de mapping).
- **`defaultFederationId`** : fédération principale du club (ex. 9 = AFBB Fribourg). Sert de défaut au dropdown du dialog de linkage et de cible au ping `testBasketplanConnection`. Une équipe peut être liée à des compétitions d'autres fédérations (cf. `team.basketplanLinks[]`).
- **`lastSyncAt`** / **`lastSyncError`** : posés par le scheduler nocturne (PR 2). `null` tant qu'aucun run.
- **Sécurité** : même frontière que le reste de `/config/club` (write admin + rootAdmin). Les écritures applicatives passent par les callables Admin SDK (Settings UI → callable, jamais write client direct).

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

### `/users/{uid}/fcmTokens/{tokenId}`
```ts
{
  token: string                         // = ID du document (dédup naturelle)
  platform: "ios" | "android"
  createdAt: Timestamp
  lastSeenAt: Timestamp                  // MAJ à chaque ré-enregistrement (démarrage app / refresh)
}
```
Tokens de push FCM des appareils du user (app mobile Flutter). **L'ID du document EST la chaîne du token** → le client fait `setDoc(token, …)` à chaque démarrage / `onTokenRefresh` sans jamais créer de doublon. Sous-collection (pas un champ sur `/users`) car un user a N appareils ; la Function `fanoutNotification` supprime le doc quand FCM signale le token mort. Rules : self-manage (`request.auth.uid == uid`), read admin pour debug.

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
  officialLevel: number | null          // QUALIFICATION officiel (1..N) ; null si pas qualifié. Manuel admin.
  coachLevel: number | null             // QUALIFICATION coach (1..N) ; null si pas qualifié. Manuel admin.
  officialLicense: ActiveLicenseRef | null  // réf dénormalisée vers la licence officiel ACTIVE ; null = aucune. Posée par confirmLicense.
  coachLicense: ActiveLicenseRef | null     // idem pour la licence de coach.
  licensed: boolean                     // toggled by admin via licenseRequest approval
  duesStatus: "ok" | "pending_grace" | "due" | "overdue" | "excluded" | "excepted" | "n/a"
  duesStatusUpdatedAt: Timestamp
  active: boolean
  birthDate: Timestamp | null           // null = inconnue (traité comme adulte côté defaults, UI doit avertir)
  guardianUserIds: string[]             // UIDs des tuteurs (users avec rôle 'parent' rattachés)
  comms: MemberCommsConfig              // routage facturation + comms générales (voir sous-structure)
  avs: string | null                    // 756.XXXX.XXXX.XX, null = pas encore connu (réfugié, etc.)
  transferState: "none" | "national_pending" | "international_pending" | "cleared"
  photoStoragePath: string | null       // chemin Storage de la photo licence (`members/{id}/license-photo.{ext}`) ; null = pas encore uploadée
  photoUpdatedAt: Timestamp | null      // dernier upload (audit + cache-buster URL signée) ; null si aucune photo
  photoUpdatedByUid: string | null      // uid du coach/admin ayant uploadé la dernière version ; null si aucune photo
}
```
**Pas de `email`/`phone` ici** — voir `/members/{memberId}/private/contact` ci-dessous. Le doc parent est lisible par tous les rôles club (incl. `official`-only). Les contacts sont gated séparément.

**Niveaux vs licences** — distinction importante :

- `officialLevel` / `coachLevel` = **QUALIFICATIONS** (numériques `1..N`, réglées **manuellement** par l'admin). « Avoir un niveau » signifie « être formé pour », **pas** « être actif ». `officialLevel` détermine quel `homeOfficialRequirements` (ventilé par niveau) un membre peut couvrir.
- `officialLicense` / `coachLicense` = réf **dénormalisée** (`ActiveLicenseRef`) vers la licence `/licenses` `status:'active'` du rôle correspondant. Posée par la callable `confirmLicense`, `null` sinon. Un membre est officiel/coach **ACTIF** ⟺ la réf existe **et** `officialLicense.seasonId === <id de la saison active>` (dérivation saison-précise). Sert à gater l'accès app (cf. `firestore.rules` → auto-inscription officiel) sans requête `/licenses`.

```ts
// ActiveLicenseRef — réf dénormalisée portée par member.officialLicense / coachLicense
{
  licenseId: string                   // id du doc /licenses/{id}
  seasonId: string                    // /seasons/{id} — saison de la licence
  level: number | null                // niveau snapshot (numérique official/coach)
}
```

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
**Vraie collection Firestore** (provisionnée — plus de mock). Types : `RoleData` / `Role` dans `packages/shared-types/src/role.ts` (qui exporte aussi `SYSTEM_ROLE_SEEDS` + `DEFAULT_CUSTOM_ROLE_SEEDS`, source de vérité du seed). CRUD côté `apps/web` : `repositories/roles.repo.ts`.

**Rôles système** (6, non-supprimables) : `admin`, `treasurer`, `secretary`, `coach`, `official`, `player`. Leurs **`id` Firestore = la clé canonique** (`doc('roles/admin')`, etc.) et correspondent aux clés de `/users.roles` — un membre porte ses rôles dans `/members.roles`, et la Function `syncUserRolesFromMember` les **recopie verbatim** dans `/users/{linkedUserId}.roles` (les rôles du membre **définissent** les rôles Auth). Les rôles `custom` (ex. `comite`, `referee`) sont éditables/supprimables et restent côté membre (les rules ignorent les rôles non reconnus).

**Amorçage** : sur projet vierge `/roles` est vide ; la page Settings → Member roles propose un CTA « Initialiser les rôles » qui écrit les 6 rôles système (+ 2 customs par défaut) de façon idempotente (`seedRoles`). Les docs système sont écrits avec leur id canonique en doc id.

**Rules** (`firestore.rules`) : `read` = signed-in non suspendu ; `create`/`update` = `isRootAdmin() || isAdmin()` ; `delete` = `isRootAdmin() || isAdmin()` **ET** `resource.data.type != 'system'` (les 6 rôles système sont non-supprimables côté serveur, défense en profondeur au-delà du blocage UI).

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
  basketplanLinks?: [{                   // intégration Swiss Basketball — undefined ou [] = équipe non liée
    id: string                            // uuid local généré côté Cloud Function
    federationId: number                  // ex. 9 = AFBB
    federationCode: string                // cache d'affichage ("AFBB")
    leagueHoldingId: number               // id Basketplan de la compétition (saison-précis)
    leagueHoldingName: string             // cache d'affichage ("2LM - Saison 25/26 - Phase préliminaire")
    season: string                        // extrait du nom ("25/26")
    teamIdInLeague: number                // id Basketplan de l'équipe DANS cette ligue
    teamNameInLeague: string              // cache ("Marly Basket 2LM")
    active: boolean                       // pause sans suppression
    addedAt: Timestamp
    addedBy: string                       // uid (admin ou coach)
  }]
}
```

#### `team.basketplanLinks[]`

Liens vers les compétitions Basketplan (Swiss Basketball) auxquelles l'équipe est inscrite. Une même équipe peut être inscrite dans **plusieurs** compétitions (championnat + coupe, ou plusieurs fédérations en parallèle) — d'où le tableau 1→N. Voir `docs/basketplan-integration.md` § 4.1 pour la spec complète.

- Tous les `*Name` / `*Code` / `season` sont des **caches** résolus côté serveur au moment du linkage (re-fetch Basketplan dans `linkTeamToBasketplan`) — évite de re-fetcher à chaque rendu de la liste.
- **Sécurité** : `/teams` reste write admin-only côté rules ; les mutations passent par les callables Admin SDK (`linkTeamToBasketplan`, `unlinkTeamBasketplan`, `toggleTeamBasketplanLink`) qui re-vérifient le scope coach (admin OR coach de la team).
- **Stabilité** : les `leagueHoldingId` Basketplan changent à chaque saison ; prévoir un mécanisme "renouveler les liens pour la saison N+1" (cf. brief § 7.2). Implémentation reportée en PR 2/3.
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
  // --- Tracking tab "Officiels" (livré 2026-05-24) ----------------------
  // Optionnels : champs nullable rétro-compatibles (docs antérieurs n'ont
  // pas la clé). Lus en JS côté agrégat (`buildOfficialMetricsBySeason`).
  replacementRequestedAt?: Timestamp | null
  // uid de celui qui a demandé le remplacement (officiel lui-même ou admin/coach
  // en son nom). `null` quand pas de demande.
  replacementRequestedByUid?: string | null
}
```

**Rules update** : l'officiel peut désormais muter le quadruplet
`[status, respondedAt, replacementRequestedAt, replacementRequestedByUid]` sur
sa propre assignation (élargissement du `hasOnly` existant). Admin/rootAdmin
peuvent toujours tout muter. Symétrique sur `/matches/{id}/officialAssignments`.

**Métriques dérivées (apps/web → tab "Officiels")** :
- `lastMinuteClaims` : assignations `confirmed` dont
  `(booking.date + startTime) - assignedAt < lastMinuteThresholdHours` (default 48 h).
- `replacementsRequested` : `replacementRequestedAt != null` (orthogonal au statut).

`lastMinuteThresholdHours` est lu depuis `/config/club.officialsConfig.lastMinuteThresholdHours` (champ optionnel — fallback 48 h).

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
  createdBy: string                 // uid admin OU 'system:basketplan' pour les matchs créés par le sync

  // --- Champs externes (intégration Basketplan — PR 2) -------------------
  // Tous optionnels : un match purement court-base (créé via UI) ne les
  // porte pas. Posés/maj par `scheduledBasketplanSync` (cron 03:00 ZH) et
  // `syncBasketplanForTeam` (callable). Voir docs/basketplan-integration.md
  // § 4.2 + § 5.3.
  externalSource?: "basketplan" | null
  externalGameNumber?: string | null              // ex. "25-08231" — clé d'idempotence du sync
  externalLeagueHoldingId?: number | null         // ref → /teams/{}.basketplanLinks[].leagueHoldingId
  externalReferees?: {                            // null global = pas encore d'arbitres désignés
    referee1?: string | null
    referee2?: string | null
    expert?: string | null
  } | null
  externalResult?: {                              // null = pas encore joué/saisi
    homeScore: number
    awayScore: number
    homologated: boolean                          // true quand fed a validé (état "homologué")
    byQuarter?: [{ home: number, away: number }]
  } | null
  externalLastSyncedAt?: Timestamp | null         // dernière passe de sync qui a touché ce doc
}
```

**Référence bidirectionnelle (kind='home')** : `match.bookingId` ↔ `booking.matchId`. Création/suppression via `writeBatch` atomique (cf. `apps/web/src/repositories/matches.repo.ts`). Champs dénormalisés sur le booking (`matchTypeId`, `opponentName`) pour permettre au calendrier de rendre les events sans join supplémentaire.

**Rules** : `read` signed-in, `create/update/delete` admin uniquement. Les écritures du sync Basketplan (Cloud Function) passent en Admin SDK et bypassent les rules — pas de modification rules nécessaire pour la PR 2.

**Index Firestore** : la query `where('externalGameNumber', '==', X).limit(1)` du sync (passe 1 de `applyGame`) est servie par un index single-field auto — aucun index composite à déployer pour la PR 2.

#### Sync Basketplan (PR 2)

Le sync Basketplan (`scheduledBasketplanSync` cron + `syncBasketplanForTeam` callable) réconcilie les matchs Basketplan avec `/matches` court-base via 3 passes :

1. **Patch** : si `where('externalGameNumber', '==', game.gameNumber).limit(1)` retourne un doc → patch des champs `external*` + bump `status` à `'played'` si le game est homologué.
2. **Lien manuel** : sinon, on cherche un match court-base de la même `teamId`, dans `±24h` de `game.date`, dont l'`opponentName` matche fuzzy (Levenshtein ≤ 2) → patch des champs `external*` sur le match existant (pas de duplication).
3. **Création AWAY** : sinon, et si notre équipe est `guestTeam` du game → création d'un nouveau `/matches` `kind: 'away'`, `bookingId: null`, avec tous les champs `external*` posés et `createdBy: 'system:basketplan'`. Le cas HOME (notre équipe = `homeTeam`) est **différé en PR 3** (matching venue/court ou inbox).

### `/matches/{matchId}/officialAssignments/{assignmentId}`

```ts
{
  memberId: string
  officialLevel: number              // snapshot au moment de l'assignation
  status: "pending" | "confirmed" | "declined"
  assignedAt: Timestamp
  assignedBy: string
  respondedAt: Timestamp | null
  // --- Tracking tab "Officiels" (livré 2026-05-24) ----------------------
  // Schéma identique à /bookings/{}/officialAssignments — champs optionnels
  // rétro-compatibles.
  replacementRequestedAt?: Timestamp | null
  replacementRequestedByUid?: string | null
}
```

Assignations d'officiels d'un match **à l'extérieur** (`kind='away'`). Schéma **identique** à `/bookings/{bookingId}/officialAssignments` — mais comme un match away n'a pas de booking, ses assignations sont portées directement par le doc match. Le besoin d'officiels vient de `matchType.awayOfficialCount` (total simple, pas de ventilation par niveau, contrairement à `homeOfficialRequirements`).

**Rules** : identiques à la sous-collection des bookings — `read` signed-in ; `create` admin/rootAdmin ou self-register (`status=='pending'` + `memberId == userDoc().memberId`) ; `update` admin/rootAdmin ou l'official sur `[status, respondedAt, replacementRequestedAt, replacementRequestedByUid]` de sa propre assignation ; `delete` admin/rootAdmin.

NB : pour les matchs AWAY, la métrique `lastMinuteClaims` n'est **pas** calculée en MVP (le repo `buildOfficialMetricsBySeason` ne joint que `/bookings/{id}.date+startTime` ; les `/matches/{id}.date` portent la même info mais ne sont pas (encore) lus). `replacementsRequested` est calculé de la même façon pour HOME et AWAY (lecture du flag direct sur l'assignation).

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
  pushedAt: Timestamp | null         // posé par fanoutNotification après le push FCM — garde anti-double-push
}
```

À la création d'un doc `/notifications`, le trigger `fanoutNotification` résout `targetAudience` → UIDs des officiels concernés → tokens de leurs sous-collections `/users/{uid}/fcmTokens` → push FCM multicast, puis pose `pushedAt`. Un re-delivery du trigger voit `pushedAt != null` et skip.

### `/pendingEmails/{emailId}`

```ts
{
  to: string | string[] | null       // emails destinataires (polymorphe : producteurs historiques posent string, dues posent string[], null = aucun résoluble)
  template: string                   // ex. "registration_submitted_confirm" — clé qui détermine le rendu côté sender
  context: Record<string, unknown>   // données utilisées par le template (typage strict via `ContextByTemplate[K]` côté functions/src/emails/types.ts)
  createdAt: Timestamp
  sentAt: Timestamp | null           // posé par le sender en cas de succès
  status: "pending" | "sent" | "failed"  // cycle de vie
  error: string | null               // posé par le sender en cas d'échec (code court + message tronqué)
  messageId?: string | null          // Message-ID retourné par Plesk en cas de succès
  attempts?: number                  // incrementé à chaque tentative du sender
  lastAttemptAt?: Timestamp | null   // posé à chaque tentative (audit même si status reste pending)
}
```

**Vendor wiré (2026-05-25)** : trigger `emailSender` (`functions/src/emails/sender.ts`) consomme `/pendingEmails/{id}` via `onDocumentCreated` et envoie via Plesk SMTP (Nodemailer + 6 secrets `SMTP_*`). Cf. `docs/emails/setup-plesk.md` pour la configuration serveur (boîte Plesk, DKIM/SPF/DMARC, secrets Firebase).

**Anti-boucle infinie** : le trigger est `onDocumentCreated` (pas `onWrite`), donc l'update final du sender (`status: 'sent'` + `sentAt`) ne le re-déclenche pas. Garde explicite côté handler (skip si `status === 'sent'` ou `sentAt != null`) en ceinture+bretelles.

**Retry** : `retry: false`. Un échec laisse le doc en `status: 'failed'` avec `error` court. Pas de retry auto en PR1. Backlog : callable manuelle `retryFailedEmail({emailId})` ou cron `retryTransientEmails` pour les erreurs réseau.

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
  registeredByUid: string | null     // uid du compte ayant soumis l'inscription (registration.submittedByUid) ; ancre d'autorisation rules ; null hors flux register / lignes legacy
  createdAt: Timestamp
}
```
Un `due` par joueur/saison/team. Switch d'équipe mid-saison : TBD (probablement garder le due original).

#### `paymentReference` & `emailedAt`

- **`paymentReference`** : référence de virement **déterministe** (typiquement `"DUE-{shortDueId}"` où `shortDueId` est le préfixe canonique du doc ID). Posée par `initiateDuesOnPlayerActivation` à la création. Affichée dans l'email `dues_payment_request`, attendue dans le champ "référence" du virement bancaire. `null` toléré pour les lignes legacy antérieures au chantier — l'email omet alors la référence (l'admin tag manuellement).
- **`emailedAt`** : marqueur d'idempotence pour l'email "à payer". Non-null ⇒ un doc `/pendingEmails` avec `templateKey == 'dues_payment_request'` a déjà été écrit pour ce due — on **ne re-déclenche pas** (même si le trigger est rejoué). Posé par la fonction qui produit l'email :
  - immédiatement à la création si le due naît déjà `issued` — **cas du flux d'inscription** (registration `confirmed_pending_dues` → due émis directement `issued` avec `dueAt = trialStartedAt + 14j`), ou cas `gracePeriodDays === 0` ;
  - **ou** à l'émission `pending_grace → issued` (cas legacy uniquement, `issueDuesScheduled`).

**`dueAt` & flux d'inscription** — quand la cotisation naît via `initiateDuesOnPlayerActivation` à la suite d'une `confirmRegistration` (lookup `registeredByUid` réussi sur la registration), `dueAt = registration.trialStartedAt + 14j` (ancrage sur le démarrage de l'essai, pas sur la création du due). Garantit qu'un joueur n'a jamais plus de 14j d'essai sans demande de paiement — cf. `docs/registrations/lifecycle.md` §9. Cas legacy (joueur ajouté à `team.playerIds` hors flux d'inscription) : path historique `pending_grace → issued` conservé, `dueAt = issuedAt + paymentDueDays`.

**Trigger `transitionRegistrationOnDuePaid`** — sur update `/dues/{id}` quand `status` passe à `'paid'` : le trigger cherche `/registrations where matchedMemberId == due.memberId && teamId == due.teamId`. Si la registration est en `confirmed_pending_dues`, il pose `status = 'active'` + `member.active = true` + append `actionLog`. Idempotent (skip si déjà `active`). Effet : le paiement de la cotisation active **automatiquement** l'inscription, sans intervention coach. Cf. `docs/registrations/functions.md` §3.4.

#### `registeredByUid`

uid du compte ayant soumis l'inscription (`registration.submittedByUid`) qui a mené à la création de la cotisation. **Ancre d'autorisation** : la rule `/dues` (clause `read`) autorise ce compte à lire la cotisation directement, sans dépendre du binding `member.linkedUserId` / `member.guardianUserIds`. Champ **immuable** — le fait "qui a inscrit" ne change pas, donc la dénormalisation est sûre.

Posé par `initiateDuesOnPlayerActivation` à la création : lookup best-effort de la registration `(matchedMemberId == memberId, teamId == teamId)` — deux filtres d'égalité, pas d'index composite, tri JS sur `createdAt` (la plus récente gagne si le joueur a été ré-inscrit). `null` si :
- le joueur a été ajouté à l'équipe **hors flux d'inscription** (création directe par un admin),
- la lecture des registrations échoue (best-effort — la cotisation est créée quand même),
- ligne **legacy** antérieure à ce champ.

Couvre notamment le cas où le binding membre n'a pas pris : inscription `for: 'self'` sur un member déjà lié à un autre compte (cf. `confirmRegistration`) — le submitter ne devient pas `linkedUserId` mais reste l'`registeredByUid` de la cotisation.

#### Lecture / écriture côté rôles

| Rôle | Read | Write direct | Action via callable |
|---|---|---|---|
| `admin` / `rootAdmin` | tout | autorisé (filets de sécurité) | — |
| `treasurer` | tout (vue globale paiements) | **refusé** par les rules | `markDuePaid` (pose `paid`, `paidAt`, `paidAmount`, `paymentMethod`, `recordedBy`) ; `updateDue` (édite dates / statut / note) |
| `coach` (scope team) | dues de ses teams | refusé | `paymentExceptionRequest` (cf. `/paymentExceptionRequests`) |
| **Membre lié** (`linkedUserId`) | sa propre cotisation uniquement | refusé | — (paiement par virement externe, marquage par admin/treasurer) |
| **Tuteurs** (`guardianUserIds`) | les cotisations des membres dont ils sont tuteurs | refusé | — |
| **Auteur de l'inscription** (`registeredByUid`) | les cotisations issues des inscriptions qu'il a soumises | refusé | — |

Le treasurer n'écrit jamais directement dans `/dues` — toute action passe par la callable `markDuePaid` (Admin SDK, validation `treasurer || admin` côté serveur). Idem pour les transitions automatiques (`issueDuesScheduled`, `markOverdueScheduled`, `applyPaymentException`) qui restent dans les Functions.

**Garde "montant partiel" (callable `markDuePaid`)** : la callable accepte n'importe quel `paidAmount` côté input, mais **rejette en `permission-denied`** tout caller qui tente `paidAmount < due.amount` sans avoir le claim `rootAdmin` OU le rôle `treasurer`. Un caller avec rôle `admin` seul ne peut donc poser que `paidAmount === due.amount` (ou laisser le champ vide → default au plein tarif). Le helper `assertCanRecordPartial` vit dans `functions/src/dues/markDuePaid.ts` ; la garde est posée **après** lecture transactionnelle de `due.amount` pour comparer au montant fourni. Cas d'usage : arrangement comité in extremis (cf. `docs/main.md` → Cotisations).

**Édition d'une cotisation (callable `updateDue`)** : édite une cotisation hors flux paiement. Auth : signed-in + (claim `rootAdmin` OU rôle `admin` OU `treasurer`), sinon `permission-denied`. Input wire `{ dueId, activatedAt?, issuedAt?, dueAt?, status?, notes? }` — dates en epoch millis ; champ absent = inchangé ; `null` explicite efface `issuedAt` / `dueAt` / `notes` (`activatedAt` non nullable). **Le montant (`amount`) n'est pas éditable** ; **`status: 'paid'` est refusé** (`invalid-argument`) — le passage à payé passe par `markDuePaid`. L'`update` est fait via Admin SDK ; le trigger `syncMemberDuesStatus` recalcule `member.duesStatus`. Aucun champ `updatedBy` / `updatedAt` ajouté au schéma. Fichier : `functions/src/dues/updateDue.ts`. Wrapper web : `updateCotisation` dans `apps/web/src/services/cloudFunctions.ts`.

**Note rules — lecture parent/membre.** La rule `read` exécute deux `get()` Firestore (`/members/{resource.data.memberId}`) pour vérifier `linkedUserId == auth.uid` puis `auth.uid in guardianUserIds`. Coût : 2 lectures supplémentaires par doc évalué — borné car l'app `courtbase-register` filtre toujours `where memberId in [...]` côté client (chunk ≤ 30 docs). Acceptable pour le volume attendu (1–3 cotisations actives par foyer). Pas de cache rule-side : si une cotisation référence un `memberId` qui n'existe plus, le `get()` échoue et la lecture est refusée — comportement souhaité (cohérence référentielle). La clause `registeredByUid`, elle, est un check **direct sur le doc** (`resource.data.get('registeredByUid', null)`) — aucun `get()` supplémentaire, et le `get(..., null)` tolère les docs legacy sans le champ. Une query register `where registeredByUid == auth.uid` est donc également valide côté rules (alternative au filtre `memberId in [...]`).

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
  memberId: string
  teamId: string
  seasonId: string                   // (NEW PR1) — utilisé pour l'ID déterministe
  requestedBy: string                // coach mobile / app companion
  status:
    | "pending"                       // legacy — workflow simple historique (rétro-compat)
    | "pending_parent_docs"           // (NEW) — demande créée, en attente upload parent
    | "parent_docs_submitted"         // (NEW) — parent a envoyé, en attente review coach
    | "coach_validated"               // (NEW PR2) — coach a validé chaque doc, en attente trésorier
    | "awaiting_parent_signature"     // (NEW PR3 trésorier) — trésorier a uploadé le formulaire à signer
    | "parent_signed"                 // (NEW PR3 trésorier) — parent a re-uploadé le doc signé
    | "form_confirmed"                // (NEW PR3 trésorier) — trésorier a validé la conformité du signed doc
    | "sent_paid"                     // (NEW PR3 trésorier) — envoyé fédération + payé ; /licenses créée en 'pending'
    | "approved"                      // terminal — numéro de licence reçu, /licenses 'active'
    | "rejected"                      // terminal

  // Documents fédéraux (NEW PR1)
  requiredDocs: LicenseDocKind[]                                  // figé à la création (immutable post-write — règle planifiée)
  parentUserIds: string[]                                          // (NEW PR1.5) — snapshot member.linkedUserId ∪ guardianUserIds ; ancre statique pour rule LIST parent
  uploadedDocs: Partial<Record<LicenseDocKind, UploadedDocRef>>   // défaut {} ; rempli par le parent — chaque ref porte (PR2/PR3) coachReview / treasurerReview ∈ DocReviewDecision | null
  foreignPlayerContext: ForeignPlayerContext | null               // posé si club précédent étranger
  parentSubmittedAvs: string | null                                // (NEW PR1.5) — AVS texte saisi par le parent (cas member.avs manquant)

  // Dénormalisation lecture-side (NEW PR1) — posé par le coach à la création
  denorm: {
    memberFirstName: string
    memberLastName: string
    teamName: string
    coachName: string
  } | null

  // Lifecycle timestamps
  createdAt: Timestamp
  parentCompletedAt: Timestamp | null                              // (NEW) — transition → parent_docs_submitted
  coachValidatedAt: Timestamp | null                               // (NEW PR2) — transition → coach_validated
  coachValidatedByUid: string | null                               // (NEW PR2)
  reviewedBy: string | null                                        // trésorier/admin (transition terminal)
  reviewedAt: Timestamp | null
  adminComment: string | null

  // === Phase trésorier (NEW PR3 trésorier, 2026-05-24) ===========
  // Tous null à la création (PR1). Backward-compat : demandes en
  // coach_validated existantes n'ont pas ces champs → utiliser
  // `.data.get('<field>', null)` dans les rules.

  signableDocStoragePath: string | null         // (NEW) — formulaire fédéral pré-rempli uploadé par le trésorier (`licenseRequests/{uid}/{requestId}/signable.pdf`)
  signableDocUploadedAt: Timestamp | null       // (NEW)
  signableDocUploadedByUid: string | null       // (NEW) — uid trésorier

  signedDocStoragePath: string | null           // (NEW) — doc signé re-uploadé par le parent (`licenseRequests/{uid}/{requestId}/signed.pdf`)
  signedDocUploadedAt: Timestamp | null         // (NEW)
  signedDocUploadedByUid: string | null         // (NEW) — uid parent (linked member ou guardian)

  formConfirmedAt: Timestamp | null             // (NEW) — transition → form_confirmed
  formConfirmedByUid: string | null             // (NEW) — uid trésorier

  sentToFederationAt: Timestamp | null          // (NEW) — transition → sent_paid
  paidAt: Timestamp | null                       // (NEW) — transition → sent_paid (paiement avant envoi)
  paymentProofStoragePath: string | null        // (NEW) — extrait bancaire / e-banking (`licenseRequests/{uid}/{requestId}/payment-proof.{ext}`) ; optionnel, re-uploadable
  paymentProofUploadedAt: Timestamp | null      // (NEW)

  licenseNumber: string | null                  // (NEW) — saisi par le trésorier à la finalisation (transition → approved)
  licenseFinalizedAt: Timestamp | null          // (NEW)
  licenseFinalizedByUid: string | null          // (NEW) — uid trésorier

  linkedLicenseId: string | null                // (NEW) — ref vers /licenses/{id} créée à sent_paid (status 'pending'), confirmée à approved (status 'active'). Bridge bidir avec license.requestId.

  treasurerNotes: string | null                 // (NEW) — notes workflow interne trésorier (non visible parent)
}
```

**Convention ID déterministe** (PR1, 2026-05-23) : `lr-{memberId}-{seasonId}`. Garantit l'**idempotence** côté client : un double-clic coach écrit deux fois le même document (second write = no-op via `setDoc(merge:false)` ou check `getDoc` préalable). Permet aussi l'UX "demande déjà en cours" sans query supplémentaire.

**Statuts — note de rétro-compat** : les nouvelles demandes créées par PR1 partent toujours en `pending_parent_docs`. Le statut legacy `pending` reste accepté pour rétro-compat avec les anciennes demandes mobile. Workflow cible :

```
pending_parent_docs
  → parent_docs_submitted          (parent submit)
    → coach_validated              (PR2 — coach valide chaque doc)
      → awaiting_parent_signature  (trésorier uploade `signable.pdf`)
        → parent_signed            (parent re-uploade `signed.pdf`)
          → form_confirmed         (trésorier valide la conformité)
            → sent_paid            (trésorier marque envoyé + payé → crée /licenses 'pending')
              → approved           (terminal — trésorier saisit licenseNumber → /licenses 'active')
(à tout moment depuis parent_docs_submitted jusqu'à sent_paid) → rejected (terminal)
```

À **`sent_paid`**, la `/licenses/{id}` est créée en `status: 'pending'` et est **immédiatement utilisable par le coach en match** (un joueur peut être aligné dès cet instant). À **`approved`**, la `/licenses` passe en `status: 'active'` via `confirmLicense` (chaîné par `treasurerFinalizeLicense`) qui pose aussi `member.licensed = true`, la dénormalisation `member.officialLicense` / `coachLicense` / `playerLicense`, et l'écriture comptable de la charge. La référence bidirectionnelle entre la demande et la licence est portée par `licenseRequest.linkedLicenseId` ↔ `license.requestId`.

Détail : `docs/licenses/parent-completion-workflow.md`.

**Per-doc review (PR2/PR3 — livré 2026-05-24)** : chaque `UploadedDocRef` porte deux sous-champs nullables, `coachReview: DocReviewDecision | null` (posé par `coachReviewLicenseDoc`) et `treasurerReview: DocReviewDecision | null` (posé par `treasurerReviewLicenseDoc`). Une `DocReviewDecision = { decision: 'accepted' | 'refused', at: Timestamp, byUid: string, refusalReason: string | null }`. **Pas d'historique** — chaque review écrase la précédente (volumétrie 1-2 refus typiquement). **Reset auto au re-upload** : quand le parent re-uploade un doc, le store réinitialise `coachReview = null` et `treasurerReview = null` sur ce doc (le doc repart depuis le début du cycle). Un refus coach passe la demande en `pending_parent_docs` ; un refus trésorier également + reset `coachValidatedAt/ByUid`.

**Types canoniques** : `LicenseDocKind`, `UploadedDocRef`, `DocReviewDecision`, `ForeignPlayerContext`, `LicenseRequestData` (étendu), `inferRequiredDocs(member)` → `packages/shared-types/src/license.ts`. Le fichier `mock-fixtures/license-extended.ts` est un shim de re-export `@deprecated`.

**Callables PR2/PR3** (Admin SDK, bypass rules — auth re-vérifiée serveur-side) :
- `coachReviewLicenseDoc({requestId, kind, decision: 'accept'|'refuse', refusalReason?})` — coach scope (`teamId ∈ user.teamIds`), pré-condition `status === 'parent_docs_submitted'`. Refuse → status `pending_parent_docs`. Accept tous → status `coach_validated` + pose `coachValidatedAt/ByUid`. Output `{ ok, requestId, newStatus, allCoachAccepted }`.
- `treasurerReviewLicenseDoc({requestId, kind, decision, refusalReason?})` — admin/treasurer/secretary/rootAdmin. Pré-conditions asymétriques : **Accept** `status ∈ {parent_docs_submitted, coach_validated, pending_parent_docs}` (court-circuit coach autorisé : coach absent, doc évident, urgence). **Refuse** `status ∈ {coach_validated, pending_parent_docs}`. Refuse → reset complet à `pending_parent_docs` + `coachValidatedAt/ByUid = null`. Accept → status inchangé (le trésorier doit ensuite appeler `validateLicenseRequest` pour émettre la licence). Output `{ ok, requestId, newStatus, allTreasurerAccepted }`.
- `validateLicenseRequest({requestId, decision: 'approve'|'reject', comment?})` — admin/treasurer/secretary/rootAdmin. Pré-conditions asymétriques (bypass coach end-to-end autorisé) : **Approve** `status ∈ {parent_docs_submitted, coach_validated, pending_parent_docs}` ET `allTreasurerAccepted` (le vrai gate — le trésorier qui a validé chaque doc en per-doc peut émettre sans attendre le coach). **Reject** `status ∈ {parent_docs_submitted, coach_validated}`. Approve : crée `/licenses/{auto-id}` `status: 'pending'` (snapshot du premier `/licenseTypes` joueur actif), pose `request.status = 'approved'`. Reject : pose `request.status = 'rejected'`. Output `{ ok, requestId, newStatus, licenseId }`. La transition `pending → active` reste séparée via la callable existante `confirmLicense` (qui poste l'écriture comptable de la charge).

**Callables phase trésorier** (NEW 2026-05-24 — auth `rootAdmin` OU rôle `treasurer` uniquement, **PAS admin** standard — cohérent avec le module compta) :

- `treasurerUploadSignableDoc({requestId, storagePath, fileName, sizeBytes, contentType})` — pré-condition `status === 'coach_validated'`. Pose `signableDoc*` + status → `awaiting_parent_signature`. Output `{ newStatus: 'awaiting_parent_signature' }`. Le PDF doit être uploadé sur Storage AVANT l'appel (convention `licenseRequests/{uid}/{requestId}/signable.pdf`).
- `treasurerConfirmSignedDoc({requestId, notes?})` — pré-condition `status === 'parent_signed'`. Pose `formConfirmedAt/ByUid` + status → `form_confirmed` + `treasurerNotes` (optionnel). Output `{ newStatus: 'form_confirmed' }`.
- `treasurerMarkSentAndPaid({requestId, paymentProofStoragePath?})` — pré-condition `status === 'form_confirmed'`. Pose `sentToFederationAt`, `paidAt` (= now), `paymentProofStoragePath` (optionnel), status → `sent_paid`. **Crée la `/licenses/{id}` en `status: 'pending'`** (snapshot du 1er `/licenseTypes` joueur actif, `requestId` + `requestedByUid` posés) + `linkedLicenseId` sur la demande. Output `{ newStatus: 'sent_paid', licenseId }`. La licence est utilisable par le coach en match dès cet instant.
- `treasurerFinalizeLicense({requestId, licenseNumber})` — pré-condition `status === 'sent_paid'` + `linkedLicenseId !== null`. Pose `licenseNumber`, `licenseFinalizedAt/ByUid`, status → `approved`. **Chaîne `confirmLicense`** sur `linkedLicenseId` (pending → active, dénorm membre, écriture comptable charge "Licences fédérales"). Pose `member.licenseNumber = licenseNumber` + `member.licensed = true`. Output `{ newStatus: 'approved', licenseId, memberPatch }`.

**Rules `/licenseRequests` étendues** (cf. `firestore.rules`) pour la phase trésorier : update direct client autorisé pour `rootAdmin || treasurer` sur chacune des transitions whitelistées (5 patterns `affectedKeys.hasOnly([...])`, status pré + post enforced). Update parent autorisé pour `awaiting_parent_signature → parent_signed` (re-upload `signed.pdf`). Les transitions qui créent ou modifient `/licenses` (`sent_paid`, `approved`) passent en pratique par les callables Admin SDK — les rules sont des filets de sécurité (côté client direct, sans création /licenses). Tous les nouveaux champs sont lus en safe-access `.data.get('<field>', null)` pour rester compatibles avec les demandes legacy.

Approval → création d'une `/licenses/{id}` `pending` via `validateLicenseRequest` (livré 2026-05-24). Le flip historique `member.licensed = true` reste maintenu en l'état jusqu'au refactor `member.licensed` dérivé (cf. `docs/main.md` § Licences, note Phase 2). Procédure fédérale Swiss Basketball / FIBA hors-bande pour la majorité des cas (cf. `docs/licenses/parent-completion-workflow.md` § FIBA).

### `/licenses/{id}`
```ts
{
  memberId: string                   // /members/{id} titulaire de la licence
  seasonId: string                   // /seasons/{id} — saison de validité
  licenseTypeId: string              // /licenseTypes/{id} référencé à la création
  role: "player" | "official" | "coach" | "referee"  // snapshot du LicenseType
  level: number | null               // snapshot du niveau (numérique official/coach/referee, null player)
  licenseName: string                // snapshot du libellé ("Officiel J+S")
  feeSnapshot: number                // snapshot du prix courant du LicenseType (CHF)
  status: "pending" | "active" | "cancelled"
  createdAt: Timestamp
  createdByUid: string               // admin ayant créé la licence
  confirmedAt: Timestamp | null       // posé par confirmLicense, null tant que status !== 'active'
  confirmedByUid: string | null       // treasurer/admin/secretary/rootAdmin ayant confirmé
  accountingEntryId: string | null    // id de l'écriture /accountingEntries postée à la confirmation
  requestId: string | null            // (NEW PR3) — ref inverse vers /licenseRequests/{id} si créée via validateLicenseRequest OU treasurerMarkSentAndPaid ; null pour création manuelle admin. Bridge bidir avec licenseRequest.linkedLicenseId.
  requestedByUid: string | null       // (NEW PR3) — uid coach qui avait initié la demande (snapshot de request.requestedBy) ; null pour création manuelle
}
```

Instance concrète d'une licence fédérale émise pour un **membre × saison × type de licence**. `level`, `licenseName`, `feeSnapshot` sont **snapshottés** depuis le `LicenseType` à la création — figés malgré les évolutions de la grille tarifaire.

**Cycle de vie** : `pending` (créée par l'admin depuis la fiche membre, write client direct) → `active` (confirmée par Swiss Basketball + payée par le club ; passage **via la callable `confirmLicense`**, réservée treasurer/admin/secretary/rootAdmin). La confirmation pose `confirmedAt` / `confirmedByUid` / `accountingEntryId`, met à jour la réf dénormalisée `member.officialLicense` / `member.coachLicense`, et **poste une écriture comptable** (charge « Licences fédérales » / crédit Banque, montant `feeSnapshot`). `cancelled` est terminal.

Un membre est officiel/coach **ACTIF** ⟺ il a une licence `active` pour ce rôle et la **saison courante** (dérivation via la réf dénormalisée — cf. `/members` ci-dessus). Cf. `docs/main.md` → Licences.

**Pas d'index composite** : les lectures attendues (`where memberId == X`, < 100 docs) passent par une **simple query + tri JS** côté client (règle 10 du `CLAUDE.md` racine). `firestore.indexes.json` n'est pas modifié.

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
    avs: string | null   // 756.XXXX.XXXX.XX ; null seulement au stade draft — obligatoire à la soumission
    phone: string | null
  }

  // Lien à un /member existant (rattaché par match AVS exact)
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

`draft` / `submitted` posés par l'app register, `open_pending_trial` / `conditional_pending_review` à la soumission selon `team.registrationStatus`, transitions suivantes posées par le coach (web) via callables (`markTrialInProgress`, `confirmRegistration`, `refuseRegistration`, `cancelRegistration`). `active` est posé par le trigger Firestore `transitionRegistrationOnDuePaid` quand la cotisation correspondante passe à `paid`. Les notifs lifecycle sont produites par le trigger `onRegistrationStatusChanged` (IDs déterministes pour idempotence). L'auto-expiration de l'essai à 14j est portée par le scheduled `onTrialExpired` (notifs coach + parent, pas de bascule auto). Auto-rerouting (`onRegistrationRefused`) reporté en Phase F. `foreignTransfer` est un flag transverse indépendant du status. Détail produit complet : `docs/chantier-registrations.md` ; détail Functions : `docs/registrations/functions.md`.

#### Rules

- Lecture : auteur (`submittedByUid`), tuteur du `matchedMemberId` (si défini), coach de la `teamId`, admin.
- Création : auteur uniquement (`request.auth.uid == submittedByUid`).
- Update client : autorisé **uniquement** sur `status == "draft"` par l'auteur (autosave wizard). Toutes les autres transitions passent par les callables (`submitRegistration`, `refuseRegistration`, etc.) — garantit l'intégrité du lifecycle.
- Delete : (a) l'auteur sur son propre `draft` (annule un brouillon non soumis) ; (b) admin / rootAdmin — suppression définitive depuis la vue Inscriptions, **tous statuts confondus** (correction d'erreur de création). La voie normale d'extinction d'une inscription soumise reste `cancelRegistration` (conserve l'audit). Pas de garde-fou de statut : supprimer une registration `confirmed_pending_dues` / `active` ne nettoie PAS le member + la cotisation déjà créés (l'UI prévient explicitement) — pour un retrait complet, passer par `deleteMember`.

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
- **`coach`** : read members, venues, courts, timeSlots, bookings. Write bookings de **ses** slots (reserve/cancel). Create/read `matchRequests`. Write `attendance` sur bookings de son équipe. Création/édition/désactivation de membres et création de matchs à l'extérieur : **pas d'écriture directe** (`/members` et `/matches` restent admin-only) — le coach passe par les callables `coachCreateMember` / `coachUpdateMember` / `coachDeactivateMember` / `coachCreateAwayMatch` (Admin SDK, re-vérifient le scope coach).
- **`/users/{uid}/fcmTokens`** : self-manage — chaque user gère uniquement ses propres tokens de push (`request.auth.uid == uid`). Admin lit pour debug. La Function `fanoutNotification` (Admin SDK) bypasse.
- **`treasurer`** : read full `/dues` (vue globale paiements, pas de scope team). Pas de write direct — passe par la callable `markDuePaid` (Admin SDK valide `treasurer || admin` côté serveur). Cumulable avec `admin`/`coach`.
- **`secretary`** : rôle additif staff (helper `isSecretary()` = `hasRole('secretary')`). Lit `/licenses`. Peut confirmer une licence via la callable `confirmLicense` (Admin SDK — pas de write direct sur `/licenses`). Pas de droits admin généraux. Comme tout rôle staff, **jamais suspendu** par `callerSuspended()`.
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
- **`/licenseRequests/`** : **Read** : staff (rootAdmin/admin/coach team) + **`request.auth.uid in parentUserIds`** (ancre statique posée à la création coach — voir ci-dessous) + fallback legacy `isLinkedMember` / `isGuardianOf`. **Create** : admin/rootAdmin OU coach de la team. **Update** : admin/rootAdmin OU **parent (linked member / guardian, OU UID dans `parentUserIds`) en self-update** scopé — autorisé uniquement quand `status == 'pending_parent_docs'` et limité aux clés `uploadedDocs` / `foreignPlayerContext` / `parentSubmittedAvs` / `parentCompletedAt` / `status`, avec transition `status` verrouillée à `pending_parent_docs` ou `parent_docs_submitted` (pas de bypass vers `coach_validated` / `approved`). Cf. `docs/licenses/parent-completion-workflow.md`. **Update parent — phase trésorier** : autorisé aussi pour `awaiting_parent_signature → parent_signed` (re-upload `signedDocStoragePath` + timestamps), affectedKeys whitelist `[status, signedDocStoragePath, signedDocUploadedAt, signedDocUploadedByUid]`. **Update trésorier** (`rootAdmin || treasurer` — **pas admin standard**, cohérent avec le module compta) : autorisé sur 5 transitions whitelistées de la phase trésorier (`coach_validated → awaiting_parent_signature`, `parent_signed → form_confirmed`, `form_confirmed → sent_paid`, re-upload `paymentProof` à `sent_paid`, `sent_paid → approved`). Chaque transition a sa propre whitelist `affectedKeys.hasOnly([...])` — voir `firestore.rules` pour le détail. Les transitions qui créent/confirment une `/licenses` (`sent_paid`, `approved`) passent en pratique par des callables Admin SDK (`treasurerMarkSentAndPaid`, `treasurerFinalizeLicense`) ; les rules sont des filets de sécurité. **Delete** : admin/rootAdmin uniquement. `member.licensed` écrit seulement par admin (ou callable sur approval). **Pourquoi `parentUserIds`** : la rule `isGuardianOf` fait un `get()` cross-doc dynamique → Firestore peut refuser une LIST query parent en bloc (cf. memo `firestore-list-query-dynamic-rule` + cas vécu sur `/dues` avec `registeredByUid`). L'ancre statique `parentUserIds` permet une query `where parentUserIds array-contains uid` statiquement pré-validable. **Accès safe aux nouveaux champs** : les rules utilisent `.data.get('<field>', null)` pour tous les champs phase trésorier — les demandes legacy en `coach_validated` n'ont pas ces champs, et un accès direct `.data.field` throw côté Rules engine (cf. mémoire `firestore-rules-safe-field-access`).
- **`/licenses/`** : instances de licences émises. **Read** : staff (rootAdmin/admin/coach/treasurer/secretary) + le membre lié (`isLinkedMember`) + ses tuteurs (`isGuardianOf`). **Create** : admin/rootAdmin (création en `pending` depuis la fiche membre). **Update/delete** : admin/rootAdmin uniquement. La confirmation (`status:'active'` + `accountingEntryId` + réfs dénormalisées + écriture comptable) passe par la callable `confirmLicense` (Admin SDK, bypass rules, re-vérifie le scope treasurer/admin/secretary/rootAdmin) — treasurer/secretary **n'ont pas** de write direct ici. **Pas** de garde `!callerSuspended()` : comme `/dues`, un membre inactif garde la lecture de sa propre licence.
- **Auto-inscription officiel** (`officialAssignments` create self-register, sur `/bookings` et `/matches`) : exige désormais que le membre du caller ait une licence d'officiel active — helper `callerHasOfficialLicense()` = `member.officialLicense != null` (accès défensif `get('officialLicense', null)`). Le check **saison-précis** (la licence cible-t-elle la saison courante ?) n'est **pas** faisable en rules — `/config/club` ne porte pas de pointeur de saison active et déterminer la saison `status:'active'` exigerait une query collection (interdite en rules). Ce check est porté côté UI/callable d'assignation ; les rules font la garde grossière (défense en profondeur). L'accès admin/rootAdmin n'est pas affecté.
- **`/users/{uid}`** : self-create autorisé (par l'app register) avec contraintes whitelist — `request.auth.uid == uid`, `roles.size() == 0`, `memberId == null`, `teamIds.size() == 0`. Self-update sur les champs profil (`displayName`, `photoURL`, `phone`, `address`, `profileCompletedAt`) ; les champs `roles` / `memberId` / `teamIds` restent admin-only.
- **Module Comptabilité** (`/accounts`, `/accountingEntries`, `/invoices`) : read/write réservés à `treasurer` + `rootAdmin`. L'`admin` standard est **explicitement exclu** (aucune rule ne mentionne `isAdmin()` sur ces collections, et aucun wildcard `/{document=**}` ne les couvre). `/accountingEntries` est append-only (`allow delete: if false` — annulation par contre-passation). Cf. `docs/compta.md`.
- **`/registrations/`** : auth required (app register). Lecture par auteur (`submittedByUid`), tuteur du `matchedMemberId`, coach de la `teamId`, admin. Create par auteur uniquement. Update client seulement sur `status == "draft"` par auteur (autosave wizard) ; toutes autres transitions via callables. Delete : auteur sur son `draft`, ou admin / rootAdmin (suppression définitive depuis la vue Inscriptions — correction d'erreur).
- **`/teams/{}/refusalLogs/`** : write `false` (callable `refuseRegistration` only, Admin SDK), read admin uniquement. CollectionGroup `refusalLogs` également admin-only (vue admin "tous les refus").
- **Route guards** : **allowlist** des rôles par route. `rootAdmin` implicitement dans toutes.
- **collectionGroup queries** : exigent une règle séparée `match /{path=**}/<name>/{id}` — les rules de sous-collection ne couvrent **pas** les `collectionGroup()` queries (limitation Firestore). Présent pour `courts` (utilisé par Venues + Bookings). À ajouter au cas par cas si une nouvelle `collectionGroup()` query apparaît côté client (ex. `attendance`, `officialAssignments` côté web aujourd'hui : leurs lectures sont catch-failed, mais à corriger si on veut les activer).

### Membre inactif — suspension de l'accès app club (`callerSuspended()`)

Sémantique `member.active` : un membre dont `/members/{memberId}.active === false`
est **inactif** — typiquement un joueur/officiel qui a quitté le club. Le flag est
basculé par l'admin depuis la fiche membre (rule `write` de `/members` inchangée,
admin-only). `active` est orthogonal à `member.status` (`active`/`archived`) :
un membre peut être inactif sans être archivé.

Conséquence sur l'accès données : le compte Auth lié à un membre inactif
(`member.linkedUserId` ↔ `user.memberId`) **perd l'accès aux données de l'app
club** (web/mobile), mais **conserve l'accès au portail `courtbase-register`**
pour se réinscrire. La réinscription le réactive (cf. `confirmRegistration`
ci-dessous et `docs/main.md` → "Membre actif / inactif").

Helper `callerSuspended()` — retourne `true` SSI **toutes** les conditions :

1. le caller est signé (`isSignedIn()`),
2. il n'a **aucun** rôle staff — `!isRootAdmin() && !isAdmin() && !isCoach() && !isTreasurer() && !isSecretary()` ; les comptes staff utilisent le desktop et ne sont **jamais** suspendus,
3. son `userDoc().memberId` est non-null (le compte est lié à un membre),
4. `/members/{memberId}.data.get('active', true) == false` — accès **défensif** : un doc membre sans le champ `active` est traité comme **actif** (pas de suspension par omission).

Les checks de rôle (étape 2) sont placés **avant** le `get()` sur `/members` :
un compte staff court-circuite l'évaluation et ne paie jamais la lecture
supplémentaire. Pour un compte non-staff lié à un membre, le helper coûte
2 `get()` (`/users/{uid}` déjà mis en cache par les autres helpers + `/members`).

Partitionnement des collections — `&& !callerSuspended()` ajouté sur la **lecture**
(et les clauses de write self-service) des collections **app club uniquement** :

| Collection | Coupée pour inactif ? | Justification |
|---|---|---|
| `/bookings` (+ `officialAssignments` self-register, lecture `attendance`) | **Oui** | Donnée app club, non lue par register. `attendance` non gardée explicitement (read/write coach/admin only → court-circuit staff). |
| `/bookingSeries` | **Oui** | Idem bookings. |
| `/matches` (+ `officialAssignments` self-register) | **Oui** | Donnée app club, non lue par register. |
| `/venues`, `/courts`, `/timeSlots`, collectionGroup `courts` | **Oui** | Donnée app club, non lue par register. |
| `/notifications` (read + update `readBy`) | **Oui** | Donnée app club. |
| `/matchTypes`, `/seasons`, `/closurePeriods` | **Oui** | Référentiels app club, non lus par register. |
| `/roles` | **Oui** | Résolu par l'app club, **pas** par register. |
| `/licenseTypes` | **Oui** | App club. Register lit `/licenseRequests`, **pas** `/licenseTypes`. |
| `/config/club` | **Non** | Lu par register (`club.repo.ts`) — branding/IBAN du portail d'inscription. |
| `/members`, `/members/private/contact` | **Non** | Register lit la fiche du membre lié + ses contacts. La lecture self (`isLinkedMember`) doit rester ouverte pour réinscription. |
| `/categories` | **Non** | Lu par register (`teams.repo.ts`) — résolution catégorie d'équipe. |
| `/teams` | **Non** | Lu par register — sélection d'équipe d'inscription. |
| `/dues` | **Non** | Lu par register — facture/cotisation propre du membre. |
| `/users` | **Non** | Identité propre du membre (self read/update). |
| `/registrations` | **Non** | Cœur du portail register — création/lecture d'inscriptions. |
| `/licenseRequests` | **Non** | Lu/écrit par register. |
| `/licenses` | **Non** | Comme `/dues` : un membre inactif garde la lecture de sa propre licence (read membre lié + tuteurs). |
| `/matchRequests`, `/paymentExceptionRequests` | **N/A** | Read coach/admin-only — un membre inactif (non-staff) n'y a déjà aucun accès ; pas de garde ajoutée. |
| `/tags`, `/cotisations` | **Non** | Référentiels signed-read ; register **ne les lit pas directement** (résout `categories`), mais en cas de doute laissés ouverts (sécurité < disponibilité réinscription). |
| `/accounts`, `/accountingEntries`, `/invoices`, `/pendingEmails`, `/_meta`, `/invitations` | **N/A** | Module compta / server-only / admin-only — hors périmètre, intouchés. |

Rationale du partitionnement : **sécurité < disponibilité de la réinscription**.
En cas de doute sur la dépendance de register à une collection, on **ne coupe pas** —
couper une collection dont register dépend bloquerait la réinscription (le
membre inactif ne pourrait plus redevenir actif). Les collections "register"
restent donc ouvertes même quand elles exposent un peu de donnée club.

`confirmRegistration` — **réactivation** : quand la callable réutilise un
membre existant (matched), elle repose `active: true`. Si le membre était
archivé (`status === 'archived'`), elle repose aussi `status: 'active'` et
efface `archivedAt` / `archivedReason` / `archivedByUid`. C'est le mécanisme
qui sort un compte de l'état suspendu. Cf. `docs/main.md` → section
"Cotisations — email à payer, paiement, archive" / lifecycle d'inscription.

## Firebase Storage — paths

Cf. `storage.rules`. Les seuls paths autorisés :

| Path | Read | Write | Notes |
|---|---|---|---|
| `/club/logo/{file}` | signed-in | signed-in (≤ 2 MB, `image/*`) | Logo du club. La garde admin réelle est sur `/config/club.logo` (Firestore rule write admin-only) — un non-admin peut uploader mais ne peut pas faire pointer la config vers le fichier. Le repo `settings.repo.ts` (`uploadClubLogo` / `deleteClubLogoByUrl`) gère le path `club/logo/logo_<timestamp><.ext>` pour cache-busting. |
| `/registrations/{uid}/{regId}/{file}` | signed-in | auteur (≤ 10 MB, `image/*` ou PDF) | Pièces de registration (lettre de sortie). Cf. `docs/chantier-registrations.md` §12. |
| `/licenseRequests/{uid}/{requestId}/{file}` | signed-in | auteur (≤ 10 MB, `image/*` ou PDF) | Pièces de demande de licence. Côté parent : `id_front`, `id_back`, `avs`, `transfer_letter_swiss` + `signed.pdf` (re-upload doc signé). Côté trésorier : `signable.pdf` (formulaire fédéral pré-rempli) + `payment-proof.{ext}` (extrait bancaire). Mapping uid ↔ memberId + check rôle trésorier enforced côté callable (pas côté Storage — limitation cross-doc + Storage ne lit pas Firestore). |
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
| `coachReviewLicenseDoc` | Callable (coach/admin scope) | Review per-doc d'une `/licenseRequests/{id}` par le coach (PR2). Input `{ requestId, kind, decision: 'accept'|'refuse', refusalReason? }`. Pré-condition `status === 'parent_docs_submitted'`. Refuse → `pending_parent_docs` + reset `coachValidatedAt/ByUid`. Accept tous → `coach_validated`. Output `{ ok, requestId, newStatus, allCoachAccepted }`. Cf. `docs/licenses/parent-completion-workflow.md`. |
| `treasurerReviewLicenseDoc` | Callable (admin/treasurer/secretary/rootAdmin) | Review per-doc d'une `/licenseRequests/{id}` par le trésorier (PR3). Input `{ requestId, kind, decision, refusalReason? }`. Pré-conditions asymétriques : **Accept** `status ∈ {parent_docs_submitted, coach_validated, pending_parent_docs}` (court-circuit coach OK). **Refuse** `status ∈ {coach_validated, pending_parent_docs}`. Refuse → reset complet à `pending_parent_docs` + `coachValidatedAt/ByUid = null`. Accept → status inchangé (le trésorier doit ensuite appeler `validateLicenseRequest`, qui reste strict sur `coach_validated`). Output `{ ok, requestId, newStatus, allTreasurerAccepted }`. |
| `validateLicenseRequest` | Callable (admin/treasurer/secretary/rootAdmin) | Décision finale (PR3). Input `{ requestId, decision: 'approve'|'reject', comment? }`. Pré-conditions asymétriques (bypass coach end-to-end OK) : **Approve** `status ∈ {parent_docs_submitted, coach_validated, pending_parent_docs}` ET tous les `requiredDocs` ont `treasurerReview.accepted`. **Reject** `status ∈ {parent_docs_submitted, coach_validated}`. Approve : crée `/licenses/{auto-id}` `status:'pending'` (snapshot 1er `/licenseTypes` joueur actif), pose `request.status = 'approved'`. Reject : pose `request.status = 'rejected'`. Output `{ ok, requestId, newStatus, licenseId }`. NB : la transition `pending → active` reste séparée via `confirmLicense`. |
| `runMigrations` | Callable (admin-only) | Applique migrations en attente jusqu'à version cible. Idempotent. |
| `setRootAdminClaim` | Callable (rootAdmin-only) | Toggle le claim `rootAdmin` sur un user (par email). Préserve les autres claims. Le caller ne peut pas se révoquer lui-même. Bootstrap du tout premier rootAdmin : via script Admin SDK hors-app. |
| `listRootAdminUids` | Callable (admin-only) | Retourne `{ uids: string[] }` — les uids portant le claim `rootAdmin: true`. Le claim vit côté Auth (pas Firestore) ; cette callable résout le badge rootAdmin sur l'écran Settings → Admin team. Pagination via `admin.auth().listUsers()`. |
| `acceptInvitation` | Callable (signed-in) | Cherche `/invitations` par email du caller, crée `/users/{uid}` à partir de l'invitation et supprime le doc. Appelée par le flow auth client quand un sign-in OAuth orphelin a une invitation pending. Codes : `not-found` (pas d'invitation), `already-exists` (/users/{uid} existe déjà). |
| `matchExistingMember` | Callable (auth required) | Lookup d'un member existant par AVS exact (`avs`, fallback `licenseNumber`) pour le wizard d'inscription. Retourne `MemberMatch[]`. Cf. `docs/chantier-registrations.md` §4.4. |
| `submitRegistration` | Callable (auth required) | Finalise un `/registrations/{id}` (status `draft` → `submitted`), set `coachNotifiedAt`/`adminNotifiedAt`, file un email user via `/pendingEmails`, ajoute `'parent'` à `/users/{uid}.roles` si registration "pour un enfant". Si le caller a un member lié (`/users/{uid}.memberId != null`), `'parent'` est **aussi** `arrayUnion`'d dans `/members/{memberId}.roles` — sinon le prochain write du membre lié, propagé par `syncUserRolesFromMember` (qui écrase `/users.roles` verbatim), effacerait le rôle `parent`. Idempotent. |
| `refuseRegistration` | Callable (coach scope) | Set `status = 'refused'`, écrit `/teams/{teamId}/refusalLogs/{id}` (motif obligatoire), déclenche auto-rerouting si une autre équipe `open` existe dans la catégorie. |
| `cancelRegistration` | Callable (auteur) | Annulation par le user lui-même tant que `status ∈ {draft, submitted, open_pending_trial, conditional_pending_review}`. Au-delà, l'annulation passe par l'admin (callable séparée à venir). Idempotent. |
| `markTrialInProgress` | Callable (coach scope) | Passe une registration en `trial_in_progress` (set `trialStartedAt = now` si non défini). Idempotent. Cf. `docs/registrations/functions.md` §2.5. |
| `confirmRegistration` | Callable (coach scope) | Crée ou réutilise `/members/{id}` depuis la registration, `arrayUnion` dans `team.playerIds` (déclenche `initiateDuesOnPlayerActivation`), set `status = 'confirmed_pending_dues'`. La cotisation émise hérite de `dueAt = trialStartedAt + 14j`. Cf. `docs/registrations/functions.md` §2.6. |
| `onRegistrationStatusChanged` | Firestore trigger (`/registrations/{id}` update) | Crée notifs lifecycle (`new_registration_*`, `registration_accepted`, `registration_refused`, `trial_started`, `registration_dues_pending`, `registration_active`) à chaque transition. IDs déterministes `${regId}_${newStatus}` pour idempotence. Cf. `docs/registrations/functions.md` §3.1. |
| `onTrialExpired` | Scheduled (daily 03:00 zurich) | Pour chaque registration en `trial_in_progress` depuis ≥ 14j sans transition : deux notifications déterministes (`registration_trial_expired_coach`, `registration_trial_expired_user`). Pas de bascule auto vers `refused`. Requiert l'index composite `(status, trialStartedAt)` sur `/registrations`. |
| `transitionRegistrationOnDuePaid` | Firestore trigger (`/dues/{id}` update à `paid`) | Lookup `/registrations where matchedMemberId == due.memberId && teamId == due.teamId`. Si `confirmed_pending_dues` → set `active` + `member.active = true`, append `actionLog`. Idempotent (skip si déjà `active`). |
| `onRegistrationRefused` | Firestore trigger | 🔜 **Phase F (différé)** — auto-rerouting d'une registration refusée vers une autre équipe `open` de la même catégorie. Non implémenté. |
| `generateLicenseForm` | Callable (admin ou coach) | Génère le PDF de formulaire pré-rempli pour une `/licenseRequests/{id}` (depuis `member` + `licenseRequest`) ; renvoie un Storage path. |
| `respondLicenseDocReview` | Callable (admin) | Accepte / refuse un document de licence uploadé via app register, notifie le user (`license_doc_refused` si refus avec motif). |
| `becomeOwnerOfMyMember` | Callable (user, signed-in) | Permet à un membre devenu majeur de prendre la main sur son propre dossier : set `member.linkedUserId = uid`, retire les guardians. Garde-fous : âge ≥ 18 ans ET `member.comms.majorityTransition.resolvedAt != null`. |
| `fanoutNotification` | Firestore trigger (`/notifications/{id}` create) | Push FCM d'une notification. Résout `targetAudience` → officiels → tokens `/users/{uid}/fcmTokens` → `sendEachForMulticast` (chunks 500). Purge les tokens morts. Pose `pushedAt` (garde idempotence anti-double-push). |
| `coachCreateMember` | Callable (coach scope) | Coach crée un joueur dans une de ses équipes : crée `/members/{id}` (`roles:['player']`, dédup `findExactMemberMatch`), `arrayUnion` dans `team.playerIds` (déclenche `initiateDuesOnPlayerActivation`), écrit `/members/{id}/private/contact`. App mobile. |
| `coachUpdateMember` | Callable (coach scope) | Coach édite un membre d'une de ses équipes — whitelist : `firstName`, `lastName`, `birthDate`, contact `email`/`phone`, `comms.generalRecipients`. App mobile. |
| `coachDeactivateMember` | Callable (coach scope) | `mode:'bench'` → `active:false`. `mode:'archive'` → `status:'archived'` + `archivedAt`/`archivedReason`/`archivedByUid` + `active:false` (pas de retrait de `playerIds`). App mobile. |
| `coachCreateAwayMatch` | Callable (coach scope) | Coach crée un match à l'extérieur (`/matches`, `kind:'away'`, `date` = minuit UTC) pour une de ses équipes + libère best-effort les entraînements en conflit (`freeConflictingTrainings`). App mobile. |
| `syncUserRolesFromMember` | Firestore trigger (`/members/{id}` write) | Propage `member.roles` → `/users/{linkedUserId}.roles` (copie verbatim, écrase). Délien/suppression → roles de l'ancien user remis à `[]`. Les rôles du membre définissent les rôles Auth. |
| `unlinkGuardian` | Callable (signed-in) | Self-service depuis l'app register (page « Mon compte ») : le caller se retire de `/members/{id}.guardianUserIds`. Garde : caller doit être dans le tableau. Idempotent (déjà absent → ok). Aucune autre cascade — un member sans tuteur restant est laissé en l'état (admin doit re-lier ou archiver). |
| `deleteMyAccount` | Callable (signed-in) | Self-service depuis l'app register (page « Mon compte », zone dangereuse) : suppression intégrale RGPD du caller — Firebase Auth + `/users/{uid}` + linked `/members/{id}` (cascade dues non-paid + retrait teams + unlink registrations + suppression des drafts + suppression des `/users/{uid}/fcmTokens/*`). Bloque si pupille restant (`failed-precondition`) ou si linked member a un due `paid` (préservation comptable). Anti-fat-finger : `confirmText` doit valoir littéralement `"SUPPRIMER"`. `admin.auth().deleteUser()` est hors transaction Firestore (best-effort) ; `authDeleted: false` signale au client un cleanup partiel à reporter à l'admin. |
| `listBasketplanLeagueHoldings` | Callable (signed-in) | Fetch `findAllLeagueHoldings.do?federationId=X` + parse + cache 1h en mémoire. Retourne `LeagueHolding[]` filtré sur les 2 dernières saisons. Sert le step 2 du dialog de linkage. |
| `listClubTeamsInLeague` | Callable (signed-in) | Fetch `showLeagueSchedule.do?leagueHoldingId=Y` + extrait les équipes du `config.club.basketplan.clubId` (dédupliquées). Step 3 du dialog. |
| `linkTeamToBasketplan` | Callable (admin OR coach-of-team) | Ajoute un `BasketplanCompetitionLink` à `/teams/{id}.basketplanLinks`. Résout les caches d'affichage côté serveur (re-fetch). Garde dédup `(federationId, leagueHoldingId, teamIdInLeague)`. |
| `unlinkTeamBasketplan` | Callable (admin OR coach-of-team) | Retire un lien (filter out par `linkId`). Idempotent. |
| `toggleTeamBasketplanLink` | Callable (admin OR coach-of-team) | Bascule `active` sur un lien sans le supprimer. |
| `testBasketplanConnection` | Callable (admin) | Ping `findAllLeagueHoldings.do?federationId=<defaultFederationId>` pour diagnostic Settings. Retourne `{ ok, leagueCount }` ou `{ ok: false, error }`. |
| `syncBasketplanForTeam` | Callable (admin OR coach-of-team) | Sync à la demande de tous les `basketplanLinks` actifs d'une team. Réutilise `applyGame` (cf. ci-dessous). Try/catch indépendant par link. Retour : `{ ok: true, summary: { perLink: [...] } }`. Update `team.basketplanSyncedAt`. Ne touche pas à `config.basketplan.lastSyncAt` (réservé au cron global). |
| `scheduledBasketplanSync` | Scheduled (`0 3 * * *` Europe/Zurich) | Sync nocturne global. No-op si `config.club.basketplan.enabled !== true`. Pour chaque team avec `basketplanLinks` actifs → fetch + parse + `applyGame` par game. Update `team.basketplanSyncedAt` + `config.basketplan.lastSyncAt`/`lastSyncError`. |

> Les 5 fonctions mobile (`fanoutNotification` + 4 callables `coach*`) sont introduites par le chantier app mobile Flutter — cf. `docs/mobile-app.md`. Les callables `coach*` re-vérifient le scope coach côté serveur (Admin SDK) car `/members` et `/matches` sont write-admin-only dans `firestore.rules`. Les 2 callables self-service (`unlinkGuardian` + `deleteMyAccount`) sont introduites pour la page « Mon compte » de l'app `apps/courtbase-register` — cf. `docs/chantier-registrations.md` §"Self-service compte / RGPD". Les 8 callables `Basketplan` (6 mapping PR 1 + 1 sync callable PR 2 + 1 cron PR 2) sont introduites par le chantier d'intégration Swiss Basketball — cf. `docs/basketplan-integration.md` et `docs/chantier-basketplan.md`.

## Auth

- Firebase Auth = source de vérité. `/users/{uid}` mirror : profil + `roles` + `memberId`.
- Officials et coachs ont toujours un compte Auth. Joueurs (futur) aussi.
- **Custom claim `rootAdmin: true`** : per-project root. Créé au provisioning. L'ancien `superAdmin` est supprimé.
- **Editor global root** : pas un user Auth — identité GCP IAM (Owner ou rôle custom). Admin SDK + `gcloud`.
- Link Member ↔ User via `linkedUserId` (member) et `memberId` (user).
- `user.roles` (app access, guards) vs `member.roles` (classification club-interne). La "capacité official" dérive de `member.officialLevel != null`, pas de `user.roles`.
