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

## Push iOS (APNs) — étapes manuelles obligatoires

Le code Flutter (`messaging_repository.dart`, `Info.plist`) est prêt, mais le
**push iOS reste muet** tant que ces étapes manuelles ne sont pas faites — elles
ne peuvent pas l'être par script :

1. **Xcode** — ouvrir `ios/Runner.xcworkspace`, onglet *Signing & Capabilities*
   de la cible `Runner` :
   - ajouter la capability **Push Notifications** ;
   - ajouter la capability **Background Modes** et cocher *Remote notifications*
     (le `UIBackgroundModes` de `Info.plist` ne suffit pas seul) ;
   - vérifier qu'une équipe de signature valide est sélectionnée.
2. **Apple Developer** — créer une clé d'authentification **APNs `.p8`**
   (Certificates, Identifiers & Profiles → Keys → APNs). Noter le *Key ID* et le
   *Team ID*.
3. **Console Firebase** — projet `court-base-44878` → *Project settings* →
   *Cloud Messaging* → section *Apple app configuration* : uploader la clé
   `.p8` avec son *Key ID* et le *Team ID*. **Sans ça, `getToken()` peut
   renvoyer `null` et aucun push n'arrive sur iOS.**
4. Vérifier que le bundle id de l'app (`ch.alpinedigital.courtbase…`) correspond
   à l'App ID Apple et à `GoogleService-Info.plist`.

Android : aucune étape manuelle FCM (le plugin `com.google.gms.google-services`
et `google-services.json` suffisent). Penser tout de même à enregistrer les
SHA-1/256 debug+release dans la console Firebase pour Google Sign-In.

## TODO (Phase 2)

Voir `docs/mobile-app.md` section TODO.
