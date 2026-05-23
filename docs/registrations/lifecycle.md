# Registrations — Lifecycle des statuts

> Les 10 statuts d'une `/registrations/{id}`, transitions, branches open/conditional, auto-rerouting, expiration trial.
> Pour le schéma du doc : voir [`schema.md`](./schema.md). Pour les Cloud Functions qui pilotent les transitions : voir [`functions.md`](./functions.md).

## 1. Diagramme global

```
draft  → submitted  → open_pending_trial  → trial_in_progress  → confirmed_pending_dues  → active
                  ↘ conditional_pending_review  → conditional_pending_trial  ↗
                                              ↘ refused (terminal, sauf auto-rerouting)
                                              
submitted → cancelled (par le user avant validation coach, terminal)
```

## 2. Les 10 statuts

| Status | Set par | Sens |
|---|---|---|
| `draft` | App register | User en cours de remplissage (autosave). |
| `submitted` | App register (à la confirmation) | Soumise, en attente de prise en charge. |
| `open_pending_trial` | App register (équipe ouverte) ou Function rerouting | Joueur peut venir au training d'essai librement. |
| `conditional_pending_review` | App register (équipe sous-conditions) | Coach doit accepter / refuser. |
| `conditional_pending_trial` | Coach (web) | Coach a accepté, joueur peut venir au test. |
| `trial_in_progress` | Coach (web) | Coach a marqué "essai en cours" — démarre le compteur 14j. |
| `confirmed_pending_dues` | Coach (web) | Coach valide l'intégration → trigger Function `createDuesForRegistration` (cotisation émise). |
| `active` | Function (paiement reçu) | Joueur officiellement inscrit. `member.active = true`, ajouté au `team.playerIds`. |
| `refused` | Coach (web) | Refus motivé, loggé. **Terminal** sauf si l'auto-rerouting déclenche une nouvelle registration. |
| `cancelled` | User (app register) ou admin | Désistement. **Terminal**. |

## 3. Branches open vs conditional

À la soumission (transition `submitted` → état suivant), le statut dépend du `team.registrationStatus` choisi :

### 3.1 Branche "équipe ouverte" (`team.registrationStatus === 'open'`)

1. App register affiche l'écran **"Manuel d'inscription du coach"** — texte libre (`team.openHandbook`). Exemples : *"Venez librement le mercredi 18h, sans inscription préalable"* ou *"Envoyez-moi un message pour fixer un entraînement test : 079 XXX XX XX"*. Photo + email + téléphone du coach affichés à côté.
2. Bouton **"Continuer l'inscription"** poursuit le wizard.
3. La `registration` sera créée avec `status: 'open_pending_trial'` à la fin du flow.

### 3.2 Branche "équipe sous conditions" (`team.registrationStatus === 'conditional'`)

1. App register affiche l'écran **"Conditions du coach"** — texte libre (`team.conditionalDescription`) où le coach décrit ses attentes. Exemple : *"Tu dois maîtriser le dribble main faible et avoir déjà joué en club. Tests de niveau organisés mi-août."*. Liste optionnelle de critères tagués (`team.conditionalCriteria: string[]`, juste pour l'affichage en chips).
2. Le parent accepte de continuer → la `registration` sera créée avec `status: 'conditional_pending_review'`.

**Workflow coach côté `apps/web`** (hors scope app register mais documenté ici) :
- Coach voit la registration `conditional_pending_review`.
- Il l'**accepte** → status `conditional_pending_trial` (joueur peut venir au test) — voir §4 plus bas pour la suite.
- Il la **refuse** → status `refused`, **log obligatoire** dans `/teams/{teamId}/refusalLogs` (un doc par refus, écrit côté serveur via la callable `refuseRegistration`).

## 4. Transitions post-acceptation

Une fois la registration en `open_pending_trial` OU `conditional_pending_trial` :

