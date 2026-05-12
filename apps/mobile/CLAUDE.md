# Claude Code — `apps/mobile`

> App Flutter (iOS + Android). **Phase 2 du roadmap** — pas avant que la web app soit livrée.

## À lire pour bosser ici

1. `docs/mobile-app.md` — scope, features par audience
2. `docs/main.md` — règles métier (les mêmes que web, l'app mobile est un autre client)
3. `docs/firebase.md` — schéma
4. Ce fichier

## Stack

Flutter · Riverpod · GoRouter · Firebase Flutter plugins · FCM.

## Hors workspace npm

`apps/mobile/` n'est **pas** un workspace npm. Le tooling Flutter (`pubspec.yaml`, `flutter`, `dart`) opère indépendamment. La connexion au monorepo se fait via :
- Lecture des `docs/` pour les règles
- Schémas alignés avec `firebase.md` (pas d'auto-génération de types Dart pour l'instant)

## Audiences

- **Coach** : planning, attendance avec exclusion enforcement, payment exception requests, license toggle, ad-hoc booking, match-away/move.
- **Official** : matches needing officials, self-register, confirm/decline, notifs FCM + in-app.
- **Admin restreint** : assign slot, move match, approve/reject match requests, send notifs.

Voir `docs/mobile-app.md` pour le détail.

## Règles spécifiques mobile

- **Exclusion enforcement** : joueur `duesStatus == "excluded"` → pas d'option "present" en attendance.
- **`"excepted"`** → train normalement avec badge "exception pending".
- **License toggle** : crée `licenseRequest` `pending`, valid admin sur web.
- **Payment exception submit** : depuis player row exclu, form motivation libre.

## TODO (Phase 2)

Voir `docs/mobile-app.md` section TODO.
