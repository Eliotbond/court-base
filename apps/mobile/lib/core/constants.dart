/// Constantes globales de l'app : région Functions, noms de collections
/// Firestore, IDs de documents singletons.
library;

/// Région de déploiement des Cloud Functions (Zurich).
const String kFunctionsRegion = 'europe-west6';

/// Nom du fuseau horaire par défaut (fallback si `flutter_timezone` échoue).
const String kDefaultTimeZone = 'Europe/Zurich';

/// Locale par défaut des formatages utilisateur.
const String kAppLocale = 'fr_CH';

/// Noms des collections Firestore. Source de vérité : `docs/firebase.md`.
class FsCollections {
  const FsCollections._();

  static const String config = 'config';
  static const String users = 'users';
  static const String fcmTokens = 'fcmTokens';
  static const String members = 'members';
  static const String private = 'private';
  static const String teams = 'teams';
  static const String categories = 'categories';
  static const String matchTypes = 'matchTypes';
  static const String bookings = 'bookings';
  static const String matches = 'matches';
  static const String officialAssignments = 'officialAssignments';
  static const String attendance = 'attendance';
  static const String notifications = 'notifications';
  static const String matchRequests = 'matchRequests';
  static const String licenseRequests = 'licenseRequests';
  static const String registrations = 'registrations';
}

/// IDs de documents à clé fixe (singletons).
class FsDocs {
  const FsDocs._();

  /// `/config/club`.
  static const String clubConfig = 'club';

  /// `/members/{id}/private/contact`.
  static const String memberContact = 'contact';
}

/// Canaux de notifications locales Android.
class NotificationChannels {
  const NotificationChannels._();

  static const String matchReminders = 'match_reminders';
  static const String pushGeneral = 'push_general';
}
