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

## TODO (à ouvrir au démarrage Phase 2)

- Riverpod conventions (family providers, scope, invalidation).
- GoRouter + redirect guards allowlist.
- FCM setup (iOS APNs, Android channels, token refresh, foreground).
- Notifs locales (offline reminders).
- Offline-first (Firestore persistence, optimistic UI).
- Deep links, background fetch, badge counts.
