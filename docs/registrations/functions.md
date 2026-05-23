# Registrations — Cloud Functions

> Toutes les Cloud Functions du chantier : callables + triggers + scheduled. Région `europe-west6` (zurich), idempotence via IDs déterministes (cf. `firestore_functions_phase1`).
> Pour le schéma des docs mutés : voir [`schema.md`](./schema.md). Pour le lifecycle des statuts manipulés : voir [`lifecycle.md`](./lifecycle.md).

## 1. Vue d'ensemble

| Function | Trigger | Rôle |
|---|---|---|
| `matchExistingMember` | Callable (auth required) | Lookup d'un member existant par AVS exact. Retourne `MemberMatch[]`. |
| `submitRegistration` | Callable | Crée `/registrations/{id}` (status = `submitted`), notifie coach + admin, file un email user via `/pendingEmails`. Idempotent : refuse re-soumission d'un draft déjà submitted. |
| `cancelRegistration` | Callable | L'auteur annule sa propre inscription (transition vers `cancelled`). |
| `refuseRegistration` | Callable (coach scope) | Set `status = 'refused'`, écrit `/teams/{teamId}/refusalLogs`, déclenche auto-rerouting si une autre équipe `open` existe dans la catégorie. |
| `markTrialInProgress` | Callable (coach scope) | Passe une registration en `trial_in_progress` (entraînement planifié), démarre le compteur 14j. Idempotent : un re-call ne réinitialise pas `trialStartedAt`. |
| `confirmRegistration` | Callable (coach scope) | Interrompt l'essai en confirmant le joueur : crée `/members/{id}` (si nouveau), ajoute au `team.playerIds` (déclenche `initiateDuesOnPlayerActivation`), passe en `confirmed_pending_dues`. |
| `becomeOwnerOfMyMember` | Callable (user) | Quand le pupille devient majeur ET que la majorité transition est résolue avec consent, permet au membre de prendre la main : crée `member.linkedUserId = uid`, retire `member.guardianUserIds`. Garde-fous : nécessite âge ≥ 18 ans ET state `majorityTransition.resolvedAt != null`. |
| `generateLicenseForm` | Callable (admin ou coach) | Génère le PDF de formulaire pré-rempli pour une `/licenseRequests/{id}` ; renvoie un Storage path. |
| `respondLicenseDocReview` | Callable (admin) | Accepte / refuse un document de licence, notifie le user. |
| `onRegistrationStatusChanged` | Firestore trigger | Crée notifs lifecycle (`new_registration_*`, `registration_accepted`, `registration_refused`, `trial_started`, `registration_dues_pending`, `registration_active`) à chaque transition. IDs déterministes pour idempotence. |
| `onRegistrationRefused` | Firestore trigger | 🔜 **Phase F (différé)** — auto-rerouting après refus. Non implémenté. |
| `onTrialExpired` | Scheduled (daily 03:00 zurich) | Notifs (coach + parent) sur registrations en `trial_in_progress` depuis ≥ 14j sans transition. Pas de bascule automatique. |
| `transitionRegistrationOnDuePaid` | Firestore trigger (`/dues/{id}` update → `paid`) | Lookup registration `(matchedMemberId, teamId)`. Si `confirmed_pending_dues` → set `active`, `member.active = true`, append actionLog. Idempotent. |

## 2. Callables — détails

### 2.1 `matchExistingMember`

**Input** :
```ts
{ avs: string }
```

**Output** :
```ts
{ matches: MemberMatch[] }
```

**Logique** — match **AVS exact uniquement** (l'AVS étant désormais obligatoire dans le wizard, c'est le seul critère de dédoublonnage live) :
1. Recherche `/members where avs == avs` (champ AVS dédié, distinct de `licenseNumber`).
   - **Hit** → renvoie le member en `matchedOn: 'avs'`.
