import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Document `/matchRequests/{requestId}` — demande coach de déplacer un
/// `match_home` (validation admin sur web).
class MatchRequest {
  const MatchRequest({
    required this.id,
    required this.bookingId,
    required this.requestedBy,
    required this.requestType,
    required this.proposedDate,
    required this.proposedSlotId,
    required this.reason,
    required this.status,
    required this.reviewedBy,
    required this.reviewedAt,
    required this.adminComment,
    required this.createdAt,
  });

  final String id;

  /// Booking `match_home` à déplacer.
  final String bookingId;

  /// uid coach.
  final String requestedBy;
  final MatchRequestType requestType;
  final DateTime? proposedDate;
  final String? proposedSlotId;
  final String? reason;
  final MatchRequestStatus status;
  final String? reviewedBy;
  final DateTime? reviewedAt;
  final String? adminComment;
  final DateTime createdAt;

  factory MatchRequest.fromMap(String id, Map<String, dynamic> map) =>
      MatchRequest(
        id: id,
        bookingId: FsConvert.str(map['bookingId']),
        requestedBy: FsConvert.str(map['requestedBy']),
        requestType: MatchRequestType.fromWire(map['requestType']),
        proposedDate: FsConvert.toDateTime(map['proposedDate']),
        proposedSlotId: FsConvert.strOrNull(map['proposedSlotId']),
        reason: FsConvert.strOrNull(map['reason']),
        status: MatchRequestStatus.fromWire(map['status']),
        reviewedBy: FsConvert.strOrNull(map['reviewedBy']),
        reviewedAt: FsConvert.toDateTime(map['reviewedAt']),
        adminComment: FsConvert.strOrNull(map['adminComment']),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
      );

  factory MatchRequest.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      MatchRequest.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  /// Payload d'écriture pour la création (write direct coach autorisé par
  /// les rules). `createdAt` / `status` sont posés par l'appelant via
  /// `serverTimestamp` et la valeur `pending`.
  Map<String, dynamic> toCreateMap() => {
        'bookingId': bookingId,
        'requestedBy': requestedBy,
        'requestType': requestType.wire,
        'proposedDate':
            proposedDate == null ? null : Timestamp.fromDate(proposedDate!),
        'proposedSlotId': proposedSlotId,
        'reason': reason,
        'status': status.wire,
        'reviewedBy': null,
        'reviewedAt': null,
        'adminComment': null,
      };

  MatchRequest copyWith({
    String? bookingId,
    String? requestedBy,
    MatchRequestType? requestType,
    DateTime? proposedDate,
    String? proposedSlotId,
    String? reason,
    MatchRequestStatus? status,
    String? reviewedBy,
    DateTime? reviewedAt,
    String? adminComment,
    DateTime? createdAt,
  }) =>
      MatchRequest(
        id: id,
        bookingId: bookingId ?? this.bookingId,
        requestedBy: requestedBy ?? this.requestedBy,
        requestType: requestType ?? this.requestType,
        proposedDate: proposedDate ?? this.proposedDate,
        proposedSlotId: proposedSlotId ?? this.proposedSlotId,
        reason: reason ?? this.reason,
        status: status ?? this.status,
        reviewedBy: reviewedBy ?? this.reviewedBy,
        reviewedAt: reviewedAt ?? this.reviewedAt,
        adminComment: adminComment ?? this.adminComment,
        createdAt: createdAt ?? this.createdAt,
      );
}
