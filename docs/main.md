# Club Management App — Spec produit

> Source de vérité pour le domaine et les règles métier. À lire au début de toute session. Pour les détails techniques, voir les docs spécialisés référencés ci-dessous.

## Document map

| Fichier | Quand le lire |
|---|---|
| `main.md` (ce fichier) | Toujours — domaine, règles métier |
| `firebase.md` | Schéma Firestore, rules, Functions, Auth |
| `frontend-desktop.md` | App Vue.js (admin + coach desktop) |
| `mobile-app.md` | App Flutter (Phase 2) |
| `deployment.md` | Multi-projet, control-plane, migrations |
| `git-workflow.md` | Branches, commits, PRs |

## Stack

| Layer | Tech |
|---|---|
| Web | Vue 3 + Vite + TS + PrimeVue + Pinia |
| Mobile | Flutter + Riverpod + GoRouter |
| Backend | Firebase (Firestore, Auth, Functions, Storage, FCM) |
| Modèle | **Un projet Firebase par client** (isolation GCP-level) |

## Modèle de déploiement — SAAS one-project-per-client

- **Un projet Firebase = un club.** Pas de `clubId` dans les paths Firestore — collections plates à la racine.
- **Control-plane éditeur** : un projet Firebase séparé qu'on héberge, contient le registre des clients (`/registry/clients`) et orchestre les déploiements cross-projet. Voir `deployment.md`.
- **Mises à jour backend** = déploiement sur tous les projets via CI. Migrations Firestore versionnées et idempotentes.

## Onboarding club — étapes de config

Une fois le projet client provisionné (voir `deployment.md`) et l'admin connecté :

1. **MatchTypes** — types de compétition (CSJC, AFBB, Amical…) avec taille de court et besoins officiels.
2. **Rôles membre** — système + custom.
3. **Membres** — CRUD, rôles, niveaux officiels, link compte Auth.
4. **Teams** — coachs, joueurs, contraintes planning, montant des cotisations par équipe.
5. **Venues & courts** — salles, courts physiques avec `courtSize`, courts combinés.
6. **Slot types** — système (`training`, `match_home`, `match_away`, `reserve`) + custom (label seulement).

Configs indépendantes des saisons, réutilisables.

## Entités principales

- **Club** — singleton `config/club` (identité + `officialsConfig` + `duesConfig`). Le projet *est* le club.
- **User (Firebase Auth)** — un projet, un user. `/users/{uid}` mirror avec rôles (`admin`, `coach` ; futur `player`, `official`).
- **Member** — item de gestion (pas forcément un user). Types : `player`, `official`, `coach`, `referee` (array de rôles).
- **Official** — Member avec `officialLevel` (1 ou 2, extensible). A toujours un compte Auth.
- **Venue / Court / Time Slot** — courts physiques + slots récurrents hebdo. `courtSize` (`small`/`normal`/`large`) **sans hiérarchie**. Courts combinés bloquent plusieurs courts physiques.
- **Season** — `draft` → `active` → `archived`. L'activation déclenche la génération des bookings.
- **Booking** — instance concrète d'un slot à une date. `scheduled` | `cancelled` | `freed`. `actionLog` append-only.
- **MatchType** — type de compétition (CSJC, AFBB, Amical…). Définit `requiredCourtSize`, `homeOfficialRequirements`, `awayOfficialCount`, `color`, `active`. CRUD admin dans Settings → Saison / Compétition → Match types. Suppression refusée si au moins un booking le référence (désactiver via `active: false` à la place).
- **Team** — persiste cross-saisons via `activeSeasonIds[]`. `schedulingConstraints` + `duesAmount` (CHF par joueur/an). Référence une `Category` (`categoryId`).
- **Category** — référentiel club (U11, U14, Seniors, Loisirs…). Éditable par l'admin (Settings → Catégories). Porte `name`, `minAge`, `maxAge`, `displayOrder`, `active`. Cf. `firebase.md` (`/categories`).
- **Closure Period** — manuelle, réutilisable.
- **Dues** — cotisation joueur/saison. Lifecycle géré par Functions.
- **Payment Exception Request** — coach demande override d'exclusion ; admin valide.
- **License Request** — coach (mobile) demande licence joueur ; admin valide.
- **License Type** — référentiel grille tarifaire (rôle × niveau, prix courant). Cf. section "Licences" ci-dessous.
- **Attendance / Match Requests / Notifications / Official Assignments** — voir `firebase.md`.

## Root admin — deux niveaux

| Niveau | Identité | Scope |
|---|---|---|
| **Per-project root admin** | Custom claim `rootAdmin: true` sur un user Auth du projet client | Bypass toutes les rules dans **ce projet**. Créé au provisioning. 1-2 par projet max. |
| **Editor global root** | Identité Google Cloud IAM (service account ou compte éditeur) | Accès à **tous** les projets clients via IAM. Sert au support, migrations, déploiements. Ne se connecte jamais à l'app cliente normale. |

Le `superAdmin` claim de l'ancienne version est **remplacé** par `rootAdmin`.

## Admin invitation flow

Pour ajouter un nouvel admin à un club existant. **Pas d'auto-inscription** : le modèle multi-tenant impose que tous les comptes soient explicitement invités par un admin existant.

### Lifecycle

1. **Admin invite** (Settings → Admin team) : entre l'email du futur admin → crée `/invitations/{inviteId}` avec `{ email, role: 'admin', invitedBy, invitedByName, createdAt }`. Aucun email envoyé pour le MVP — l'admin partage manuellement le lien de l'app avec l'invité.
2. **Invité signe in** via OAuth (Google ou Apple) avec **exactement** l'email indiqué.
3. **Auth flow détecte l'orphelin** (`/users/{uid}` absent) → appelle automatiquement la callable `acceptInvitation` (Admin SDK) qui :
   - Lookup `/invitations` par email du caller (token Auth)
   - Crée `/users/{uid}` à partir de l'invitation (`roles: ['admin']`, email, displayName, photoURL hérités du compte OAuth)
   - Supprime le doc d'invitation
4. **Force-refresh du token** côté client → l'invité atterrit sur le dashboard avec le rôle admin.

### Cas d'erreur

- Pas d'invitation pour cet email → `acceptInvitation` retourne `not-found` → l'auth flow throw `NotAuthorizedError` (sign-out + écran "compte non autorisé"). Comportement deny-orphan préservé.
- L'invité signe in avec un autre email que celui invité → même résultat (pas de match dans `/invitations`).
- L'invité a déjà un `/users/{uid}` → callable retourne `already-exists` (rare, défense en profondeur).

### Annulation

Un admin peut révoquer une invitation pending depuis Settings → Admin team (bouton "Annuler" sur la ligne invitation) → suppression du doc `/invitations/{id}`. L'invité ne pourra plus signer in.

### Limites MVP

- Pas d'envoi d'email automatique (à wired plus tard, soit via Function `onCreate /invitations` soit via SendGrid/Resend trigger).
- Pas de `expiresAt` — les invitations restent valides indéfiniment tant qu'un admin ne les annule pas.
- Le rôle est figé à `'admin'`. Pour inviter un coach/officiel, il faudra étendre le formulaire (le schéma `/invitations.role` est déjà extensible).

### Bootstrap du tout premier rootAdmin

Le flow d'invitation suppose un admin existant pour inviter. Pour le **tout premier** admin d'un nouveau projet (chicken-and-egg), utiliser le script local `functions/scripts/setRootAdmin.ts` (cf. `functions/CLAUDE.md`) qui crée à la fois `/users/{uid}` ET le claim `rootAdmin: true` via Admin SDK.

## Catégories d'équipes

Référentiel éditable par l'admin (Settings → Catégories). Schéma : voir `firebase.md` (`/categories`).

### Lifecycle

1. **Création** — admin crée une catégorie depuis Settings : `name` (libellé affiché), `minAge` / `maxAge` (nullable pour les catégories ouvertes type Seniors), `displayOrder`. `active: true` par défaut.
2. **Sélection à la création/édition d'équipe** — le dialog "Nouvelle équipe" et le mode édition du drawer Team listent les catégories `active: true` via un Select, trié par `displayOrder` puis `minAge`. Le champ `team.categoryId` stocke la référence.
3. **Rename** — admin renomme une catégorie : `team.category*` (libellé d'affichage et tranche d'âge) reflète automatiquement le changement sur toutes les équipes (référence, pas dénormalisation).
4. **Archive** — admin toggle `active: false` : la catégorie disparaît des pickers de création/édition, mais les équipes existantes conservent leur `categoryId` et restent affichables.
5. **Suppression** — **interdite par convention** tant qu'au moins une équipe la référence. Le bouton "Supprimer" dans Settings est désactivé avec tooltip explicatif si `count(teams where categoryId == this) > 0`. Sinon `deleteDoc` autorisé. En pratique, on encourage l'archive plutôt que la suppression.

