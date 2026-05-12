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
  logo: string | null
  address: { street, city, zip, country } | null
  officialsConfig: { licenseFee: number, thresholdGreen: number, thresholdOrange: number }
  duesConfig: { gracePeriodDays: number, paymentDueDays: number }
  createdAt: Timestamp
  createdBy: string  // uid
}
```
Le projet *est* le club. Ce doc ne porte que la config.

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
  category: string
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
  active: boolean
  createdAt: Timestamp
}
```

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
  cancelReason: string | null       // "closure" | "holiday" | "manual" | "match_away" | "coach_cancel"
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
  issuedAt: Timestamp | null         // J+gracePeriodDays
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
  - Read members limités (identification sur match, pas de contact info des non-liés).
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

## Auth

- Firebase Auth = source de vérité. `/users/{uid}` mirror : profil + `roles` + `memberId`.
- Officials et coachs ont toujours un compte Auth. Joueurs (futur) aussi.
- **Custom claim `rootAdmin: true`** : per-project root. Créé au provisioning. L'ancien `superAdmin` est supprimé.
- **Editor global root** : pas un user Auth — identité GCP IAM (Owner ou rôle custom). Admin SDK + `gcloud`.
- Link Member ↔ User via `linkedUserId` (member) et `memberId` (user).
- `user.roles` (app access, guards) vs `member.roles` (classification club-interne). La "capacité official" dérive de `member.officialLevel != null`, pas de `user.roles`.
