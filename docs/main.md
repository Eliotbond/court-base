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
- **MatchType** — type de compétition. Définit `requiredCourtSize`, `homeOfficialRequirements`, `awayOfficialCount`.
- **Team** — persiste cross-saisons via `activeSeasonIds[]`. `schedulingConstraints` + `duesAmount` (CHF par joueur/an). Référence une `Category` (`categoryId`).
- **Category** — référentiel club (U11, U14, Seniors, Loisirs…). Éditable par l'admin (Settings → Catégories). Porte `name`, `minAge`, `maxAge`, `displayOrder`, `active`. Cf. `firebase.md` (`/categories`).
- **Closure Period** — manuelle, réutilisable.
- **Dues** — cotisation joueur/saison. Lifecycle géré par Functions.
- **Payment Exception Request** — coach demande override d'exclusion ; admin valide.
- **License Request** — coach (mobile) demande licence joueur ; admin valide.
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

## Règles métier — synthèse

### Slot types
- `match_home` → suspend les `training` de la même équipe ce jour-là ; trigger l'assignation officiels.
- `match_away` → libère les `training` de l'équipe ce jour-là.
- `reserve` → libéré en premier en cas de conflit ; réservable ad-hoc par un coach.
- `custom` → label seulement.

### Bookings
- Générés automatiquement à l'activation de saison (hors closure periods).
- **Jamais supprimés** : cancel = `status: "cancelled"`.
- Ajout closure post-génération → cascading cancellation via Function.
- Toutes les actions coach loggées dans `booking.actionLog` (append-only).

### Coach booking
- Reserve ad-hoc un slot `freed`/`reserve` pour son équipe → **direct, pas de validation admin**.
- Cancel un `training` de son équipe → `freed`, direct.
- Move match vers away → direct. Move `match_home` → `matchRequest` (validation admin). `matchRequest` est **uniquement** pour déplacer un `match_home`, jamais pour des réservations ad-hoc.

### Officials
- `officialLevel` sur le Member = source de vérité. **Réglé manuellement par l'admin**, pas d'audit.
- Un membre peut être official + coach (rôles array).
- Un `match_home` crée des `officialAssignment` selon `MatchType.homeOfficialRequirements`.
- Officiels **s'auto-inscrivent** (status `pending`) ou sont assignés par l'admin. Ils confirment/déclinent.
- Notifs auto :
  - `officials_needed` si `match_home` < 7 jours et pas full staff.
  - `match_reminder` à J-1 (23:00) et H-2 aux officiels confirmés.
- Export fin de saison des assignations par membre (les officiels sont payés).
- UI restreinte pour officiels : seulement leurs assignations et matches needing officials. Pas d'accès aux membres/teams/bookings non liés.

### Officials — indicateurs de rentabilité

Une licence coûte ≈ 140 CHF. Le club veut identifier les officiels "problématiques" (licence mais peu de matches).

Config (`config/club.officialsConfig`) :
- `licenseFee` (défaut 140 CHF)
- `thresholdGreen` (matches/saison "rentable", défaut 6)
- `thresholdOrange` (borne basse warning, défaut 3)

`<thresholdOrange` → rouge ; `[thresholdOrange, thresholdGreen-1]` → orange ; `≥ thresholdGreen` → vert. Éditable par l'admin, calculé client-side.

### Season planning assistant
- Optionnel pendant `draft`. Suggère la distribution.
- Hard constraints (bloquant) : match coach ailleurs ce jour, `maxStartTime` dépassé, court size mismatch.
- Soft (warning) : `preferredDays`, `minHoursBetweenSlots`, `trainingsPerWeek`.
- Match confirmé d'un coach un jour bloque ce coach pour **toutes** ses équipes ce jour. Les trainings ne bloquent pas.

### Notifications
- FCM push + in-app (badge + liste).
- Types : `new_match`, `officials_needed`, `urgent`, `match_reminder`.

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
