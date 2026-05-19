/// Constantes de routes — chemins et noms. Single source of truth pour
/// `context.goNamed(...)` et la config GoRouter.
library;

class AppRoutes {
  const AppRoutes._();

  // --- Chemins ------------------------------------------------------------

  /// Écran de démarrage (résolution de session en cours).
  static const String splashPath = '/splash';

  /// Connexion (Google / Apple).
  static const String signInPath = '/sign-in';

  /// Compte orphelin (signed-in sans doc `/users`).
  static const String orphanPath = '/orphan';

  /// Branche officiel (onglet du shell).
  static const String officialPath = '/officiating';

  /// Branche coach (onglet du shell).
  static const String coachPath = '/coaching';

  /// Branche notifications (onglet du shell).
  static const String notificationsPath = '/notifications';

  // --- Noms ---------------------------------------------------------------

  static const String splash = 'splash';
  static const String signIn = 'sign-in';
  static const String orphan = 'orphan';
  static const String official = 'officiating';
  static const String coach = 'coaching';
  static const String notifications = 'notifications';
}
