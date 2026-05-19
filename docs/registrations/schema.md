# Registrations — Schéma Firestore & permissions

> Schéma complet : nouvelles collections, extensions, rules.
> Pour le lifecycle des statuts : voir [`lifecycle.md`](./lifecycle.md). Pour les callables qui mutent ces docs : voir [`functions.md`](./functions.md).

## 1. Nouvelle collection `/registrations/{registrationId}`

```ts
interface RegistrationData {
  // Auteur de la registration (créateur du compte register)
  submittedByUid: string

  // Type d'inscription
  registrationFor: 'self' | 'dependent'
  relationship: 'parent' | 'legal_guardian' | 'sibling' | 'caritas' | 'other' | null
  relationshipOther: string | null   // si relationship === 'other'

  // Identité joueur (transmise telle quelle ; pas encore un /member)
  player: {
    firstName: string
    lastName: string
    birthDate: Timestamp
    gender: 'M' | 'F' | 'other' | null
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
  transferLetterStoragePath: string | null   // Storage path, null si pas uploadé
  foreignTransfer: boolean                   // flag transverse

  // Lifecycle
  status: RegistrationStatus
  statusUpdatedAt: Timestamp
  trialStartedAt: Timestamp | null
  refusalReason: string | null
  refusedByUid: string | null

  // Append-only log (transferts, refus, etc.)
  actionLog: RegistrationActionLogEntry[]

  // Notifs
  coachNotifiedAt: Timestamp | null
  adminNotifiedAt: Timestamp | null

  createdAt: Timestamp
}

type RegistrationStatus =
  | 'draft'
  | 'submitted'
  | 'open_pending_trial'
  | 'conditional_pending_review'
  | 'conditional_pending_trial'
  | 'trial_in_progress'
  | 'confirmed_pending_dues'
  | 'active'
  | 'refused'
  | 'cancelled'

interface RegistrationActionLogEntry {
  at: Timestamp
  byUid: string
  action: 'created' | 'submitted' | 'status_changed' | 'team_changed' | 'refused' | 'document_uploaded'
  previousStatus?: RegistrationStatus
  newStatus?: RegistrationStatus
  note?: string
}
```

Sub-collection `/registrations/{id}/documents/` pour les fichiers liés à la registration elle-même (lettre de sortie principalement). Les **documents de licence** (pièce ID, formulaire) vivent côté `/licenseRequests/{id}/documents/` une fois la demande de licence créée.

## 2. Nouvelle sub-collection `/teams/{teamId}/refusalLogs/{logId}`

```ts
interface RefusalLogData {
  registrationId: string
  playerName: string         // dénormalisé pour debug
  reason: string             // texte libre, obligatoire
  refusedAt: Timestamp
  refusedByUid: string       // coach
}
```

Lecture : admin uniquement (pour audit). Écriture : coach de l'équipe via callable `refuseRegistration` (sinon un coach pourrait skip le log).

> **Note indexes (leçon Phase C)** : les indexes Firestore single-field en DESC vont dans `fieldOverrides`, **pas** dans `indexes`. Cas concret : l'ordre `refusalLogs.refusedAt` DESC est déclaré comme un fieldOverride. Cf. [[functions-v2-invoker-binding]] et [`functions.md`](./functions.md) pour les autres gotchas deploy.

## 3. Extensions sur `/teams/{teamId}`

```ts
interface TeamData {
  // … existant …

  // Statut d'ouverture aux nouvelles inscriptions (par-saison-courante)
  registrationStatus: 'open' | 'conditional' | 'closed'

  // Manuel affiché en branche "équipe ouverte"
  openHandbook: string                  // markdown court, modifiable par coach et admin

  // Description + critères pour équipe sous-conditions
  conditionalDescription: string        // markdown court
  conditionalCriteria: string[]         // tags affichés en chips

  // Présentation publique (visible app register)
  publicTagline: string | null          // accroche courte
  publicHeadCoachMemberId: string | null  // si plusieurs coachs, lequel est "head" pour les inscriptions
}
```

> **Note legacy (leçon Phase C)** : les teams pré-existantes au chantier peuvent ne pas avoir `registrationStatus` posé. Le repo `teams.repo.ts` traite l'absence comme `'closed'`. À fix côté admin UI en posant `'open'` ou `'conditional'` manuellement sur les équipes existantes (Phase D — workflow coach côté `apps/web`).

## 4. Extensions sur `/members/{memberId}`

```ts
interface MemberData {
  // … existant …

  /** Numéro AVS (756.XXXX.XXXX.XX). Distinct de licenseNumber (qui est l'ID fédéral). */
  avs: string | null

  /** État de transfert pour le joueur. Mis à jour par admin. */
  transferState: 'none' | 'national_pending' | 'international_pending' | 'cleared'
}
```

## 5. Extensions sur `/users/{uid}`

```ts
interface UserData {
  // … existant …

  // Profil complété via app register
  phone: string | null
  address: UserAddress | null
  profileCompletedAt: Timestamp | null
}

interface UserAddress {
  street: string
  zip: string
  city: string
  country: string  // ISO 3166-1 alpha-2
}
```

