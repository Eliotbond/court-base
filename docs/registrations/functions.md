# Registrations — Cloud Functions

> Toutes les Cloud Functions du chantier : callables + triggers + scheduled. Région `europe-west6` (zurich), idempotence via IDs déterministes (cf. `firestore_functions_phase1`).
> Pour le schéma des docs mutés : voir [`schema.md`](./schema.md). Pour le lifecycle des statuts manipulés : voir [`lifecycle.md`](./lifecycle.md).

## 1. Vue d'ensemble

| Function | Trigger | Rôle |
|---|---|---|
| `matchExistingMember` | Callable (auth required) | Lookup AVS + fuzzy match. Retourne `MemberMatch[]`. |
| `submitRegistration` | Callable | Crée `/registrations/{id}` (status = `submitted`), notifie coach + admin, file un email user via `/pendingEmails`. Idempotent : refuse re-soumission d'un draft déjà submitted. |
| `cancelRegistration` | Callable | L'auteur annule sa propre inscription (transition vers `cancelled`). |
| `refuseRegistration` | Callable (coach scope) | Set `status = 'refused'`, écrit `/teams/{teamId}/refusalLogs`, déclenche auto-rerouting si une autre équipe `open` existe dans la catégorie. |
| `markTrialInProgress` | Callable (coach scope) | Passe une registration en `trial_in_progress` (entraînement planifié), démarre le compteur 14j. Idempotent : un re-call ne réinitialise pas `trialStartedAt`. |
| `confirmRegistration` | Callable (coach scope) | Interrompt l'essai en confirmant le joueur : crée `/members/{id}` (si nouveau), ajoute au `team.playerIds` (déclenche `initiateDuesOnPlayerActivation`), passe en `confirmed_pending_dues`. |
| `becomeOwnerOfMyMember` | Callable (user) | Quand le pupille devient majeur ET que la majorité transition est résolue avec consent, permet au membre de prendre la main : crée `member.linkedUserId = uid`, retire `member.guardianUserIds`. Garde-fous : nécessite âge ≥ 18 ans ET state `majorityTransition.resolvedAt != null`. |
| `generateLicenseForm` | Callable (admin ou coach) | Génère le PDF de formulaire pré-rempli pour une `/licenseRequests/{id}` ; renvoie un Storage path. |
| `respondLicenseDocReview` | Callable (admin) | Accepte / refuse un document de licence, notifie le user. |
| `onRegistrationStatusChanged` | Firestore trigger | Crée notifs (`new_registration`, `registration_accepted`, `registration_refused`, `trial_started`), maintient `member.duesStatus` lifecycle si on atteint `confirmed_pending_dues`. |
| `onRegistrationRefused` | Firestore trigger | Auto-rerouting après refus : si une autre équipe `open` existe dans la catégorie, transfère la registration et notifie le nouveau coach + le parent. |
| `onTrialExpired` | Scheduled (daily 03:00 zurich) | Notifs aux registrations en `trial_in_progress` depuis ≥ 14j sans transition. |

## 2. Callables — détails

### 2.1 `matchExistingMember`

**Input** :
```ts
{ firstName: string, lastName: string, birthDate: string /* YYYY-MM-DD */, avs?: string | null }
```

**Output** :
```ts
{ matches: MemberMatch[] }
```

**Logique** :
1. Si `avs` renseigné : recherche `/members where licenseNumber == avs OR avs == avs` (champ AVS dédié, distinct de `licenseNumber`).
   - **Hit exact** → renvoie le member en `match.kind: 'avs'`.
