import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Source d'une assignation — booking (match home) ou match (match away).
/// Les deux sous-collections `officialAssignments` partagent le même schéma ;
/// ce flag indique où vit le doc parent.
enum OfficialAssignmentParent { booking, match }

/// Document `/bookings/{id}/officialAssignments/{id}` ou
/// `/matches/{id}/officialAssignments/{id}`.
class OfficialAssignment {
  const OfficialAssignment({
    required this.id,
    required this.memberId,
    required this.officialLevel,
    required this.status,
    required this.assignedAt,
    required this.assignedBy,
    required this.respondedAt,
    required this.parentKind,
    required this.parentId,
  });

  final String id;
  final String memberId;

  /// Niveau de l'officiel au moment de l'assignation (snapshot).
  final int officialLevel;
  final OfficialAssignmentStatus status;
  final DateTime assignedAt;
  final String assignedBy;
  final DateTime? respondedAt;

  /// Type du doc parent (booking ou match) — dérivé du chemin du snapshot.
  final OfficialAssignmentParent parentKind;

  /// ID du doc parent (bookingId ou matchId).
  final String parentId;

  factory OfficialAssignment.fromMap(
    String id,
    Map<String, dynamic> map, {
    required OfficialAssignmentParent parentKind,
    required String parentId,
  }) =>
      OfficialAssignment(
        id: id,
        memberId: FsConvert.str(map['memberId']),
        officialLevel: FsConvert.integer(map['officialLevel']),
        status: OfficialAssignmentStatus.fromWire(map['status']),
        assignedAt: FsConvert.toDateTimeOr(map['assignedAt']),
        assignedBy: FsConvert.str(map['assignedBy']),
        respondedAt: FsConvert.toDateTime(map['respondedAt']),
        parentKind: parentKind,
        parentId: parentId,
      );

  /// Construit depuis un snapshot — le type de parent est déduit du chemin
  /// (`bookings/{id}/officialAssignments/{id}` vs `matches/...`).
  factory OfficialAssignment.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) {
    final parentRef = snapshot.reference.parent.parent;
    final parentCollection = parentRef?.parent.id ?? '';
    final parentKind = parentCollection == 'matches'
        ? OfficialAssignmentParent.match
        : OfficialAssignmentParent.booking;
    return OfficialAssignment.fromMap(
      snapshot.id,
      FsConvert.requireData(snapshot),
      parentKind: parentKind,
      parentId: parentRef?.id ?? '',
    );
  }

  OfficialAssignment copyWith({
    String? memberId,
    int? officialLevel,
    OfficialAssignmentStatus? status,
    DateTime? assignedAt,
    String? assignedBy,
    DateTime? respondedAt,
    OfficialAssignmentParent? parentKind,
    String? parentId,
  }) =>
      OfficialAssignment(
        id: id,
        memberId: memberId ?? this.memberId,
        officialLevel: officialLevel ?? this.officialLevel,
        status: status ?? this.status,
        assignedAt: assignedAt ?? this.assignedAt,
        assignedBy: assignedBy ?? this.assignedBy,
        respondedAt: respondedAt ?? this.respondedAt,
        parentKind: parentKind ?? this.parentKind,
        parentId: parentId ?? this.parentId,
      );
}
