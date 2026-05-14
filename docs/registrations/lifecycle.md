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

1. Le coach marque "essai en cours" → `trial_in_progress` (démarre le compteur 14j).
2. Le coach valide l'intégration → `confirmed_pending_dues` (trigger Function émet la cotisation).
3. Le paiement de la cotisation arrive → `active` (set par Function, `member.active = true`, ajouté au `team.playerIds`).

## 5. Auto-rerouting après refus

Si une registration passe en `refused` ET qu'une autre équipe `open` existe dans la même `categoryId`, la Function `onRegistrationRefused` déclenche :

- Une `/notifications` pour le coach de l'équipe ouverte avec contexte : "{firstName} {lastName} ({age} ans) a été refusé par {team source}. Souhaitez-vous le contacter ?"
- Une `/notifications` (ou email via `/pendingEmails`) pour le parent : "L'équipe X ne peut pas vous accueillir cette saison, mais l'équipe Y est ouverte. Le coach Y vous contactera."
- Bascule la `registration` vers la nouvelle équipe (set `teamId`) avec `status: 'open_pending_trial'`. L'historique du transfert vit dans `registration.actionLog`.

Voir [`functions.md`](./functions.md#32-onregistrationrefused) pour le détail du trigger.

## 6. Auto-expiration de l'essai (14 j)

Function scheduled `onTrialExpired` (daily 03:00 zurich) — toute registration en `trial_in_progress` depuis ≥ 14 jours sans transition → notif coach + parent : *"L'essai arrive à terme. Le joueur doit soit interrompre, soit la cotisation doit être payée."*.

**Pas** de bascule automatique vers `refused` — c'est au coach de trancher. La registration reste en `trial_in_progress` jusqu'à action manuelle.

## 7. Flag transverse

`registration.foreignTransfer: boolean` — peut coexister avec n'importe quel status (statut transverse, géré par l'admin séparément).

Quand `previousClubAbroad == true` est saisi à l'étape "ancien club", le flag est set sur la registration. La procédure FIBA / Swiss Basketball est cas par cas — un admin du club contacte l'utilisateur après l'inscription. Le champ `member.transferState` (`'none'` | `'national_pending'` | `'international_pending'` | `'cleared'`) est mis à jour par l'admin.

## 8. États terminaux

- `active` — fin heureuse du flow.
- `refused` — terminal sauf si auto-rerouting génère une nouvelle registration (qui est une autre instance, pas la même).
- `cancelled` — terminal.

Les transitions `update` sont **toutes interdites côté rules** (`allow update: if false`) — elles passent toutes par callables (voir [`functions.md`](./functions.md)) qui garantissent l'intégrité du lifecycle et l'écriture cohérente de `actionLog`.
