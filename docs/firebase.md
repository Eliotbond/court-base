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
/matchTypes/{matchTypeId}
/seasons/{seasonId}
/closurePeriods/{periodId}
/bookings/{bookingId}
  /officialAssignments/{assignmentId}
  /attendance/{attendanceId}
/matchRequests/{requestId}
/notifications/{notificationId}
/dues/{dueId}
/paymentExceptionRequests/{requestId}
/licenseRequests/{requestId}
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
  officialsConfig: { licenseFee: number, thresholdGreen: number, thresholdOrange: number }
  duesConfig: { gracePeriodDays: number, paymentDueDays: number }
  createdAt: Timestamp
  createdBy: string  // uid
}
```
Le projet *est* le club. Ce doc ne porte que la config.

`shortCode` et `contact` vivent dans `/config/club` (et pas dans un doc séparé) parce qu'ils partagent **la même cadence de mise à jour** (un admin les ajuste ensemble depuis l'écran Settings → General), **la même frontière de sécurité** (write réservé à `admin` + `rootAdmin`, cf. rules ci-dessous), et ne justifient pas un doc dédié.

### `/users/{uid}`
```ts
{
  email: string
  displayName: string
  photoURL: string
  roles: string[]           // "admin" | "coach" (futur: "player", "official")
  memberId: string | null   // lien vers /members si user = membre
  teamIds: string[]         // scope coach
  createdAt: Timestamp
}
```
Un user appartient à **un seul projet**. Pas de `clubMemberships[]`.

### `/members/{memberId}`
```ts
{
  firstName, lastName: string
  roles: string[]                       // refs vers /roles
  linkedUserId: string | null           // uid Auth
  licenseNumber: string
  officialLevel: number | null          // 1, 2 ; null si pas official. Manuel admin.
  licensed: boolean                     // toggled by admin via licenseRequest approval
  duesStatus: "ok" | "pending_grace" | "due" | "overdue" | "excluded" | "excepted" | "n/a"
  duesStatusUpdatedAt: Timestamp
  active: boolean
}
```
**Pas de `email`/`phone` ici** — voir `/members/{memberId}/private/contact` ci-dessous. Le doc parent est lisible par tous les rôles club (incl. `official`-only). Les contacts sont gated séparément.

### `/members/{memberId}/private/contact` (singleton, ID fixe `contact`)
```ts
{
  email: string
  phone: string
}
```
Lecture : `rootAdmin`, `admin`, `coach`, et le membre lui-même (via `linkedUserId == request.auth.uid`).
Écriture : `rootAdmin`, `admin`, et le membre lui-même.
Les `official`-only (pas admin, pas coach) **ne voient pas** ce doc.

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
  duesAmount: number              // CHF, annuel
  schedulingConstraints: {
    preferredDays: [{ dayOfWeek, priority }]
    maxStartTime: string
    minHoursBetweenSlots: number
    trainingsPerWeek: number
    anticipatedMatches: number
    coachAvailability: [{ coachMemberId, unavailableDays, unavailableSlots }]
  }
  tags: [{ tagId: string, display: boolean }]  // ref → /tags/{tagId}, display flag par-équipe
  active: boolean
  createdAt: Timestamp
}
```
`categoryId` est une référence (pas un libellé dénormalisé) — le nom d'affichage et la tranche d'âge sont résolus à la lecture via `/categories/{id}`. Pour la liste des équipes, le repo bat un seul `getDocs('/categories')` puis enrichit chaque team (pas de N+1).

`tags` permet de différencier visuellement des équipes similaires (ex. deux U14M). Chaque entrée référence un `/tags/{id}` et porte un flag `display` propre à l'équipe : un même tag peut être attaché à plusieurs équipes mais n'être affiché que sur certaines (cf. `/tags` ci-dessous et `main.md` → "Tags d'équipes"). Résolu par batch lookup à la lecture (pattern identique aux catégories).

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

### `/bookings/{bookingId}`
```ts
{
  seasonId, venueId, courtId, timeSlotId: string
  teamId: string | null
  slotType: string                  // mirroré à la génération
  matchTypeId: string | null
  date: Timestamp
  startTime, endTime: string
  status: "scheduled" | "cancelled" | "freed"
  cancelReason: string | null       // "closure" | "holiday" | "manual" | "match_home" | "match_away" | "coach_cancel"
  linkedBookingIds: string[]        // courts combinés
  isCombinedCourtEvent: boolean
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
  relatedBookingId: string | null
  createdAt: Timestamp
  readBy: string[]                   // uids
}
```

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
  recordedBy: string | null
  exceptionRequestId: string | null
  notes: string | null
  createdAt: Timestamp
}
```
Un `due` par joueur/saison/team. Switch d'équipe mid-saison : TBD (probablement garder le due original).

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
- **`/dues/`** : admin (all), coach (joueurs de ses équipes). Write admin + Functions. Coachs **jamais** d'écriture directe.
- **`/paymentExceptionRequests/`** : coach crée pour ses joueurs, lit les siens. Admin lit/écrit tout.
- **`/licenseRequests/`** : idem. `member.licensed` écrit seulement par admin (ou Function sur approval).
- **Route guards** : **allowlist** des rôles par route. `rootAdmin` implicitement dans toutes.
- **collectionGroup queries** : exigent une règle séparée `match /{path=**}/<name>/{id}` — les rules de sous-collection ne couvrent **pas** les `collectionGroup()` queries (limitation Firestore). Présent pour `courts` (utilisé par Venues + Bookings). À ajouter au cas par cas si une nouvelle `collectionGroup()` query apparaît côté client (ex. `attendance`, `officialAssignments` côté web aujourd'hui : leurs lectures sont catch-failed, mais à corriger si on veut les activer).

## Cloud Functions

Déployées sur **chaque projet client** via CI cross-projet (voir `deployment.md`). Code identique partout.

| Function | Trigger | Rôle |
|---|---|---|
| `generateSeasonBookings` | Saison → `active` | Génère bookings (1 par slot par date), hors closures. |
| `previewSeasonBookings` | Callable | Dry-run : retourne plan sans écrire. |
| `applyClosurePeriod` | Closure ajouté à saison `active` | Cascading cancel (`cancelReason: "closure"`). |
| `handleMatchSlotChange` | Slot devient `match_home`/`match_away` | Suspend ou libère `training` même équipe ce jour. |
| `autoOfficialsNeededNotification` | Scheduled | Notif si `match_home` < 7j et pas full staff. |
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

## Auth

- Firebase Auth = source de vérité. `/users/{uid}` mirror : profil + `roles` + `memberId`.
- Officials et coachs ont toujours un compte Auth. Joueurs (futur) aussi.
- **Custom claim `rootAdmin: true`** : per-project root. Créé au provisioning. L'ancien `superAdmin` est supprimé.
- **Editor global root** : pas un user Auth — identité GCP IAM (Owner ou rôle custom). Admin SDK + `gcloud`.
- Link Member ↔ User via `linkedUserId` (member) et `memberId` (user).
- `user.roles` (app access, guards) vs `member.roles` (classification club-interne). La "capacité official" dérive de `member.officialLevel != null`, pas de `user.roles`.
