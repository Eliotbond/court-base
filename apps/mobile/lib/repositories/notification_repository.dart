import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/app_notification.dart';

/// Nombre maximum de notifications chargées dans le flux temps réel.
const int kNotificationsPageSize = 50;

/// Repository d'accès aux notifications (`/notifications`).
///
/// Les rules autorisent : lecture pour tout signed-in ; update limitée à
/// l'ajout de son propre uid dans `readBy[]`. Ce repository ne fait donc que
/// ces deux opérations.
class NotificationRepository {
  NotificationRepository();

  final AppLogger _log = const AppLogger('NotificationRepository');

  /// Observe les ~50 dernières notifications, triées `createdAt desc`.
  ///
  /// `orderBy('createdAt')` seul → index simple auto-créé par Firestore, pas
  /// d'index composite à déployer. Les docs dont `createdAt` n'est pas encore
  /// résolu (serverTimestamp en attente) sont exclus par Firestore — ils
  /// réapparaissent au tick suivant une fois le timestamp posé.
  Stream<List<AppNotification>> watchNotifications() {
    final query = FirebaseRefs.notifications
        .orderBy('createdAt', descending: true)
        .limit(kNotificationsPageSize);
    return query.snapshots().map(
      (snapshot) => snapshot.docs
          .map(AppNotification.fromFirestore)
          .toList(growable: false),
    );
  }

  /// Marque la notification [notificationId] comme lue par [uid].
  ///
  /// `arrayUnion` est idempotent : un double-tap n'ajoute pas de doublon. Les
  /// rules n'autorisent que l'ajout de **son propre** uid dans `readBy[]` —
  /// passer un autre uid serait refusé côté serveur.
  Future<void> markRead(String notificationId, String uid) async {
    try {
      await FirebaseRefs.notifications.doc(notificationId).update({
        'readBy': FieldValue.arrayUnion([uid]),
      });
    } catch (error, stack) {
      _log.error('markRead failed for /notifications/$notificationId', error,
          stack);
      throw AppException.fromFirebase(error, stack);
    }
  }
}