### Cas d'erreur

- Catégorie référencée par une équipe mais introuvable (`/categories/{id}` absent) → la team apparaît avec libellé fallback `"Catégorie inconnue"` et `ageRange: null`. Cas pathologique (suppression directe en console Firestore). Pas de log particulier.
- Pas de catégories actives au moment de créer une équipe → le dialog "Nouvelle équipe" affiche un état vide avec CTA "Créer une catégorie" → ouvre Settings → Catégories.

### Migration depuis la heuristique locale

Avant le référentiel, `apps/web/src/repositories/teams.repo.ts` portait `CATEGORY_AGE_RANGES` (U11..U20 + Seniors) en dur. Pour les projets existants :
- One-shot script (à écrire) qui scanne `/teams`, dédup les `category` (string) rencontrées, crée un `/categories/{id}` pour chacune (avec age range pris dans la table dure si match, sinon `null,null`), puis migre `team.category: string` → `team.categoryId: string`.
- Tant que le script n'est pas exécuté, le code peut tolérer les deux formes (`category` legacy ET `categoryId` nouveau) pendant la transition.

## Tags d'équipes

Référentiel éditable par l'admin (Settings → Tags). Schéma : voir `firebase.md` (`/tags`).

Sert à **différencier visuellement des équipes similaires** : deux U14M (groupe A vs B), versions "Compet" vs "Loisir" d'une même catégorie, équipes "Élite", etc. Orthogonal à la catégorie : `tag` ne remplace pas `categoryId`, il l'enrichit.

### Lifecycle

1. **Création** — admin crée un tag depuis Settings : `name` (libellé court), `color` (palette 6 variants : emerald, sky, amber, rose, violet, slate), `displayOrder`. `active: true` par défaut.
2. **Sélection à la création/édition d'équipe** — le dialog "Nouvelle équipe" et le mode édition du drawer Team listent les tags `active: true` (multi-select). Pour chaque tag sélectionné, l'admin coche aussi **"afficher"** (flag `display` par-équipe). Le champ `team.tags` stocke `[{ tagId, display }]`.
3. **Display flag par-équipe** — `display: true` = chip visible sur la carte / listes ; `display: false` = tag attaché mais invisible côté UI (futur : filtres internes, exports, scheduling). Permet d'utiliser un tag à des fins admin sans polluer l'affichage public d'une équipe.
4. **Rename / recolor** — admin renomme / recolorise un tag : la modif se reflète automatiquement sur toutes les équipes (référence, pas dénormalisation).
5. **Archive** — admin toggle `active: false` : le tag disparaît du picker mais reste résolvable sur les équipes existantes.
6. **Suppression** — refusée tant qu'au moins une équipe référence le tag (le bouton "Supprimer" est désactivé avec tooltip). Sinon `deleteDoc` autorisé. En pratique, on encourage l'archive.

### Cas d'erreur

- Tag référencé mais introuvable (`/tags/{id}` absent) → la team garde la référence mais le repo l'ignore au moment de matérialiser les chips (fallback silencieux). Cas pathologique (suppression directe en console).
- Pas de tags actifs au moment de créer une équipe → la section "Tags" du dialog reste vide avec lien "Créer un tag" → Settings → Tags. Optionnel : pas de validation requise.

### Palette de couleurs

Bornée aux 6 variants du composant `Pill` (cf. `apps/web/src/components/ui/Pill.vue`) — `emerald | sky | amber | rose | violet | slate`. Pas de hex libre pour préserver la cohérence design system. Une couleur peut être utilisée par plusieurs tags (pas de contrainte d'unicité).

## Cotisations

Référentiel éditable par l'admin (Settings → Cotisations). Schéma : voir `firebase.md` (`/cotisations`).

Sert à **standardiser les montants** annuels appliqués aux équipes. Une équipe **référence** une cotisation (`team.cotisationId`) — pas de montant libre côté équipe, le prix vient du référentiel. Permet de renommer / repricer une cotisation à un seul endroit (les équipes reflètent automatiquement la modif).

**Garantie 14 jours max** — quand une cotisation naît suite au flux d'inscription (registration en `confirmed_pending_dues`), le compteur 14j court depuis `registration.trialStartedAt` (pas depuis la création du due). Le `due` est créé directement `status = 'issued'` avec `dueAt = trialStartedAt + 14j` et `emailedAt = now` (email demande de paiement envoyé immédiatement, pas via `issueDuesScheduled`). Garantit qu'un joueur ne peut pas faire plus de 14 jours d'essai sans avoir reçu une demande de paiement. Cas legacy (joueur ajouté à `team.playerIds` hors flux d'inscription) : path historique `pending_grace 21j → issued 14j` préservé. Cf. `docs/registrations/lifecycle.md` §9 et `docs/registrations/functions.md` §3.4.

### Lifecycle

1. **Création** — admin crée une cotisation depuis Settings : `name` (libellé court), `description` (texte libre), `price` (CHF/an/joueur). `active: true` par défaut, `displayOrder` auto-assigné en queue de liste.
2. **Sélection à la création/édition d'équipe** — le dialog "Nouvelle équipe" et le mode édition du drawer Team listent les cotisations `active: true` via un Select **obligatoire** (équipe sans cotisation = bloquée). Le champ `team.cotisationId` stocke la référence.
3. **Rename / reprice** — admin renomme ou modifie le prix d'une cotisation : la modif se reflète automatiquement sur toutes les équipes (référence, pas dénormalisation). **Important** : un changement de prix s'applique aux **nouveaux** dues émis (cf. Function `initiateDuesOnPlayerActivation`), pas rétroactivement aux dues déjà créés (le `due.amount` est figé à la création).
4. **Archive** — admin toggle `active: false` : la cotisation disparaît du picker mais reste résolvable sur les équipes existantes (qui conservent leur `cotisationId`).
5. **Suppression** — refusée tant qu'au moins une équipe référence la cotisation (le bouton "Supprimer" est désactivé avec tooltip explicatif). Sinon `deleteDoc` autorisé. En pratique, on encourage l'archive plutôt que la suppression.

### Cas d'erreur

- Cotisation référencée par une équipe mais introuvable (`/cotisations/{id}` absent, suppression directe en console Firestore) → la team garde la référence mais l'UI affiche `"Cotisation introuvable"` sur la card. Cas pathologique, pas de log particulier.
- Pas de cotisations actives au moment de créer une équipe → le dialog "Nouvelle équipe" affiche un état vide avec CTA "Créer une cotisation" → ouvre Settings → Cotisations.

## Mineurs, tuteurs & communications

Les **mineurs** (membres dont `birthDate < now - 18ans`) voient leurs communications — facturation et notifications générales — routées vers leurs **tuteurs** plutôt que vers eux-mêmes. À la majorité, un workflow de transition permet de basculer le routage vers le membre, avec consentement explicite. Schéma : voir `firebase.md` (`/members/{memberId}.comms`, `guardianUserIds`, `birthDate`).

### Définition mineur

- **Mineur** : `birthDate < now - 18ans`.
- **`birthDate == null`** : traité comme **adulte** pour les defaults. L'UI doit **avertir l'admin** que la date de naissance est absente (impact direct sur le routage des comms).
- La bascule majeur/mineur est dérivée à la lecture (pas dénormalisée sur le membre) ; seul `comms.majorityTransition` matérialise le passage en base.

### Rôle `parent`

Rôle **additif** sur `/users.roles`, cumulable avec `admin`, `coach`, `official` (cf. mémoire `project_roles_additifs`). Il n'ouvre **pas** d'accès admin : un parent voit uniquement ses **pupilles** — les membres liés via `member.guardianUserIds`.

### Rôle `secretary`

Rôle **additif staff** sur `/users.roles` (énum canonique `UserRole` dans `packages/shared-types/src/user.ts` : `admin | coach | official | parent | treasurer | secretary`). Le secrétaire **n'a pas** de droits admin généraux. Il peut notamment **confirmer une licence** via la callable `confirmLicense` — au même titre que `treasurer` / `admin` / `rootAdmin` (cf. section Licences). Comme tout rôle staff, un secrétaire n'est **jamais** suspendu par `callerSuspended()` (cf. `firebase.md` → Membre inactif).