2. Sinon, **fuzzy match côté serveur** (pas d'index Firestore qui le supporte) :
   - Lit la liste des membres par DOB exact d'abord.
   - Filtre nom/prénom en JS via Levenshtein ≤ 2 sur `firstName + lastName`.
   - Acceptable car volume < 10k membres / club.

L'UI affichera un prompt de confirmation explicite avant de set `registration.matchedMemberId`.

### 2.2 `submitRegistration`

**Input** : payload complet de la registration (draft prêt à submit).

**Notes payload importantes** :
- `birthDate` est au format **ISO `YYYY-MM-DD` (string)**, **pas** un Timestamp. Conversion à faire côté client avant l'appel.
- Le serveur convertit en Timestamp Firestore avant écriture.

**Effets** :
- Crée `/registrations/{id}` avec `status = 'submitted'` (ou `open_pending_trial` / `conditional_pending_review` selon `team.registrationStatus` — voir [`lifecycle.md`](./lifecycle.md)).
- Notifie coach + admin via `/notifications`.
- File un email user de confirmation via `/pendingEmails`.
- Si `registrationFor === 'dependent'` : ajoute le rôle `parent` au `/users/{submittedByUid}` (via Admin SDK).

**Idempotence** : refuse la re-soumission d'un draft déjà submitted (vérifie le status courant).

### 2.3 `cancelRegistration`

**Input** : `{ registrationId: string }`.

**Effets** : transition vers `status = 'cancelled'` si le user appelant est l'auteur ET que le status courant est dans `{draft, submitted, *_pending_*}` (pas après `confirmed_pending_dues`). Écrit dans `actionLog`.

### 2.4 `refuseRegistration`

**Input** : `{ registrationId: string, reason: string }`.

**Garde** : appelant doit être coach de la team concernée OU admin.

**Effets** :
- Set `status = 'refused'`, `refusalReason`, `refusedByUid`.
- Crée `/teams/{teamId}/refusalLogs/{logId}` (le log est obligatoire et écrit côté serveur — un coach ne peut pas le contourner).
- Déclenche le rerouting via le trigger `onRegistrationRefused` (voir §3.2).

### 2.5 `markTrialInProgress`

**Input** : `{ registrationId: string }`.

**Garde** : appelant doit être coach de la team OU admin.

**State preconditions** : `status` ∈ {`open_pending_trial`, `conditional_pending_review`, `conditional_pending_trial`}.

**Effets** (transaction) :
- Set `status = 'trial_in_progress'`, `statusUpdatedAt = now`.
- Set `trialStartedAt = now` UNIQUEMENT si pas déjà défini (idempotence : un re-call ne réinitialise pas le compteur 14j — le scheduled `onTrialExpired` reste calé sur la 1ère démarrage).
- Append entrée `actionLog` (`action: 'status_changed'`, note: "trial started").

**Note design** : depuis `conditional_pending_review`, on autorise la transition directe vers `trial_in_progress` (collapse l'étape "accept" intermédiaire). Si un coach veut juste accepter sans démarrer l'essai, il faut une callable séparée — pas dans le scope MVP.

### 2.6 `confirmRegistration`

**Input** : `{ registrationId: string }`.

**Output** : `{ ok, registrationId, memberId, memberCreated, status: 'confirmed_pending_dues' }`.

**Garde** : appelant doit être coach de la team OU admin.

**State preconditions** : `status === 'trial_in_progress'`. Une confirmation depuis un état pre-trial est rejetée — passer d'abord par `markTrialInProgress`.

**Effets** (transaction) :
1. Si `registration.matchedMemberId === null` : crée `/members/{id}` depuis `registration.player`. Sinon, réutilise le member existant.
   - Member fields : `roles: ['player']`, `licenseNumber: ''`, `officialLevel: null`, `licensed: false`, `duesStatus: 'n/a'` (sera flippé par `initiateDuesOnPlayerActivation`), `active: true`, `transferState` = `'international_pending'` si `registration.foreignTransfer` sinon `'none'`.
   - `linkedUserId` / `guardianUserIds` :
     - `for: 'self'`     → `linkedUserId = submittedByUid`, `guardianUserIds = []`.
     - `for: 'dependent'`→ `linkedUserId = null`, `guardianUserIds = [submittedByUid]`.
   - `comms` : recipients `['member']` si `for: 'self'` OU si majeur ; `['guardians']` si `for: 'dependent'` ET mineur.
2. `arrayUnion(memberId)` sur `team.playerIds` — déclenche le trigger `initiateDuesOnPlayerActivation` (création `/dues/{id}` + `member.duesStatus = 'pending_grace'`).
3. Update registration : `status = 'confirmed_pending_dues'`, `statusUpdatedAt`, `matchedMemberId = memberId` (dénormalisé pour ne pas perdre la trace si on a créé un nouveau member), append actionLog.

**Limitation v1** : le linking inverse `/users/{submittedByUid}.memberId` n'est pas mis à jour ici (write rules `users.memberId` admin-only — un futur callable `linkUserToMember` le portera). Pour l'instant la liaison est portée uniquement par `member.linkedUserId` / `guardianUserIds`.

### 2.7 `becomeOwnerOfMyMember`

**Input** : `{ memberId: string }`.

**Garde-fous** :
- L'appelant doit être un guardian de ce member (`uid in member.guardianUserIds`) **OU** être le member lui-même qui devient majeur.
- Le member doit avoir âge ≥ 18 ans.
- `majorityTransition.resolvedAt != null` (state machine majorité résolue).

**Effets** : set `member.linkedUserId = uid`, vide `member.guardianUserIds`, ajoute le memberId sur `users/{uid}.memberId`.

### 2.8 `generateLicenseForm`

**Input** : `{ licenseRequestId: string }`.

**Effets** : génère un PDF pré-rempli à partir de `member` + `licenseRequest`, l'upload en Storage (`licenseRequests/{id}/form-prefilled.pdf`), renvoie le Storage path.

Peut commencer en stub HTML→PDF en Phase E.

### 2.9 `respondLicenseDocReview`

**Input** : `{ licenseRequestId: string, documentId: string, decision: 'accept' | 'refuse', reason?: string }`.

**Garde** : admin only.

**Effets** : marque le document accepté/refusé, notifie le user via `/notifications` + email.

## 3. Triggers Firestore — détails

### 3.1 `onRegistrationStatusChanged`

**Trigger** : `onUpdate` sur `/registrations/{registrationId}` quand `status` change.

**Effets** :
- Crée des `/notifications` selon le nouveau status :
  - `new_registration_open` / `new_registration_conditional` → head coach + admin.
  - `registration_accepted` → submittedByUid.
  - `registration_refused` → submittedByUid.
  - `trial_started` → submittedByUid + coach.
- Si `status === 'confirmed_pending_dues'` : maintient `member.duesStatus` (lifecycle cotisation).

### 3.2 `onRegistrationRefused`

**Trigger** : `onUpdate` filtré sur `status === 'refused'`.

**Logique auto-rerouting** : si une autre équipe `open` existe dans la même `categoryId` ET que le user n'a pas explicitement refusé :
- Crée une `/notifications` pour le coach de l'équipe ouverte avec contexte : "{firstName} {lastName} ({age} ans) a été refusé par {team source}. Souhaitez-vous le contacter ?"
- Crée une `/notifications` (ou email via `/pendingEmails`) pour le parent : "L'équipe X ne peut pas vous accueillir cette saison, mais l'équipe Y est ouverte. Le coach Y vous contactera."
- Bascule la `registration` vers la nouvelle équipe (set `teamId`) avec `status: 'open_pending_trial'`. L'historique du transfert vit dans `registration.actionLog`.

### 3.3 `onTrialExpired`

**Trigger** : scheduled daily 03:00 zurich.

**Logique** : balaie toutes les registrations en `trial_in_progress` depuis ≥ 14 jours sans transition. Pour chacune :
- Notifie coach + parent : *"L'essai arrive à terme. Le joueur doit soit interrompre, soit la cotisation doit être payée."*.
- **Pas** de bascule automatique vers `refused` — c'est au coach de trancher.

## 4. Anti-abus refus

Un job hebdo (futur) peut alerter l'admin si un coach a `> N` refus sur la saison — pour MVP on se contente du log dans `/teams/{teamId}/refusalLogs`, l'audit reste manuel.

## 5. Gotchas deploy v2 (leçons Phase C)

### 5.1 Binding IAM Cloud Run `allUsers/roles/run.invoker`

Toute nouvelle function **callable v2** nécessite un binding IAM manuel après chaque deploy — sinon la callable plante en `"internal"` côté client.

Commande à exécuter après chaque deploy d'une nouvelle function v2 :

```bash
gcloud run services add-iam-policy-binding <fn-lowercase> \
  --region=europe-west6 \
  --member=allUsers \
  --role=roles/run.invoker \
  --project=<projectId>
```

Le `<fn-lowercase>` est le **nom lowercase** de la function (Cloud Run normalise les noms). Exemple : `submitRegistration` → service Cloud Run `submitregistration`.

Lié à [[deploy-functions-v2-invoker-binding]].

### 5.2 Diagnostic des erreurs callables

Le `firebase functions:log` est cassé sur ce projet. Utiliser `gcloud logging` directement :

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="<lowercase-name>"' \
  --project=<projectId> \
  --limit=10
```

### 5.3 Indexes Firestore

Les indexes single-field DESC vont dans `fieldOverrides`, **pas** dans `indexes`. Cas concret : `refusalLogs.refusedAt` DESC. Cf. [`schema.md`](./schema.md#8-indexes-firestore).

### 5.4 Préférer single-field + tri JS sur petits volumes

Pour les volumes < 100 docs (typique pour les registrations d'un seul user, ou les refusalLogs d'une seule team), éviter les **index composites** Firestore : préférer un single-field index + un tri JS côté client. Bénéfices : pas de deploy d'index à attendre, moins de coupling rules/indexes.

## 6. Memory liées

- [[firestore-functions-phase1]] — conventions générales Cloud Functions du repo (idempotence, region, secrets).
- [[deploy-functions-monorepo-fix]] — packer shared-types en tarball avant `firebase deploy --only functions:*`.
- [[deploy-functions-v2-invoker-binding]] — détail du gotcha §5.1 ci-dessus.
- [[admin-invitation-flow]] — pas réutilisé (self-registration ≠ invitation), mais l'architecture callable + Admin SDK est le même pattern.