1. Le coach marque "essai en cours" → `trial_in_progress` (set `trialStartedAt = now`, démarre le compteur 14j).
2. Le coach valide l'intégration → `confirmed_pending_dues` (le trigger `initiateDuesOnPlayerActivation` crée la cotisation).
3. Le paiement de la cotisation arrive → `active` (posé automatiquement par le trigger `transitionRegistrationOnDuePaid` sur l'update `/dues/{id}.status` → `'paid'`. Le trigger set aussi `member.active = true` ; le membre est déjà dans `team.playerIds` depuis `confirmRegistration`).

**Cotisation née directement `issued` (flux inscription)** — quand le due est créé via `initiateDuesOnPlayerActivation` à la suite d'une `confirmRegistration` (lookup `registeredByUid` réussi sur la registration), la cotisation **bypasse** la grace period :

- `status = 'issued'` directement (pas de `pending_grace`).
- `dueAt = registration.trialStartedAt + 14j` (pas `now + paymentDueDays` — l'ancrage est l'essai, pas la création du due).
- `emailedAt = now` posé en même temps : l'email `dues_payment_request` est écrit dans `/pendingEmails` immédiatement à la création, pas au passage `pending_grace → issued`.

Cas legacy (joueur ajouté à `team.playerIds` directement par un admin, sans inscription) : path historique préservé — `status = 'pending_grace'`, `issuedAt = now + gracePeriodDays`, `dueAt = issuedAt + paymentDueDays`. Cf. `docs/firebase.md` → `/dues.registeredByUid` (détails du lookup) et [`functions.md`](./functions.md#34-transitionregistrationonduepaid) (trigger de transition).

## 5. Auto-rerouting après refus 🔜 Phase F (différé)

**Pas implémenté en MVP.** Le trigger `onRegistrationRefused` est repoussé en Phase F. Un refus reste terminal côté lifecycle. Comportement utilisateur actuel : si l'admin/coach veut rediriger un joueur refusé vers une autre équipe, il le fait manuellement (échange par email / téléphone, le parent re-soumet une registration vers l'autre équipe).

Spec cible (pour mémoire, à réactiver Phase F) :

- Si une registration passe en `refused` ET qu'une autre équipe `open` existe dans la même `categoryId`, le trigger déclenche :
  - Une `/notifications` pour le coach de l'équipe ouverte : *"{firstName} {lastName} ({age} ans) a été refusé par {team source}. Souhaitez-vous le contacter ?"*
  - Une `/notifications` (ou email via `/pendingEmails`) pour le parent : *"L'équipe X ne peut pas vous accueillir cette saison, mais l'équipe Y est ouverte."*
  - Bascule la `registration` vers la nouvelle équipe (set `teamId`) avec `status: 'open_pending_trial'`. L'historique du transfert vit dans `registration.actionLog`.

Voir [`functions.md`](./functions.md#32-onregistrationrefused--phase-f-différé) pour le détail.

## 6. Auto-expiration de l'essai (14 j)

Function scheduled `onTrialExpired` (daily 03:00 zurich) — toute registration en `trial_in_progress` depuis ≥ 14 jours sans transition déclenche **deux notifications** (IDs déterministes pour idempotence) :

- Une notification coach (`registration_trial_expired_coach`) : *"L'essai de {joueur} arrive à terme. Confirmer l'intégration ou refuser."*
- Une notification parent / joueur (`registration_trial_expired_user`) : *"L'essai arrive à terme. La cotisation doit être payée pour activer l'inscription, sinon le coach va trancher."*

Le trigger **ne bascule pas** automatiquement vers `refused` — la registration reste en `trial_in_progress` jusqu'à action manuelle du coach (`confirmRegistration` ou `refuseRegistration`). C'est aussi le rôle de cette alerte de débloquer les inscriptions oubliées.

Une fois la registration `confirmed_pending_dues`, le passage automatique en `active` est porté par le trigger `transitionRegistrationOnDuePaid` (cf. [`functions.md`](./functions.md#34-transitionregistrationonduepaid)) — déclenché à l'écriture du `paid` sur la cotisation correspondante.

## 7. Flag transverse

`registration.foreignTransfer: boolean` — peut coexister avec n'importe quel status (statut transverse, géré par l'admin séparément).

Quand `previousClubAbroad == true` est saisi à l'étape "ancien club", le flag est set sur la registration. La procédure FIBA / Swiss Basketball est cas par cas — un admin du club contacte l'utilisateur après l'inscription. Le champ `member.transferState` (`'none'` | `'national_pending'` | `'international_pending'` | `'cleared'`) est mis à jour par l'admin.

## 8. États terminaux

- `active` — fin heureuse du flow. Posé automatiquement par `transitionRegistrationOnDuePaid` au paiement.
- `refused` — terminal sauf si l'auto-rerouting (Phase F) génère une nouvelle registration (qui est une autre instance, pas la même).
- `cancelled` — terminal.

Les transitions de status sont posées par **callables** (`submitRegistration`, `markTrialInProgress`, `confirmRegistration`, `refuseRegistration`, `cancelRegistration`) ou par **triggers serveur** (`transitionRegistrationOnDuePaid`) — pas d'écriture client directe sur `status` une fois la registration soumise (cf. rule `/registrations` update qui n'ouvre que les drafts à l'auteur). Tout traversée porte une entrée `actionLog` cohérente.

## 9. Garantie 14 jours max

**Contrat business** : un joueur ne peut pas faire **plus de 14 jours** d'essai sans avoir reçu une demande de paiement de cotisation.

**Implémentation** : la cotisation `/dues` créée via `confirmRegistration` (puis `initiateDuesOnPlayerActivation`) naît directement `status = 'issued'` avec `dueAt = registration.trialStartedAt + 14j` et `emailedAt = now` (l'email part immédiatement). On ne chaîne plus `pending_grace 21j → issued 14j` (qui empilait potentiellement 35j d'attente avant le premier mail). Le compteur 14j est donc ancré sur le démarrage de l'essai, **pas** sur la création du due.

Cas non-couvert : un joueur ajouté à `team.playerIds` directement par un admin (création de membre hors registration). Path legacy préservé (grace + issued chaînés). À traiter au cas par cas si le besoin se confirme.