### Lien tuteur ↔ pupille

`/members/{memberId}.guardianUserIds: string[]` est la **source de vérité** du lien. Conventions :

- Un user peut être tuteur de **N membres** (fratrie).
- Un membre peut avoir **0..N tuteurs** (parents séparés, tuteur légal multiple, etc.).
- `firestore.rules` étend la lecture du membre + de la sub `/members/{id}/private/contact` aux UIDs présents dans `guardianUserIds` (cf. `firebase.md`).

### Lien membre ↔ compte d'inscription (`linkedUserId`)

Distinct du lien tuteur : `member.linkedUserId` (et son miroir `user.memberId`) lie un membre à **son propre** compte Firebase Auth (typiquement créé via `apps/courtbase-register` pour un joueur majeur, ou attribué par un admin pour donner accès self-service à un coach/joueur existant).

- **Source de vérité bidirectionnelle** : `member.linkedUserId` ↔ `user.memberId`. Les deux champs doivent rester en sync (un seul user lié par membre, un seul membre lié par user).
- **Atomicité** : toute liaison/déliaison passe par `setLinkedUser(memberId, uid | null)` côté repo `apps/web/src/repositories/members.repo.ts` — `writeBatch` qui écrit les deux côtés en une seule transaction et nettoie les éventuels orphelins (ancien `linkedUserId` côté member, ancien `memberId` côté user).
- **UI admin** : page détail membre → card "Compte Firebase Auth" → bouton "Lier un compte" (ouvre `ManageLinkedUserDialog`, recherche par email, validations qu'on ne lie pas un tuteur ni le compte déjà lié).
- **Rules** : `/members.linkedUserId` est admin-write (rule globale `/members` write admin-only). `/users.memberId` est admin-write également (la rule self-update exclut explicitement ce champ). Pas de chemin client pour s'auto-attribuer un member.
- **Affichage enrichi** : la card "Compte Firebase Auth" expose `displayName`, `email`, `phone`, `address` (formatée), rôles auth et état du profil (Pill "Profil complété" / "Profil incomplet" basé sur `profileCompletedAt`).

### Defaults comms par âge

Calculés à la création du membre (`createMember`) depuis `isMinor(birthDate)` :

| Âge | `billingRecipients` | `generalRecipients` |
|---|---|---|
| Mineur | `['guardians']` | `['guardians']` |
| Majeur | `['member']` | `['member']` |

`billingRecipients` = factures et notifications de cotisations. `generalRecipients` = comms générales (assignations, planning, rappels, etc.).

### Surcharges autorisées

| Rôle | `billingRecipients` | `generalRecipients` |
|---|---|---|
| `admin` | tout (ajouter, retirer, remplacer) | tout |
| `coach` d'une équipe du membre | aucun droit | peut ajouter `'member'` au tableau (utile pour qu'un mineur d'une équipe reçoive les comms générales en plus de ses tuteurs). Pas de droit de retirer `'guardians'`. |

Toute autre écriture est refusée par les rules.

### Transition à la majorité

State machine portée par `member.comms.majorityTransition` (`null` tant que le membre n'a pas eu 18 ans). Trois étapes + résolution :

1. **Détection (Cloud Function scheduled)** — `onMajorityReached` détecte les membres avec `birthDate + 18ans <= now` ET `majorityTransition == null`. Pour chaque match :
   - Set `majorityTransition.triggeredAt = now`.
   - Bascule **immédiate** `comms.billingRecipients = ['member']` (la facturation suit le majeur, indépendamment du flow de consentement).
   - Écrit un mail aux guardians dans `/pendingEmails` (doc ID `{memberId}_majority_guardian_notify`).
2. **Réponse guardian** — un tuteur répond via callable `respondGuardianConsent` → set `majorityTransition.guardiansResponse: { answer, respondedAt, respondedByUid }`.
   - `answer: 'no'` → `comms.generalRecipients = ['member']`, `majorityTransition.resolvedAt = now`. **Fin du flow.**
   - `answer: 'yes'` → écrit un mail au membre dans `/pendingEmails` (doc ID `{memberId}_majority_member_confirm`). Attente de l'étape 3.
3. **Confirmation membre** — le membre répond via callable `respondMemberConsent` → set `majorityTransition.memberResponse`, applique :
   - `answer: 'yes'` → `comms.generalRecipients = ['member', 'guardians']` (le membre confirme garder les tuteurs en copie).
   - `answer: 'no'` → `comms.generalRecipients = ['member']`.
   - Dans les deux cas : `majorityTransition.resolvedAt = now`. **Fin du flow.**

Tant que `resolvedAt == null` : les defaults mineurs (`generalRecipients = ['guardians']`) restent appliqués pour les comms générales. Seul `billingRecipients` bascule dès `triggeredAt`.

### Invitation parent (hors scope v1)

Pour l'instant on **suppose que les tuteurs ont déjà un compte** Auth dans le projet. L'admin ajoute un tuteur à un membre via l'UI "Ajouter un tuteur" (recherche par email parmi les `/users` existants — `ManageGuardiansDialog.vue`).

Deux chemins peuvent alimenter `/users` :
1. **Self-registration via `apps/courtbase-register`** : un parent crée son compte via OAuth/email, complète son profil (`phone`, `address`), puis soumet une registration "pour un enfant". La callable `submitRegistration` ajoute `'parent'` à `user.roles` et — quand le coach valide la registration — lie le user au membre nouvellement créé via `guardianUserIds[]`.
2. **Admin-driven** (cas existant) : l'admin recherche dans `/users` un compte déjà créé (typiquement parent d'un autre enfant déjà inscrit) et l'attache via `addGuardian()`.

Prochaine itération : étendre `/invitations` pour supporter `role: 'parent'` — un admin enverra une invitation par email à un parent encore non-inscrit, puis lors du sign-in OAuth, `acceptInvitation` créera `/users/{uid}` avec `roles: ['parent']` et liera le user au membre cible. Cf. `admin_invitation_flow` (mémoire) pour le pattern.

## Inscriptions

**Portail public** séparé (`apps/courtbase-register`, hosting target distinct du même projet Firebase) où parents et joueurs créent des `/registrations` que coachs et admins voient dans l'app web. Pas d'auto-inscription dans l'app admin — c'est par cette app dédiée que de nouveaux dossiers entrent dans le club. Schéma complet : voir `firebase.md` (`/registrations`, `/teams/{}/refusalLogs`, extensions `/teams`, `/members`, `/users`).

### Acteurs

- **Visiteur** → sign-up (Google / Apple / email).
- **User authentifié** → complète son profil (`phone`, `address`), crée des registrations pour lui-même (joueur majeur) ou pour un enfant/pupille (`relationship`).
- **Parent** : rôle additif sur `/users.roles`, ajouté par la callable `submitRegistration` quand une registration "pour un enfant" est soumise. Lie le user au membre via `member.guardianUserIds`.
- **Joueur majeur (self-registration)** : lié à un `/members/{id}` via `user.memberId` (et miroir `member.linkedUserId`) — pas de nouveau champ.

### Statut d'ouverture d'équipe

Pilote l'affichage du TeamPicker côté app register (`team.registrationStatus`) :

| Statut | Effet UI |
|---|---|
| `open` | Pill verte, sélectionnable, affiche `team.openHandbook`. |
| `conditional` | Pill ambre, sélectionnable, affiche `team.conditionalDescription` + critères. |
| `closed` | Pill rouge, grisée, non-sélectionnable. |

### Lifecycle d'une registration

```
draft → submitted → (open_pending_trial | conditional_pending_review → trial_in_progress → confirmed_pending_dues → active)
                  ↘ refused (terminal — auto-rerouting différé en Phase F)
```

Toutes les transitions post-`submitted` passent par callables (`markTrialInProgress`, `confirmRegistration`, `refuseRegistration`, `cancelRegistration`) ou par triggers serveur — pas d'écriture client directe sur le status. Le passage `confirmed_pending_dues → active` est **automatique** au paiement de la cotisation, posé par le trigger `transitionRegistrationOnDuePaid` (Firestore onUpdate sur `/dues/{id}` quand `status → 'paid'`). Détail produit complet + plan d'implémentation : `docs/chantier-registrations.md` ; détail des transitions : `docs/registrations/lifecycle.md`.

### Membre actif / inactif

Le flag `/members/{memberId}.active` (booléen, déjà au schéma) pilote l'accès du
compte lié à l'**app club** (web admin et future app mobile Flutter).

- **(a) Toggle admin** — l'admin bascule `member.active` depuis la fiche membre.
  La rule `write` de `/members` reste admin-only ; aucun autre rôle ne peut
  changer ce flag directement.
- **(b) `active === false` ⇒ accès app club coupé** — le compte Auth lié
  (`member.linkedUserId` ↔ `user.memberId`) perd l'accès aux données de l'app
  club. C'est **enforced dans `firestore.rules`** via le helper
  `callerSuspended()` : les collections app club (`/bookings`, `/matches`,
  `/venues`, `/notifications`, `/matchTypes`, `/roles`, `/licenseTypes`, etc.)
  rejettent la lecture pour un compte non-staff dont le membre lié est inactif.
  Les comptes staff (rootAdmin/admin/coach/treasurer) ne sont **jamais**
  suspendus. Partitionnement complet : `docs/firebase.md` → "Membre inactif —
  suspension de l'accès app club".
- **(c) Le portail `courtbase-register` reste accessible** — les collections
  dont dépend la réinscription (`/registrations`, `/config/club`, `/teams`,
  `/categories`, `/members` self, `/dues` self, `/users`, `/licenseRequests`)
  ne sont **pas** coupées. Un membre inactif peut donc se réinscrire.
- **(d) La réinscription réactive le membre** — la callable
  `confirmRegistration`, quand elle réutilise un membre existant (matched, cf.
  dédup stricte AVS ou nom+date de naissance), repose `active: true`. Si le
  membre était archivé (`status === 'archived'`), elle repose aussi
  `status: 'active'` et efface `archivedAt` / `archivedReason` /
  `archivedByUid`. C'est le seul mécanisme qui sort un compte de l'état
  suspendu — l'inscription validée rend l'accès app club.

`active` est **orthogonal** à `member.status` : un membre peut être inactif
(`active: false`) sans être archivé. L'archive est un état de cycle de vie
(refus d'inscription, départ) ; l'inactivité est l'interrupteur d'accès.

## Licences

Une licence fédérale est une **ressource payée, active pour une saison**, attachée à un membre pour un rôle donné (`player` / `official` / `coach` / `referee`). Chaque rôle a **N niveaux** (selon le niveau de pratique : J+S, Ligue A, C+, etc.).

Un membre qui a été licencié une fois conserve son **numéro de licence à vie** (`member.licenseNumber`), même si la licence n'est plus active.

### Phase 1 — Configuration (livré)

Référentiel `/licenseTypes` éditable par l'admin (Settings → Licences). Une entrée = un `(role, level, name, fee)`. Schéma : voir `firebase.md` (`/licenseTypes`).

**Règle rôle/niveau** : seuls `official`, `coach` et `referee` portent un niveau de licence (numérique, requis). Le rôle `player` a toujours `level: null` — ses différentes licences (Junior, Senior, …) sont distinguées par leur `name`. Validé côté store (`validateRoleLevel`).

**Unicité** : `(role, level)` enforced UI/store **uniquement pour les rôles avec niveau**. Pour les joueurs, plusieurs entrées sont autorisées et distinguées par le nom.

**Prix** : `fee` est le prix **courant**. La grille a évolué historiquement (deux augmentations en 2 ans). Pas de versioning par saison côté config — l'historique vivra dans les transactions comptables (snapshot du prix à l'émission).

**Ajout d'une nouvelle licence** (ex : ouverture de la Ligue A) : créer une entrée `/licenseTypes` à tout moment depuis Settings.

### Phase 2 — Niveaux + entité `/licenses` (partiellement livré)

#### Niveaux officiel / coach (qualifications)

`member.officialLevel` et `member.coachLevel` sont des **QUALIFICATIONS** : niveaux numériques `1..N` réglés **manuellement par l'admin** depuis la fiche membre. « Avoir un niveau » = « être formé pour ce rôle », ce qui est **indépendant** du fait d'être actif.

- `officialLevel` détermine quel `homeOfficialRequirements` (ventilé par niveau) le membre peut couvrir.
- Les deux champs valent `null` si le membre n'est pas qualifié pour le rôle.

#### Entité `/licenses/{id}` — officiel / coach ACTIF

Un doc `/licenses/{id}` est une **instance concrète** de licence fédérale, émise pour un **membre × saison × type de licence**. `level`, `licenseName`, `feeSnapshot` sont snapshottés depuis le `/licenseTypes` à la création. Schéma : voir `firebase.md` (`/licenses`).

**Définition « officiel/coach ACTIF »** : un membre est officiel (resp. coach) **actif** s'il a une licence `/licenses` `status:'active'` pour ce rôle et la **saison courante**. C'est distinct de la qualification (`officialLevel` / `coachLevel`) : on peut être qualifié sans licence active.

**Dérivation** : pour éviter une requête `/licenses` à chaque check, le membre porte une réf **dénormalisée** `member.officialLicense` / `member.coachLicense` (`ActiveLicenseRef`, posée par la callable `confirmLicense`, `null` sinon). Actif ⟺ `officialLicense != null` **et** `officialLicense.seasonId === <id de la saison active>`.

**Cycle de vie** `pending → active` :

1. `pending` — la licence est créée par l'**admin** depuis la fiche membre (write client direct).
2. `active` — une fois la licence confirmée par Swiss Basketball **et payée par le club**, elle passe en `active` via la callable **`confirmLicense`**, réservée aux rôles **treasurer / admin / secretary / rootAdmin**. La callable pose `confirmedAt` / `confirmedByUid` / `accountingEntryId`, met à jour la réf dénormalisée du membre, et **poste l'écriture comptable** de la charge de licence (cf. ci-dessous).
3. `cancelled` — terminal.

**Écriture comptable à la confirmation** : `confirmLicense` poste une écriture en partie double — **débit** du compte de charge « Licences fédérales », **crédit** du compte de trésorerie Banque, montant = `license.feeSnapshot`. `license.accountingEntryId` lie la licence à l'écriture. Le club paie la fédération (l'argent quitte la banque, une licence n'est confirmée qu'une fois déjà payée) → une **seule** écriture, pas de passage par le compte Créditeurs. Détail : `docs/compta.md`.

