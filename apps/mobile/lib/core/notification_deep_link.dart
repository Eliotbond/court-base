/// Cible de navigation portée par une notification push tapée.
///
/// Type de domaine — découple les couches supérieures (providers, router)
/// du `RemoteMessage` brut du SDK `firebase_messaging`. Le repository de
/// messaging traduit le message reçu en [NotificationDeepLink].
library;

/// Nature de la cible d'un deep-link de notification.
enum NotificationTargetKind {
  /// Détail d'un match à l'extérieur (`/matches/{id}`).
  match,

  /// Détail d'un match à domicile (`/bookings/{id}`).
  booking,
}

/// Cible résolue d'une notification — `kind` + identifiant du document.
class NotificationDeepLink {
  const NotificationDeepLink({required this.kind, required this.id});

  final NotificationTargetKind kind;
  final String id;

  /// Construit un deep-link depuis les `data` d'un message push.
  ///
  /// Renvoie `null` si aucun `relatedMatchId` / `relatedBookingId` exploitable
  /// n'est présent — l'appelant ignore alors silencieusement le message.
  static NotificationDeepLink? fromData(Map<String, dynamic> data) {
    final matchId = data['relatedMatchId'];
    if (matchId is String && matchId.isNotEmpty) {
      return NotificationDeepLink(
        kind: NotificationTargetKind.match,
        id: matchId,
      );
    }
    final bookingId = data['relatedBookingId'];
    if (bookingId is String && bookingId.isNotEmpty) {
      return NotificationDeepLink(
        kind: NotificationTargetKind.booking,
        id: bookingId,
      );
    }
    return null;
  }

  @override
  bool operator ==(Object other) =>
      other is NotificationDeepLink &&
      other.kind == kind &&
      other.id == id;

  @override
  int get hashCode => Object.hash(kind, id);

  @override
  String toString() => 'NotificationDeepLink(${kind.name}:$id)';
}
