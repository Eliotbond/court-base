import 'package:firebase_core/firebase_core.dart';

import '../firebase_options.dart';

/// Identifiant du client SAAS, injecté au build via
/// `--dart-define=CLIENT=dev`. Le modèle est « un projet Firebase par
/// client » : ajouter un flavor ici quand un nouveau client arrive.
const String kClientFlavor = String.fromEnvironment(
  'CLIENT',
  defaultValue: 'dev',
);

/// Résout les [FirebaseOptions] de la plateforme courante pour le client
/// sélectionné.
///
/// Aujourd'hui un seul client (`dev` = projet `court-base-44878`) : on délègue
/// à `DefaultFirebaseOptions` généré par `flutterfire configure`. Indirection
/// volontaire : un futur client `acme` régénère `firebase_options.dart` dans
/// un fichier dédié et ajoute un `case 'acme'` ici.
FirebaseOptions firebaseOptionsForCurrentClient() {
  switch (kClientFlavor) {
    case 'dev':
    default:
      // Flavor inconnu → repli sur dev plutôt que de crasher au boot.
      return DefaultFirebaseOptions.currentPlatform;
  }
}