**Effet sur les droits d'accès app** : un officiel **sans licence officiel active** ne peut **pas s'auto-inscrire à un match** — `firestore.rules` gate la création d'un `officialAssignment` self-register sur `member.officialLicense != null` (le check saison-précis est porté côté UI/callable). Voir `firebase.md` → Security rules.

> **Reste hors scope (Phase 2 non terminée)** : le refactor de `member.licensed` / `officialLevel` en dérivés des licences actives (cf. `project_members_creation_roadmap`), et le rebranchement du workflow `/licenseRequests` (demande mobile coach → admin) sur la création d'une `/licenses` au lieu de flipper `member.licensed`. Aujourd'hui `member.licensed` reste maintenu en l'état.

### Workflow de demande de licence (coach → parent → coach review → trésorier)

Au-delà du toggle simple "demander licence" historique, le workflow étendu intercale une **complétion de dossier par le parent** + une **review coach doc-par-doc** entre la demande initiale et la validation finale. Workflow cible en **4 stages** :

```
(none)
  │ coach clique "Demander licence" (gate cotisation OK)         ← PR1 (livré 2026-05-23)
  ▼
pending_parent_docs
  │ parent uploade les documents + envoie                        ← courtbase-register
  ▼
parent_docs_submitted
  │ coach review doc par doc (accept / refuse per-doc)           ← PR2 (à venir)
  ▼
coach_validated
  │ trésorier/secrétaire/admin valide ou refuse                  ← PR3 (à venir)
  ▼
approved  /  rejected
```