> **Note** : le champ `memberId` (qui lie le user à un `/members/{id}` pour les self-registrations majeures) existe déjà sur `UserData` — pas besoin d'introduire un nouveau champ `linkedMemberId`. Le miroir inverse `member.linkedUserId` existe aussi déjà côté `MemberData`. On réutilise les deux tels quels.

> **Gotcha rules (leçon Phase C)** : la rule `update` sur `/users/{uid}` n'autorise **pas** le champ `email` dans `affectedKeys`. Ne **JAMAIS** inclure `email` dans un payload `upsertUserProfile` (sinon Firestore renvoie `permission-denied`). L'email Firebase Auth est la source de vérité — il est mirroré au `create` du `/users/{uid}` et reste figé ensuite.

## 6. Pas de doublon avec l'existant

- `/invitations` reste **uniquement** pour les invitations émises par un admin (Admin team). Les self-registrations passent par `/registrations`. Pas de fusion.
- `/licenseRequests` reste l'entité existante pour le workflow coach→admin licence. La page "Compléter les documents licence" **enrichit** une `/licenseRequests/{id}` existante au lieu de créer une nouvelle entité.
- Le doc `/members/{id}/private/contact` (email+phone du membre) reste source de vérité pour le contact **membre**. Les coordonnées du **tuteur** vivent sur son `/users/{uid}`.

## 7. Permissions Firestore

Règles à ajouter dans `firestore.rules` :

```
// Registrations
match /registrations/{registrationId} {
  // Lecture : auteur, tuteurs si registration pour un member lié, coach de la team, admin
  allow read: if isSignedIn() && (
    resource.data.submittedByUid == request.auth.uid
    || (resource.data.matchedMemberId != null && isGuardianOf(resource.data.matchedMemberId))
    || isCoachOfTeam(resource.data.teamId)
    || isAdmin()
  )
  // Écriture : auteur uniquement, et uniquement tant que status in {draft, submitted}
  // Les transitions de status post-soumission passent par callables
  allow create: if isSignedIn() && request.resource.data.submittedByUid == request.auth.uid
  allow update: if false   // toutes les updates via callables (intégrité du lifecycle)
  // Delete : auteur sur son draft, ou admin/rootAdmin (suppression définitive
  // depuis la vue Inscriptions — correction d'erreur). Cf. firestore.rules.
  allow delete: if isAuteurDraft || isAdmin() || isRootAdmin()
}

match /teams/{teamId}/refusalLogs/{logId} {
  allow read: if isAdmin()
  allow write: if false   // via callable refuseRegistration uniquement
}
```

Les extensions `/teams.openHandbook`, `/teams.conditional*`, etc. sont écrites par coach (sur ses teams) ou admin — pas de changement structurel des rules teams, juste autoriser les champs.

`/members.avs` et `/members.transferState` : write admin (et coach pour `transferState`?). MVP : admin only sur les deux.

`/users.phone`, `/users.address`, `/users.profileCompletedAt`, `/users.memberId` : write par le user lui-même ou admin. **Rappel** : `email` est exclu des champs writables au `update` (cf. §5 ci-dessus).

**Self-create `/users/{uid}`** : autoriser `create` par le user signé pour son propre uid, avec contraintes strictes pour éviter une escalade de privilèges :
- `request.auth.uid == uid`
- `request.resource.data.roles.size() == 0` (pas d'auto-attribution de rôle)
- `request.resource.data.memberId == null` (pas de lien arbitraire vers un membre)
- `request.resource.data.teamIds.size() == 0` (pas de scope coach)

Le rôle `parent` sera ajouté par la callable `submitRegistration` (Admin SDK) quand une registration "pour un enfant" est soumise — pas par le client.

### 7.1 Extensions sur les rules `/licenseRequests`

La règle actuelle restreint la lecture aux admins + coachs de la team. Pour que l'app register puisse afficher la page "Compléter les documents licence", il faut étendre la lecture au membre concerné et à ses tuteurs :

```
allow read: if isRootAdmin() || isAdmin()
  || (isCoach() && resource.data.teamId in userDoc().teamIds)
  || isLinkedMember(resource.data.memberId)
  || isGuardianOf(resource.data.memberId)
```

L'écriture des **documents** liés (pièce ID, formulaire signé) passe par callable `uploadLicenseDocument` (Admin SDK) plutôt qu'une rule directe sur une sub-collection — évite d'avoir à valider la taille / type des uploads dans les rules.

## 8. Indexes Firestore

Indices nécessaires pour les requêtes du chantier :

- `/registrations` : `(teamId, status)` — vue coach "inscriptions de mon équipe".
- `/registrations` : `(submittedByUid, createdAt desc)` — vue user "mes inscriptions".
- `collectionGroup('refusalLogs')` ordonné par `refusedAt desc` — vue admin "tous les refus". Le tri DESC est déclaré en `fieldOverrides` (pas dans `indexes`).

Voir [[firestore-collectiongroup-pattern]] pour le pattern collectionGroup réutilisable.