2. Fallback historique : `/members where licenseNumber == avs` (anciens dossiers où l'AVS avait été saisi dans `licenseNumber`) → `matchedOn: 'licenseNumber'`.

Plus de fuzzy match nom/prénom/DOB côté wizard. Le filet anti-doublon nom+date de naissance subsiste uniquement côté `confirmRegistration` (`findExactMemberMatch`), pour rattraper les members legacy sans AVS enregistré.

Chaque `MemberMatch` porte **`linkedToOtherAccount: boolean`** — `true` si le dossier est déjà rattaché à un compte **autre que le caller** (`member.linkedUserId` propriétaire, ou un `guardianUserIds` tuteur). Un dossier rattaché uniquement au caller (renouvellement / ré-inscription par le même compte) — ou rattaché à personne — vaut `false`.

L'UI affiche un prompt de confirmation explicite avant de set `registration.matchedMemberId`. Si `linkedToOtherAccount === true`, le wizard **refuse le rattachement self-service** et invite à contacter le club — pas de création d'un nouveau dossier (l'AVS étant unique, ce serait un doublon de la même personne).

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
- Set `trialStartedAt = now` UNIQUEMENT si pas déjà défini (idempotence : un re-call ne réinitialise pas le compteur 14j — le scheduled `onTrialExpired` reste calé sur le 1er démarrage). Pas de paramètre optionnel pour forcer une date — décision design assumée, le coach doit marquer l'essai au moment où il commence pour rester source de vérité.
- Append entrée `actionLog` (`action: 'status_changed'`, note: "trial started").

**Note design** : depuis `conditional_pending_review`, on autorise la transition directe vers `trial_in_progress` (collapse l'étape "accept" intermédiaire). Si un coach veut juste accepter sans démarrer l'essai, il faut une callable séparée — pas dans le scope MVP.

`trialStartedAt` est aussi l'**ancre du compteur 14j de la cotisation** : `confirmRegistration` (cf. §2.6) émet la due avec `dueAt = trialStartedAt + 14j`. Cf. [`lifecycle.md`](./lifecycle.md#9-garantie-14-jours-max).

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
2. `arrayUnion(memberId)` sur `team.playerIds` — déclenche le trigger `initiateDuesOnPlayerActivation`.
3. Update registration : `status = 'confirmed_pending_dues'`, `statusUpdatedAt`, `matchedMemberId = memberId` (dénormalisé pour ne pas perdre la trace si on a créé un nouveau member), append actionLog.

**Note cotisation émise (cf. §3.4 et [`lifecycle.md`](./lifecycle.md#9-garantie-14-jours-max))** : la due créée par `initiateDuesOnPlayerActivation` à la suite de cette confirmation naît directement `status='issued'` avec `dueAt = registration.trialStartedAt + 14j` et `emailedAt = now` (email envoyé immédiatement). Le compteur 14j est donc ancré sur le démarrage de l'essai, pas sur la création du due — bypass du chaînage `pending_grace 21j → issued 14j` qui pouvait étirer la première demande de paiement à J+35 dans l'ancien modèle.

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

**Trigger** : `onUpdate` sur `/registrations/{registrationId}` filtré sur changement de `status` (`before.status !== after.status`).

**Effets** : crée une notification par transition. IDs déterministes `${registrationId}_${newStatus}` pour idempotence — un re-fire de l'event n'écrit pas deux notifs.

| Transition entrante | `notification.type` | Audience | Doc ID |
|---|---|---|---|
| `submitted` → `open_pending_trial` | `new_registration_open` | head coach + admin | `${regId}_open_pending_trial` |
| `submitted` → `conditional_pending_review` | `new_registration_conditional` | head coach + admin | `${regId}_conditional_pending_review` |
| `conditional_pending_review` → `conditional_pending_trial` | `registration_accepted` | submittedByUid | `${regId}_conditional_pending_trial` |
| `*_pending_*` → `trial_in_progress` | `trial_started` | submittedByUid + coach | `${regId}_trial_in_progress` |
| `*` → `confirmed_pending_dues` | `registration_dues_pending` | submittedByUid | `${regId}_confirmed_pending_dues` |
| `*` → `refused` | `registration_refused` | submittedByUid | `${regId}_refused` |
| `confirmed_pending_dues` → `active` | `registration_active` | submittedByUid + coach | `${regId}_active` |

`confirmed_pending_dues` → `active` est posée par le trigger `transitionRegistrationOnDuePaid` (§3.4) — `onRegistrationStatusChanged` se contente d'observer cette transition pour émettre la notif.

### 3.2 `onRegistrationRefused` 🔜 Phase F (différé)

**Pas implémenté en MVP.** Auto-rerouting (transfert d'une registration refusée vers une autre équipe `open` de la même catégorie + notif au coach cible + email parent) déféré à Phase F. Comportement actuel : un refus reste terminal côté lifecycle, l'admin remet en main propre s'il veut rerouter.

Spec cible (pour mémoire, à réactiver Phase F) : `onUpdate` filtré sur `status === 'refused'`. Si une autre équipe `open` existe dans la même `categoryId`, bascule la registration vers la nouvelle équipe (set `teamId`, `status: 'open_pending_trial'`), notifie le coach de l'équipe cible et le parent.

### 3.3 `onTrialExpired`

**Trigger** : scheduled daily 03:00 Europe/Zurich.

**Logique** : query Firestore `where status == 'trial_in_progress' && trialStartedAt <= now - 14d`. Pour chaque registration matchée, écrit **deux** notifications (IDs déterministes pour idempotence — un re-run quotidien ne re-spamme pas) :

| Audience | `notification.type` | Doc ID |
|---|---|---|
| Coach de la team | `registration_trial_expired_coach` | `${regId}_trial_expired_coach` |
| `submittedByUid` (parent / joueur) | `registration_trial_expired_user` | `${regId}_trial_expired_user` |

**Pas** de bascule automatique vers `refused` — c'est au coach de trancher (confirmer l'intégration ou refuser explicitement).

**Index Firestore requis** : composite `(status ASC, trialStartedAt ASC)` sur `/registrations` — à **ajouter dans `firestore.indexes.json`**. Sans cet index, la query plante en `failed-precondition` au premier run.

### 3.4 `transitionRegistrationOnDuePaid`

**Trigger** : `onUpdate` sur `/dues/{dueId}` filtré sur `before.status !== 'paid' && after.status === 'paid'`.

**Logique** :

1. Lookup `/registrations where matchedMemberId == due.memberId && teamId == due.teamId` (simple query, tri JS si plusieurs hits — la plus récente gagne).
2. Si trouvée ET `registration.status === 'confirmed_pending_dues'` :
   - Update registration : `status = 'active'`, `statusUpdatedAt = now`, append `actionLog` (`action: 'status_changed'`, `previousStatus: 'confirmed_pending_dues'`, `newStatus: 'active'`, `note: 'Cotisation payée'`).
   - Update `/members/{memberId}` : `active = true` (sortie de suspension app club si applicable, cf. `firebase.md` → "Membre inactif").
3. Si registration introuvable, ou déjà `active`, ou autre status (sécurité) → skip silencieux. **Idempotent** : un re-fire qui voit `registration.status === 'active'` ne fait rien.

Effet utilisateur : un parent qui paie la cotisation depuis `apps/courtbase-register` voit sa registration basculer **automatiquement** en `active` sans intervention coach — la notif `registration_active` part dans la foulée via `onRegistrationStatusChanged` (§3.1).

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