1. **Stage 1 — Coach launch (PR1)** : le coach déclenche depuis l'app `courtbase-app`. Gate cotisation `duesStatus ∈ {paid, pending_grace, excepted}` + joueur non encore licencié (`member.licenseNumber` vide). Crée `/licenseRequests/{id}` (ID déterministe `lr-{memberId}-{seasonId}`, idempotent sur double-clic) en `pending_parent_docs` + un doc `/notifications` (type `license_documents_pending`) qui push le parent via FCM si device enregistré.
2. **Stage 2 — Parent upload** : le parent ouvre `courtbase-register` `/account/license-requests/{id}` et complète les documents requis (calculés par `inferRequiredDocs(member)`) : pièce d'identité recto/verso (passeport ou carte d'identité — pas de permis de conduire ni de permis de séjour), AVS si manquant, lettre de sortie si club précédent suisse, contexte transfert si club précédent étranger (procédure FIBA MAP gérée hors-plateforme par l'admin). Submit → `parent_docs_submitted`.
3. **Stage 3 — Coach review (PR2)** : le coach review chaque document dans `courtbase-app`, peut **refuser un doc spécifique** (per-doc `refusedBy` / `refusedReason` → la demande retourne à `pending_parent_docs`, seuls les docs refusés sont à re-uploader) ou valider l'ensemble → `coach_validated`.
4. **Stage 4 — Trésorier/secrétaire/admin (PR3)** : valide ou refuse depuis `apps/web` (vue dédiée `/license-requests`). La validation déclenche la création d'une `/licenses/{id}` `pending` que le trésorier confirme **ensuite séparément** via la callable existante `confirmLicense` (qui poste la charge comptable).

**Phase trésorier étendue (PR3-trésorier, fondation backend 2026-05-24)** : workflow `coach_validated → awaiting_parent_signature → parent_signed → form_confirmed → sent_paid → approved` matérialisant les étapes administratives fédérales (4 callables `treasurerUploadSignableDoc`, `treasurerConfirmSignedDoc`, `treasurerMarkSentAndPaid`, `treasurerFinalizeLicense` — auth `rootAdmin || treasurer` uniquement, **pas admin** standard, cohérent compta). À `sent_paid`, la `/licenses` est créée en `pending` et **utilisable par le coach en match** ; à `approved`, `confirmLicense` chaîné la passe en `active`, denorm membre + écriture comptable. Détail : `docs/licenses/parent-completion-workflow.md` §"Phase trésorier".

Détail complet : [`docs/licenses/parent-completion-workflow.md`](licenses/parent-completion-workflow.md). Schéma `/licenseRequests` : [`docs/firebase.md`](firebase.md) § `/licenseRequests`.

**Photo licence membre** (feature 2026-05-24) : un membre doit avoir une photo (format passeport) avant que le coach puisse valider l'ensemble des documents (transition `parent_docs_submitted → coach_validated`). Upload par le coach (caméra mobile ou fichier) depuis la fiche membre, réutilisée par le trésorier/admin lors de la création de la licence fédérale. Brief : [`docs/members/license-photo.md`](members/license-photo.md). Champs `/members.photoStoragePath` / `photoUpdatedAt` / `photoUpdatedByUid`.

### Distinction avec les concepts voisins

- **`/licenseRequests`** = workflow de demande mobile (coach demande à l'admin). Orthogonal à `/licenseTypes`. Voir section "License requests" plus bas.
- **`config/club.officialsConfig.licenseFee`** (140 CHF flat) = legacy, héritage de l'époque où seul "officiel" avait une licence à 140 CHF. Sera supprimé une fois la création de licence active (les indicateurs de rentabilité officiels utiliseront la grille `/licenseTypes`).

## Comptabilité

Module de **comptabilité du club en partie double**. Détail complet, schéma et flux : voir `docs/compta.md`.

- **Accès restreint** : rôle `treasurer` + claim `rootAdmin` uniquement. L'`admin` standard est **exclu** du module, y compris au niveau `firestore.rules`.
- **Partie double** : chaque opération est une **écriture équilibrée** (`Σ débit === Σ crédit`, au moins 2 lignes). `/accountingEntries` est append-only — l'annulation d'une écriture passe par une **contre-passation** (écriture inverse), jamais par suppression.
- **Restitutions** : **bilan** (actif vs passif + résultat de l'exercice), **compte de résultat** (charges vs produits), **journal** (liste chronologique des écritures).
- **Plan comptable paramétrable** (`/accounts`) : comptes éditables par le trésorier, plus un jeu de **comptes par défaut** seedés (Caisse, Banque, Cotisations, Sponsoring, Subventions J+S, charges…). Les comptes de trésorerie servent de contrepartie automatique dans la saisie simplifiée.
- **Saisie de crédits** : entrées d'argent (cash, sponsoring, subventions J+S) — crédit d'un compte de produit, contrepartie débit sur un compte de trésorerie.
- **Factures fournisseurs** (`/invoices`) : import manuel en v1 (OCR différé, champs réservés). Comptabilisation = débit d'un compte de charge / crédit du compte Créditeurs ; règlement = débit Créditeurs / crédit trésorerie.

## Intégrations externes

### Basketplan (Swiss Basketball / ORCA Systems)

Intégration read-only avec la plateforme fédérale officielle. Brief technique : `docs/basketplan-integration.md`. Plan d'exécution : `docs/chantier-basketplan.md`.

- **Mapping (PR 1, livré)** : admin et coachs lient chaque équipe court-base à **N compétitions Basketplan** (champ `team.basketplanLinks[]`) via une cascade 3 étapes (fédération → ligue → équipe). Plusieurs liens possibles par équipe (championnat + coupes, potentiellement plusieurs fédérations en parallèle). Activation/désactivation par lien sans suppression. Settings global `/config/club.basketplan = { clubId, defaultFederationId, enabled, lastSyncAt?, lastSyncError? }`.
- **Scope autorisations** : `linkTeamToBasketplan`, `unlinkTeamBasketplan`, `toggleTeamBasketplanLink`, `syncBasketplanForTeam` ouvertes à `admin OR coach-of-team`. Settings + `testBasketplanConnection` réservés admin.
- **Sync auto (PR 2, livré)** : cron `scheduledBasketplanSync` quotidien à 03:00 Europe/Zurich qui (a) **crée les matchs AWAY** dans `/matches` quand notre équipe joue à l'extérieur, (b) **backfill** `externalReferees`, `externalResult` (score par quart + total + flag `homologated`), `externalLastSyncedAt` sur les matchs existants matchés par `externalGameNumber`, (c) **link les matchs manuels** créés à la main par admin/coach via fuzzy match Levenshtein ≤ 2 sur l'opposant + fenêtre ±24h sur la date, (d) **passe `status: 'played'`** quand l'état Basketplan est `homologué`. Affichage enrichi dans la page web `/matches` (badge `Basketplan #<gameNumber>`, sections "Arbitres fédéraux", "Résultat officiel" avec score + tableau quarts). CTA admin "Synchroniser maintenant" disponible dans Settings → Intégrations → Basketplan pour déclencher un sync à la demande sur une équipe précise.
- **Création HOME + Inbox admin (PR 3, à venir)** : pour les matchs HOME, le sync tentera la création automatique du booking + match si une salle/court matche le `location` Basketplan ; sinon item dans `/basketplanInbox` à valider par l'admin.
- **Pas de publication vers Basketplan** : API publique read-only seulement.

## Venues & courts

Le club gère **plusieurs salles** (`/venues`). Une salle contient **plusieurs courts physiques** (`/venues/{id}/courts`). Schéma complet : voir `firebase.md`.

### Courts physiques vs courts combinés

`courtSize` (`small` | `normal` | `large`) **n'a pas de hiérarchie** — un match qui requiert `large` n'est pas planifiable sur un `normal` ou `small`. C'est une étiquette plate qui décrit la taille du terrain (pas un ordre).

Un court peut être **physique** (`isCombined: false`) ou **combiné** (`isCombined: true`). Un court combiné est un terrain logique qui **occupe physiquement plusieurs courts adjacents** lors d'une réservation — typiquement quand on retire la cloison pour libérer un terrain pleine longueur. Quand on réserve un court combiné, le booking generator crée **N bookings liés** (`linkedBookingIds` + `isCombinedCourtEvent: true`, cf. `firebase.md → /bookings`).

### Trois cas canoniques

| Cas | Configuration | Exemple |
|---|---|---|
| **Combiné classique** | `large, isCombined:true, combinedCourtIds:[T1,T2,T3]` | Salle Marly Grand-Pré : 3 terrains normaux + 1 grand qui occupe les 3 |
| **Combiné de tailles diverses** | `normal, isCombined:true, combinedCourtIds:[S1,S2]` | 2 petits courts → 1 normal en retirant la cloison |
| **Standalone large** | `large, isCombined:false, combinedCourtIds:[]` | Halle conçue avec un seul terrain pleine longueur, pas de subdivision |

### Invariants (enforced UI Venues.vue)

1. **Same venue only.** `combinedCourtIds` ne référence que des courts de la même salle. Physiquement un match indoor ne s'étale pas sur deux bâtiments. Pas de support cross-venue.
2. **Pas de chaîne.** Un combiné ne peut **pas** inclure un autre combiné. Le picker UI filtre `!c.isCombined`. Évite la récursion ambiguë A→B→C pour le booking generator.
3. **Non-vide si combiné.** `isCombined: true` exige `combinedCourtIds.length > 0`. Sinon le générateur ne sait pas quoi bloquer → erreur de validation "Sélectionnez au moins un court à combiner".
4. **Self-exclusion.** Un court ne se combine pas avec lui-même (filtré en mode édition).
5. **Toggle off → clear.** Désactiver `isCombined` vide automatiquement `combinedCourtIds` (pas de state stale).

### Custom closures vs closure periods

Une salle porte aussi des **fermetures ponctuelles** (`customClosures` array inline : travaux, événement privé) — vivent sur le venue, pas réutilisables. À distinguer des **closure periods** (`/closurePeriods`) qui sont des fermetures cross-saisons partagées (vacances scolaires). Le venue référence ces dernières via `closurePeriodIds: string[]`.

### Pas de cascade delete (limitation MVP)

`deleteVenue()` **ne purge pas** les sous-collections `courts` ni `timeSlots`. Les docs orphelins restent en Firestore. Acceptable au MVP (l'admin supprime rarement une salle). À déléguer à une Cloud Function `onDelete /venues/{id}` plus tard pour les projets prod.

## Règles métier — synthèse

### Slot types
- `match_home` → suspend les `training` de la même équipe ce jour-là ; trigger l'assignation officiels. Un booking `match_home` porte `opponentName` (équipe adverse, optionnel) + `matchTypeId` (obligatoire).
- `match_away` → libère les `training` de l'équipe ce jour-là. Porte `opponentName` (obligatoire) + `awayAddress` (adresse du gymnase extérieur, obligatoire) + `matchTypeId`. `venueId`/`courtId` valent `''` (le match n'occupe pas de court interne).
- `reserve` → libéré en premier en cas de conflit ; réservable ad-hoc par un coach.
- `custom` → label seulement.

### Bookings
- Générés automatiquement à l'activation de saison (hors closure periods).
- **Jamais supprimés** : cancel = `status: "cancelled"`.
- Ajout closure post-génération → cascading cancellation via Function.
- Toutes les actions coach loggées dans `booking.actionLog` (append-only).

### Réservations manuelles

L'admin peut créer une réservation manuelle depuis `/bookings` (bouton "+ Nouvelle réservation"), en complément de la génération automatique à partir des `timeSlots`. Pattern d'édition Outlook-style (occurrence / futures / toute la série).

Schéma : voir `docs/firebase.md` (sections `/bookingSeries` + champs `seriesId` / `originalDate` / `isManual` sur `/bookings`).

#### Création
- **One-shot** ou **récurrente** (toggle "Réservation récurrente").
- Récurrence MVP : `weekly` (jour fixe dérivé de la date de début) ou `monthly` (`dayOfMonth` = même quantième, OU `nthWeekday` = même Nème jour de semaine). `interval = 1` toujours.
- **Date de fin obligatoire** (pas de séries infinies).
- Checkbox **"Considérer les fermetures de la salle" cochée par défaut** : les occurrences tombant pendant une closure du venue (`/closurePeriods` rattachés + `venue.customClosures` inline) sont **skippées à la création** — pas créées en `cancelled`, simplement omises.
- **Validation conflits** : un booking `scheduled` existant qui chevauche (sur le même court + date) bloque la création. L'admin doit changer court/heure/date. Preview live dans le wizard ("X créées · Y skippées fermeture · Z conflits").
- One-shot manuel : `seriesId = null`, `isManual = true`, pas de doc `/bookingSeries`.
- Série : `addDoc('/bookingSeries')` + `writeBatch` chunké à 500 sur `/bookings` (un par occurrence retenue), chaque booking porte `seriesId` et `originalDate`.

#### Édition — 3 scopes (modèle Outlook)
- **Cette occurrence uniquement** (`occurrence`) — override : update du seul booking, sa `date`/heure peut diverger de `originalDate`.
- **Cette occurrence et les suivantes** (`future`) — update tous les bookings de la série dont `date >= booking.date`, et update le doc `/bookingSeries` (réécrit `startDate` à la date courante). Pas de split en deux séries au MVP.
- **Toute la série** (`all`) — update tous les bookings + `/bookingSeries`.

Si le booking n'a pas de `seriesId` (one-shot manuel ou auto-généré sans série), seul `occurrence` est exposé.

#### Garde-fou occurrences passées
- Les bookings dont `date < startOfToday()` sont **immuables** sur `date`, `startTime`, `endTime`, `courtId`.
- Sur scope `occurrence`, l'édition throw si on tente de modifier ces 4 champs.
- Sur scope `future` / `all`, le repo **skip silencieusement** les bookings passés pour ces 4 champs ; les autres champs (`notes`, `teamId`, `status`, `cancelReason`) restent appliqués (utile pour rétro-saisie / annulation).
- Le picker de scope (`BookingEditScopeDialog`) affiche un avertissement rose si la date sélectionnée est passée.

#### Annulation & suppression
- "Annuler le créneau" → `status: 'cancelled'`, `cancelReason: 'manual'` (ou `'series_edit'` si déclenché par un edit `future`/`all` qui retire des occurrences).
- "Supprimer" : alias d'annulation pour le MVP (les bookings passés ne sont jamais supprimés physiquement, append-only). Le doc `/bookingSeries` est conservé tant qu'au moins un booking de la série existe.

#### Audit
- Toute mutation manuelle ajoute une entrée `actionLog` : `manual_create` à la création, `manual_edit` / `manual_cancel` aux mises à jour. `note` porte le scope (`occurrence`/`future`/`all`).

#### Permissions
- Création, édition, suppression : **admin / rootAdmin uniquement** (`/bookingSeries` rules + le path `/bookings` reste admin-only à la création). Le coach garde uniquement les droits déjà définis (`cancel` sur ses propres trainings, `matchRequest` pour move home).

#### Limites MVP
- Picker `teamId` non branché dans le wizard (Select disabled, défaut `null`).
- Picker `matchTypeId` non branché (toujours `null`).
- Combined courts non supportés pour les réservations manuelles (`linkedBookingIds: []`, `isCombinedCourtEvent: false`).
- `createBookingSeries` n'est pas transactionnel doc-série + bookings : si un chunk plante mid-batch, le doc `/bookingSeries` reste avec moins d'occurrences que prévu. À monter en Cloud Function transactionnelle si nécessaire (cf. pattern `generateSeasonBookings`).
- `future` n'effectue pas de split en deux séries — update en place.

### Matches (page `/matches`)

Page de gestion des matchs. Refonte 2026-05-15 : un match est désormais une **entité dédiée** dans la collection racine `/matches/{matchId}` (cf. `firebase.md` § `/matches`). Pour les matchs à domicile, un booking `slotType: 'match_home'` reste créé en parallèle (pour bloquer le court) et porte un `matchId` qui pointe vers le doc match — référence **bidirectionnelle** synchronisée via `writeBatch` atomique.

#### Création

L'admin crée un match depuis `/matches` (bouton "+ Nouveau match"). Deux flows :

- **À domicile** : workflow en deux temps.
  1. **Pré-réserver** un créneau via `/bookings` : créer un booking `slotType: 'match_home'` (typiquement 3h le soir), optionnellement avec `teamId` fixé. Tant qu'aucun match n'y est attaché, le booking reste `matchId === null` ET `matchTypeId === null` ("pending", rendu en orange dans le calendrier).
  2. **Assigner** depuis `/matches` : le picker liste les bookings match_home pending. Cliquer en sélectionne un, le formulaire demande le type de match + adversaire. Submit déclenche `createHomeMatch` qui exécute un `writeBatch` atomique : `addDoc /matches` + `updateDoc /bookings/{id}` (set `matchId`, `matchTypeId`, `opponentName`). Puis libère les trainings conflictuels best-effort.

- **À l'extérieur** : `createAwayMatch` crée un doc `/matches` seul (`bookingId: null`), avec date + heure de début + adresse + durée fixe 3h. Pas de booking côté away (le club ne réserve pas de court). Libère les trainings conflictuels best-effort.

Champs requis dans les deux cas : `teamId` (équipe locale), `matchTypeId`. `opponentName` obligatoire pour Away, optionnel pour Home.

#### Auto-libération des entraînements conflictuels

À la création d'un match (home OU away) pour une équipe X, tout booking `training` ou `reserve` (status `scheduled`) de l'équipe X dont le créneau chevauche [startTime, endTime) le même jour passe automatiquement en `status: 'freed'` avec `cancelReason = 'match_home'` ou `'match_away'`. Le créneau libéré reste réservable par un autre. Logique implémentée côté repo (`freeConflictingTrainings`), best-effort (si le free trainings plante, le match reste créé — l'admin doit re-trigger manuellement).

À distinguer du trigger Cloud Function `handleMatchSlotChange` qui gère le même cas mais pour les transitions de **timeSlots récurrents** (changement de slotType sur le template) — les deux paths sont nécessaires car le match créé via `/matches` n'a pas de timeSlot associé (`timeSlotId = ''`, one-shot manuel).

#### Édition / suppression

- **Suppression** depuis `/matches` (drawer du match) : `deleteMatch` exécute un `writeBatch` symétrique. Pour HOME : `delete /matches/{id}` + clear `matchId`/`matchTypeId`/`opponentName` sur le booking lié — le booking redevient pending et peut être réutilisé. Pour AWAY : simple `deleteDoc`.
- **Édition** : pas de wizard d'édition côté `/matches` au MVP. Pour modifier date/court d'un match home, l'admin passe par `/bookings` (déplacer/modifier le booking, le `matchId` reste lié).

#### Permissions

Lecture : `admin` + `coach` (les coachs voient les matchs de leurs équipes, mais le scope n'est pas encore filtré — MVP : tous les matchs visibles à admin/coach). Création : admin uniquement (rules `/bookings` admin-only).

### Coach booking
- Reserve ad-hoc un slot `freed`/`reserve` pour son équipe → **direct, pas de validation admin**.
- Cancel un `training` de son équipe → `freed`, direct.
- Move match vers away → direct. Move `match_home` → `matchRequest` (validation admin). `matchRequest` est **uniquement** pour déplacer un `match_home`, jamais pour des réservations ad-hoc.

### Officials
- `officialLevel` sur le Member = source de vérité. **Réglé manuellement par l'admin**, pas d'audit.
- Un membre peut être official + coach (rôles array).
- Un `match_home` porte ses `officialAssignment` sur son booking (`/bookings/{id}/officialAssignments`), staffé selon `MatchType.homeOfficialRequirements` (ventilé par niveau).
- Un `match_away` a aussi besoin d'officiels (`MatchType.awayOfficialCount`, total simple). N'ayant pas de booking, ses `officialAssignment` sont portés directement par le doc match (`/matches/{id}/officialAssignments`).
- Officiels **s'auto-inscrivent** (status `pending`) ou sont assignés par l'admin. Ils confirment/déclinent.
- Notifs auto :
  - `officials_needed` si un match (à domicile **ou** à l'extérieur) < 7 jours et pas full staff.
  - `match_reminder` à J-1 (23:00) et H-2 aux officiels confirmés.
- Export fin de saison des assignations par membre (les officiels sont payés).
- UI restreinte pour officiels : seulement leurs assignations et matches needing officials. Pas d'accès aux membres/teams/bookings non liés.

La gestion côté admin se fait sur la page web **`/officials`** (onglets "Assignations" + "Officiels", accès `admin` / `rootAdmin`) : staffing de **tous les matchs** (domicile **et** extérieur), assigner / override / retirer des `officialAssignments` (créés en `pending`), envoi de notifications manuelles, et export CSV de fin de saison. Détail UI : `frontend-desktop.md` → "Officials sur le web".

### Officials — indicateurs de rentabilité

Une licence coûte ≈ 140 CHF. Le club veut identifier les officiels "problématiques" (licence mais peu de matches).

Config (`config/club.officialsConfig`) :
- `licenseFee` (défaut 140 CHF)
- `thresholdGreen` (matches/saison "rentable", défaut 6)
- `thresholdOrange` (borne basse warning, défaut 3)

`<thresholdOrange` → rouge ; `[thresholdOrange, thresholdGreen-1]` → orange ; `≥ thresholdGreen` → vert. Éditable par l'admin, calculé client-side.

Ces indicateurs sont affichés dans l'onglet "Officiels" de la page web `/officials` (cf. `frontend-desktop.md`).

### Season planning assistant
- Optionnel pendant `draft`. Suggère la distribution.
- Hard constraints (bloquant) : match coach ailleurs ce jour, `maxStartTime` dépassé, court size mismatch.
- Soft (warning) : `preferredDays`, `minHoursBetweenSlots`, `trainingsPerWeek`.
- Match confirmé d'un coach un jour bloque ce coach pour **toutes** ses équipes ce jour. Les trainings ne bloquent pas.

### Notifications
- FCM push + in-app (badge + liste).
- Types : `new_match`, `officials_needed`, `urgent`, `match_reminder`.
- **Mécanisme push** : à la création d'un doc `/notifications`, le trigger `fanoutNotification` résout `targetAudience` → officiels concernés → tokens FCM de leurs appareils (`/users/{uid}/fcmTokens`) → push multicast. `pushedAt` garde l'idempotence. Vaut pour les notifs admin **et** auto (`autoOfficialsNeededNotification`, `matchReminders`).
- **Rappels match de l'officiel inscrit** (24h + 3h avant) : notifications **locales** planifiées sur l'appareil par l'app mobile à l'auto-inscription (précises, offline) — pas de Cloud Function. Annulées si l'officiel décline.

### Membres — création/édition coach (app mobile)

Sur mobile, un coach peut créer un joueur dans une de ses équipes, l'éditer et le désactiver/archiver. `/members` étant write-admin-only dans `firestore.rules`, ces mutations passent par des **callables** (`coachCreateMember`, `coachUpdateMember`, `coachDeactivateMember`) qui re-vérifient le scope coach côté serveur. Idem pour la création d'un match à l'extérieur (`coachCreateAwayMatch`). Cf. `docs/firebase.md` (section Cloud Functions) et `docs/mobile-app.md`.

### Rôles membre → rôles Auth

Les rôles d'un membre (`/members.roles`) **définissent** les rôles de son compte Auth (`/users.roles`, qui gatent les `firestore.rules` et l'accès app). La Function `syncUserRolesFromMember` recopie `member.roles` verbatim vers `/users/{linkedUserId}.roles` à chaque écriture du membre lié — la sync **écrase** intégralement (un rôle posé hors-membre sur `/users.roles` ne survit pas ; il doit figurer dans `member.roles`). Un membre délié → roles de l'ancien user remis à `[]`.

**6 rôles système** (référentiel `/roles`, non-supprimables) : `admin`, `treasurer`, `secretary`, `coach`, `official`, `player`. Leurs `id` sont les clés canoniques de `/users.roles`. Les autres rôles (`comite`, `referee`…) sont `custom`, éditables/supprimables.

### Attendance
- Par training, par coach de l'équipe. `present` | `absent` | `excused`.
- Ajout joueur inline : réactive si name/email match, sinon création.
- Export CSV/Excel fin de saison par équipe.

### Dues & exclusion

Cotisation annuelle joueur, montant **par équipe**. Lifecycle auto, paiement manuel.

**Lifecycle (par joueur, par saison) :**
1. **J0** — joueur ajouté à `team.playerIds` → `due` créé, `status: "pending_grace"`.
2. **J0 → J+21** (grace period configurable) — pas de paiement dû.
3. **J+21** — émission auto : `status: "issued"`, `dueAt = now() + paymentDueDays` (défaut 14j). Notif joueur + coach.
4. **J+35** — si impayé → `status: "overdue"`, `member.duesStatus = "excluded"`.
5. **Au prochain training** — UI montre exclu, le coach doit marquer absent/refusé (pas d'option "present").

**Flow exception coach :**
- Coach soumet `paymentExceptionRequest` avec motivation libre.
- Tant que `pending` → exclusion suspendue, badge "exception pending", peut train.
- Admin review (web) :
  - **Approve** avec nouvelles `issuedAt`/`dueAt` → exclusion levée, due mise à jour.
  - **Reject** avec commentaire → retour `excluded`.

Config (`config/club.duesConfig`) : `gracePeriodDays` (21), `paymentDueDays` (14). `amountByTeam` sur le team doc.

**Paiement** : manuel uniquement pour le pilote. Admin coche "paid", méthode (cash/transfer/…) et date.

### Cotisations — email "à payer", paiement, archive

Couche email + paiement manuel ajoutée à la couche dues existante (cf. `firebase.md` → `/dues`, `/pendingEmails`, `/users.roles` `treasurer`).

- **Email "à payer"** déclenché :
  - immédiatement à la création du due si celui-ci naît déjà `issued` — cas du **flux d'inscription** (registration `confirmed_pending_dues` → `initiateDuesOnPlayerActivation` résout `registeredByUid` + `trialStartedAt` → due émis directement `issued` avec `dueAt = trialStartedAt + 14j`, `emailedAt = now`), ou cas du `gracePeriodDays === 0`.
  - à la transition `pending_grace → issued` (cas legacy uniquement — joueur ajouté à `team.playerIds` hors flux d'inscription, `issueDuesScheduled` daily).
  - Idempotence garantie par `due.emailedAt` (non-null ⇒ déjà envoyé, on skip).
  - Destinataires : `member.comms.billingRecipients` (membre lui-même si majeur, tuteurs si mineur).
  - Doc émis dans `/pendingEmails` avec `templateKey = 'dues_payment_request'`, contexte incluant `amount`, `paymentReference`, `banking` snapshotté depuis `/config/club.banking`.
- **Marquer un due payé** : callable serveur `markDuePaid({ dueId, paidAmount, paymentMethod, paidAt? })`. Accessible aux rôles `admin` **ET** `treasurer` (cf. `project_roles_additifs`, rôles additifs). Pose `status='paid'`, `paidAt`, `paidAmount`, `paymentMethod`, `recordedBy = caller.uid`. Émet un doc `/pendingEmails` `dues_payment_confirmed` aux `billingRecipients`. Treasurer **n'a pas** d'écriture directe Firestore — la rule `/dues` reste serrée sur admin (filets de sécurité) + le canal callable garantit l'audit centralisé.

- **Activation automatique d'une inscription au paiement** : le trigger Firestore `transitionRegistrationOnDuePaid` (sur `/dues/{id}` update à `status='paid'`) cherche la registration `(matchedMemberId == memberId, teamId == teamId)`. Si elle est en `confirmed_pending_dues`, il passe la registration en `active`, append l'`actionLog` et repose `member.active = true`. Idempotent (skip si déjà `active`). Effet utilisateur : un parent qui paie depuis `apps/courtbase-register` n'a pas besoin d'attendre une intervention manuelle — l'inscription s'active automatiquement. Cf. `docs/registrations/functions.md` §3.4.

- **Arrangement comité (montant partiel)** : par défaut `markDuePaid` enregistre le montant intégral (`paidAmount = due.amount`). Un montant partiel (`paidAmount < due.amount`) ne peut être posé que par un **rootAdmin** (claim Auth) ou un **treasurer** (rôle `/users.roles`). Le callable rejette tout admin standard qui tenterait un partial en `permission-denied` (helper `assertCanRecordPartial` dans `markDuePaid.ts`). Cas d'usage : arrangement in extremis pour débloquer une licence rapidement quand un joueur ne peut pas payer immédiatement le plein tarif. Le manque à gagner (`amount - paidAmount`) n'est pas comptabilisé séparément — la cotisation est simplement marquée `paid` avec le montant réellement reçu.

- **Validation anticipée pendant grace period** : un due en `pending_grace` n'est normalement pas marquable — on attend la transition automatique `pending_grace → issued` à `J+gracePeriodDays`. **Exception comité** : rootAdmin / treasurer peuvent court-circuiter cette attente pour un paiement anticipé (typiquement couplé à l'arrangement custom amount ci-dessus). Côté UI, le bouton "Marquer payé" sur une ligne grace period n'est visible qu'au comité ; un admin standard ne le voit pas.

- **Parcours UI où valider un paiement** :
  - **Page `/cotisations` (liste globale)** : canal "quotidien" pour confirmer les paiements reçus. Le **montant est verrouillé** au tarif plein (`row.amount`) ; pas de champ saisissable. Pour un arrangement, il faut passer par la fiche membre.
  - **Page `/members/{id}` → tab Cotisations** : canal "arrangement". Le dialog "Marquer payé" expose en haut un switch "Cotisation payée intégralement" (ON par défaut), **visible uniquement aux rootAdmin / treasurer**. OFF → un champ "Montant versé" apparaît, capé à `due.amount`. Admin standard : le switch est masqué, le dialog reste figé sur le plein tarif (cohérent avec la liste globale).
- **Refus d'une registration → archive du member lié** : la callable `refuseRegistration` (Phase E du chantier inscriptions) consulte `registration.matchedMemberId` ; si présent **et** que le member a été créé via ce flow d'inscription (et non préexistant), elle pose `member.status = 'archived'`, `archivedAt`, `archivedReason` (motif du refus), `archivedByUid` (coach/admin). Cohérent avec le principe "pas de delete physique" (audit + reprise possible via `unarchiveMember` futur).

- **Réinscription → réactivation du member (`confirmRegistration`)** : quand `confirmRegistration` réutilise un **membre existant** (matched par dédup stricte AVS ou nom+date de naissance, cf. `project_member_dedup_on_confirm`), elle repose `member.active = true`. Si ce membre était archivé (`status === 'archived'`), elle repose aussi `status = 'active'` et efface `archivedAt` / `archivedReason` / `archivedByUid`. C'est le mécanisme qui sort un compte de l'état "suspendu" (cf. section "Membre actif / inactif") : un joueur parti, redevenu inactif, retrouve l'accès à l'app club une fois sa nouvelle inscription confirmée. La création d'un membre neuf n'est pas concernée (il naît `active: true`, `status: 'active'`).

Vue d'ensemble du déclenchement :

```
parent paie sur app register  ─┐
                                ├──► confirmRegistration callable
coach confirme essai           ─┘     │
                                      ▼
                            team.playerIds += memberId
                                      │
                                      ▼
                        initiateDuesOnPlayerActivation
                          (crée /dues, status=pending_grace)
                                      │
              ┌───────────── J+gracePeriodDays ─────────────┐
              ▼                                              ▼
       issueDuesScheduled                       (cas grace=0 → issued direct)
       status=issued, dueAt+=N,
       écrit /pendingEmails template
       dues_payment_request, due.emailedAt=now
                                      │
                                      ▼
                       admin/treasurer cliquent "Payer"
                          → callable markDuePaid
                          → status=paid, paidAt, paidAmount
                          → /pendingEmails dues_payment_confirmed
```

Cf. `docs/chantier-registrations.md` (Phase E) pour le détail produit.

### License requests

Évite que le comité émette des licences pour des joueurs qui ne jouent jamais.

1. Coach (mobile) toggle "licensed" sur un joueur de son équipe.
2. Crée `licenseRequest` (`status: "pending"`).
3. Admin (web) :
   - **Approve** → `member.licensed = true`. La procédure fédérale réelle est hors-bande.
   - **Reject** avec commentaire. Coach notifié.
4. Démotion (un-license) = admin only, web only.

## Roadmap

### Phase 0 — Foundations multi-tenant
- Control-plane Firebase + `/registry/clients`
- Script provisioning client (gcloud + Firebase CLI)
- CI cross-projet (rules, indexes, Functions)
- Schema versioning + migration runner

### Phase 1 — Web app
1. Setup Vue + Vite + TS + PrimeVue + Firebase SDK
2. **Firestore rules d'abord** (avant tout composant)
3. Auth + route guards allowlist + `rootAdmin`
4. Config club (`config/club`)
5. Members (CRUD + rôles + niveaux officiels)
6. Teams (CRUD + activation saison + dues par équipe)
7. MatchTypes
8. Venues & courts (+ courts combinés)
9. Seasons & slots
10. Booking generation (Function + dry-run)
11. Closures (cascading cancel)
12. Match scheduling (home/away, officials)
13. Coach booking (web)
14. Attendance (web + export)
15. Officials (liste, indicateurs, config seuils)
16. Dues & exception review
17. License requests review
18. Court history (audit + actionLog)
19. Season planning assistant

### Phase 2 — Flutter mobile
20–26. Voir `mobile-app.md`.
