import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Document `/notifications/{notificationId}` — notification poussée vers les
/// officiels.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.sentBy,
    required this.targetAudience,
    required this.relatedBookingId,
    required this.relatedMatchId,
    required this.createdAt,
    required this.readBy,
    required this.pushedAt,
  });

  final String id;
  final NotificationType type;
  final String title;
  final String body;

  /// uid de l'émetteur ; `null` si générée automatiquement.
  final String? sentBy;
  final NotificationTargetAudience targetAudience;

  /// Booking lié — match à domicile uniquement.
  final String? relatedBookingId;

  /// Match lié — renseigné pour les matchs à l'extérieur.
  final String? relatedMatchId;
  final DateTime createdAt;

  /// uids des officiels ayant lu la notification.
  final List<String> readBy;
  final DateTime? pushedAt;

  /// `true` si [uid] a déjà lu cette notification.
  bool isReadBy(String uid) => readBy.contains(uid);

  factory AppNotification.fromMap(String id, Map<String, dynamic> map) =>
      AppNotification(
        id: id,
        type: NotificationType.fromWire(map['type']),
        title: FsConvert.str(map['title']),
        body: FsConvert.str(map['body']),
        sentBy: FsConvert.strOrNull(map['sentBy']),
        targetAudience:
            NotificationTargetAudience.fromWire(map['targetAudience']),
        relatedBookingId: FsConvert.strOrNull(map['relatedBookingId']),
        relatedMatchId: FsConvert.strOrNull(map['relatedMatchId']),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
        readBy: FsConvert.stringList(map['readBy']),
        pushedAt: FsConvert.toDateTime(map['pushedAt']),
      );

  factory AppNotification.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      AppNotification.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  AppNotification copyWith({
    NotificationType? type,
    String? title,
    String? body,
    String? sentBy,
    NotificationTargetAudience? targetAudience,
    String? relatedBookingId,
    String? relatedMatchId,
    DateTime? createdAt,
    List<String>? readBy,
    DateTime? pushedAt,
  }) =>
      AppNotification(
        id: id,
        type: type ?? this.type,
        title: title ?? this.title,
        body: body ?? this.body,
        sentBy: sentBy ?? this.sentBy,
        targetAudience: targetAudience ?? this.targetAudience,
        relatedBookingId: relatedBookingId ?? this.relatedBookingId,
        relatedMatchId: relatedMatchId ?? this.relatedMatchId,
        createdAt: createdAt ?? this.createdAt,
        readBy: readBy ?? this.readBy,
        pushedAt: pushedAt ?? this.pushedAt,
      );
}
