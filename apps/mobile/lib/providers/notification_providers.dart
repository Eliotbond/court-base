import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/logger.dart';
import '../core/notification_deep_link.dart';
import '../models/app_notification.dart';
import '../repositories/messaging_repository.dart';
import '../repositories/notification_repository.dart';
import 'auth_providers.dart';

const AppLogger _log = AppLogger('NotificationProviders');

// --- Repositories ---------------------------------------------------------

/// Repository d'accès aux notifications (`/notifications`).
final notificationRepositoryProvider =
    Provider<NotificationRepository>((ref) {
  return NotificationRepository();
});

/// Repository FCM (token, push, deep-link). Singleton — ses abonnements sont
/// libérés à la disposition du `ProviderScope`.
final messagingRepositoryProvider = Provider<MessagingRepository>((ref) {
  final repo = MessagingRepository();
  ref.onDispose(repo.dispose);
  return repo;
});

// --- Flux de notifications ------------------------------------------------

/// Flux temps réel des ~50 dernières notifications, triées `createdAt desc`.
final notificationsStreamProvider =
    StreamProvider<List<AppNotification>>((ref) {
  final repo = ref.watch(notificationRepositoryProvider);
  return repo.watchNotifications();
});

/// Nombre de notifications non lues par le user courant.
///
/// Une notification est non lue si l'uid courant n'est pas dans `readBy[]`.
/// Retourne `0` tant que la session n'est pas valide ou que le flux charge.
final unreadCountProvider = Provider<int>((ref) {
  final uid = ref.watch(appUserProvider)?.id;
  if (uid == null) return 0;

  final notifications = ref.watch(notificationsStreamProvider).value;
  if (notifications == null) return 0;

  return notifications.where((n) => !n.isReadBy(uid)).length;
});

// --- Initialisation FCM ---------------------------------------------------

/// Provider d'init FCM — déclenché quand la session devient valide.
///
/// Watch ce provider depuis un widget monté sous une session valide (le shell)
/// pour : demander la permission, enregistrer le token dans `fcmTokens`,
/// brancher les écouteurs de messages, et invalider le flux notifications à
/// chaque push reçu en foreground.
final fcmInitProvider = Provider<void>((ref) {
  final uid = ref.watch(appUserProvider)?.id;
  if (uid == null) return;

  final messaging = ref.watch(messagingRepositoryProvider);

  // Rafraîchit le flux Firestore dès qu'un push arrive en foreground.
  final refreshSub = messaging.onPushReceived.listen((_) {
    ref.invalidate(notificationsStreamProvider);
  });
  ref.onDispose(refreshSub.cancel);

  // Permission + token + écouteurs (best-effort, ne plante jamais l'app).
  Future<void>(() async {
    await messaging.requestPermissionAndRegister(uid);
    await messaging.startListening();
  }).catchError((Object error, StackTrace stack) {
    _log.warn('fcmInit failed', error, stack);
  });
});

/// Stream des cibles de deep-link issues d'un tap sur notification push. Le
/// widget racine de l'app peut l'écouter pour router vers le match concerné.
final fcmOpenedMessageProvider = StreamProvider<NotificationDeepLink>((ref) {
  final messaging = ref.watch(messagingRepositoryProvider);
  return messaging.onMessageOpened;
});
