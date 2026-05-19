import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Document `/licenseRequests/{requestId}` — coach (mobile) demande une licence
/// pour un joueur. Validation admin sur web.
class LicenseRequest {
  const LicenseRequest({
    required this.id,
    required this.memberId,
    required this.teamId,
    required this.requestedBy,
    required this.status,
    required this.reviewedBy,
    required this.reviewedAt,
    required this.adminComment,
    required this.createdAt,
  });

  final String id;
  final String memberId;
  final String teamId;

  /// uid coach.
  final String requestedBy;
  final LicenseRequestStatus status;
  final String? reviewedBy;
  final DateTime? reviewedAt;
  final String? adminComment;
  final DateTime createdAt;

  factory LicenseRequest.fromMap(String id, Map<String, dynamic> map) =>
      LicenseRequest(
        id: id,
        memberId: FsConvert.str(map['memberId']),
        teamId: FsConvert.str(map['teamId']),
        requestedBy: FsConvert.str(map['requestedBy']),
        status: LicenseRequestStatus.fromWire(map['status']),
        reviewedBy: FsConvert.strOrNull(map['reviewedBy']),
        reviewedAt: FsConvert.toDateTime(map['reviewedAt']),
        adminComment: FsConvert.strOrNull(map['adminComment']),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
      );

  factory LicenseRequest.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      LicenseRequest.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  /// Payload d'écriture pour la création (write direct coach autorisé par
  /// les rules). `createdAt` est posé par l'appelant via `serverTimestamp`.
  Map<String, dynamic> toCreateMap() => {
        'memberId': memberId,
        'teamId': teamId,
        'requestedBy': requestedBy,
        'status': status.wire,
        'reviewedBy': null,
        'reviewedAt': null,
        'adminComment': null,
      };

  LicenseRequest copyWith({
    String? memberId,
    String? teamId,
    String? requestedBy,
    LicenseRequestStatus? status,
    String? reviewedBy,
    DateTime? reviewedAt,
    String? adminComment,
    DateTime? createdAt,
  }) =>
      LicenseRequest(
        id: id,
        memberId: memberId ?? this.memberId,
        teamId: teamId ?? this.teamId,
        requestedBy: requestedBy ?? this.requestedBy,
        status: status ?? this.status,
        reviewedBy: reviewedBy ?? this.reviewedBy,
        reviewedAt: reviewedAt ?? this.reviewedAt,
        adminComment: adminComment ?? this.adminComment,
        createdAt: createdAt ?? this.createdAt,
      );
}
