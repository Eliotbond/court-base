# Mobile App — Flutter

> Phase 2 du roadmap. Ce doc est un guide minimal ; les détails Flutter seront ajoutés au démarrage du dev mobile.

## Stack (planifiée)

| Layer | Tech |
|---|---|
| Framework | Flutter (iOS + Android) |
| State | Riverpod |
| Router | GoRouter |
| Backend | Firebase Flutter plugins |
| Push | FCM |

## Scope (voir `main.md` pour règles complètes)

### Coach
- Vue du planning, attendance, cancel training, booking ad-hoc, move match-away, requests de move home.
- **Attendance avec exclusion enforcement** : joueurs avec `duesStatus == "excluded"` flaggés, pas d'option "present", coach doit marquer absent/refusé. `"excepted"` (exception pending) = train normalement + badge.
- **Submit payment exception** : depuis row d'un joueur exclu, form avec motivation libre → `paymentExceptionRequest` pending. Tant que pending, joueur peut train.
- **Toggle license** : depuis roster, flip "licensed" → crée `licenseRequest` pending. Validation admin sur web.

### Official
- Voir les `match_home` de son club avec assignations non full confirmées (filtré sur son niveau).
- Voir ses propres assignations (`pending` / `confirmed` / `declined`).
- Self-register sur un slot ouvert → `officialAssignment` `pending`.
- Confirmer / décliner une assignation créée par admin.
- Notifs FCM + in-app : `new_match`, `officials_needed`, `urgent`, `match_reminder`.
- Badge unread via `readBy[]`.
- **UI restreinte** : seulement ses assignations et matches needing officials. Pas de membres / teams / autres bookings. Guards `allowlist`.

### Admin (restreint mobile)
- Assign slot à match, move match, approve/reject match requests, send notifs.

Toutes les features mobile sont aussi sur web sauf :
- Submit payment exception (coach mobile only)
- Toggle license (coach mobile only)

Le web admin = **review** des deux flows ci-dessus.

## Règle spécifique mobile — membre inactif

Un membre marqué inactif (`/members/{memberId}.active === false`, basculé par
l'admin depuis la fiche membre) a **quitté le club** et perd l'accès à l'app
club. Côté mobile :

- À l'ouverture de session (post-login), l'app **DOIT** charger le membre lié
  (`linkedMember`, résolu via `user.memberId`) et vérifier `linkedMember.active`.
- Si `active === false` → **bloquer l'accès** : afficher un écran d'information
  ("compte inactif — contactez le club ou réinscrivez-vous via le portail
  d'inscription") plutôt que le shell de l'app. Ne pas router vers les écrans
  coach/official/admin.
- Un doc membre **sans** le champ `active` est traité comme **actif** (pas de
  blocage par omission) — cohérent avec le helper `firestore.rules`.
- Les comptes **staff** (rootAdmin/admin/coach/treasurer) ne sont jamais
  concernés par cette suspension.

Cette vérification applicative est une garde **UX**. La défense en profondeur
réelle est côté données : le helper `callerSuspended()` de `firestore.rules`
rejette déjà toute lecture des collections app club (`/bookings`, `/matches`,
`/venues`, `/notifications`, etc.) pour un compte non-staff dont le membre lié
est inactif. Cf. `docs/firebase.md` → "Membre inactif — suspension de l'accès
app club". La réinscription via `courtbase-register` réactive le membre
(`confirmRegistration` repose `active: true`) et restaure l'accès.

## État de livraison (2026-05-18)

App scaffoldée et bâtie dans `apps/mobile/` (Flutter 3.29 / Dart 3.7, Riverpod 3
sans codegen, GoRouter 17, Firebase 4-6.x). `flutter analyze` clean.

- **Fondations** : bootstrap Firebase (`court-base-44878` via `flutterfire`), couche
  `core/` (converters Timestamp, `Result`/`AppException`), 13 modèles alignés sur
  `docs/firebase.md`, auth (session 3 états + deny-orphan), GoRouter + allowlist
  par rôle, `HomeShell` à onglets dérivés des rôles.
- **Officiel** : matchs à pourvoir (domicile + extérieur, filtrés au niveau),
  mes assignations (confirm/decline), détail match avec auto-inscription
  (gatée `member.officialLicense != null`) → planifie 2 notifications locales
  (24h + 3h, `flutter_local_notifications`, inexactes) + propose l'ajout au
  calendrier (`add_2_calendar`). Décliner annule les rappels.
- **Coach** : mes équipes, effectif (badges licence/cotisation), formulaire
  membre create/edit (→ callables `coachCreateMember`/`coachUpdateMember`),
  désactivation (`coachDeactivateMember` bench/archive), match à l'extérieur
  (`coachCreateAwayMatch`), demande de déplacement (`/matchRequests` direct),
  demande de licence (`/licenseRequests` direct), gestion des inscriptions
  (callables `markTrialInProgress`/`confirmRegistration`/`refuseRegistration`).
- **Notifications** : liste in-app + badge unread (`readBy[]`), push FCM
  (tokens dans `/users/{uid}/fcmTokens`, trigger `fanoutNotification` côté
  backend), handlers foreground/background, deep-link.

### Restes manuels / déploiement

- **iOS APNs** : capability Push Notifications + upload de la clé `.p8` dans la
  console Firebase — étapes manuelles (cf. `apps/mobile/CLAUDE.md`).
- **Backend à déployer** : `firestore.rules` (bloc `fcmTokens`) + les Functions
  `fanoutNotification` / `coach*` + binding IAM `allUsers/run.invoker` sur les
  callables. Sans ça l'écriture des tokens FCM échoue en `permission-denied`
  (gérée défensivement — pas de crash).

## TODO restant

- Offline-first (Firestore persistence, optimistic UI).
- Tests widget/intégration au-delà des tests unitaires de fondation.
