import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/app_exception.dart';
import '../core/constants.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/enums.dart';
import '../models/official_assignment.dart';

/// Repository des assignations d'officiels.
///
/// Les assignations vivent dans deux sous-collections de même schéma :
/// `/bookings/{id}/officialAssignments` (match à domicile) et
/// `/matches/{id}/officialAssignments` (match à l'extérieur).
///
/// Côté `firestore.rules` un officiel peut :
/// - **créer** sa propre assignation seulement avec `status == 'pending'` et
///   `memberId == userDoc().memberId`, et seulement si son membre porte une
///   `officialLicense` (`callerHasOfficialLicense()`) ;
/// - **mettre à jour** uniquement `status` (+ `respondedAt`) de sa propre
///   assignation.
class OfficialAssignmentRepository {
  OfficialAssignmentRepository({required this.currentUid});

  /// uid Auth du user courant — porté dans `assignedBy` à l'auto-inscription.
  final String currentUid;

  final AppLogger _log = const AppLogger('OfficialAssignmentRepository');

  // --- Lectures -----------------------------------------------------------

  /// Observe les assignations d'un booking (match à domicile).
  Stream<List<OfficialAssignment>> watchAssignmentsForBooking(
    String bookingId,
  ) {
    final coll = FirebaseRefs.bookings
        .doc(bookingId)
        .collection(FsCollections.officialAssignments);
    return coll.snapshots().map(
          (snapshot) => snapshot.docs
              .map(OfficialAssignment.fromFirestore)
              .toList(growable: false),
        );
  }

  /// Observe les assignations d'un match (match à l'extérieur).
  Stream<List<OfficialAssignment>> watchAssignmentsForMatch(String matchId) {
    final coll = FirebaseRefs.matches
        .doc(matchId)
        .collection(FsCollections.officialAssignments);
    return coll.snapshots().map(
          (snapshot) => snapshot.docs
              .map(OfficialAssignment.fromFirestore)
              .toList(growable: false),
        );
  }

  /// Observe les assignations de l'officiel courant, tous parents confondus.
  ///
  /// `collectionGroup('officialAssignments')` filtré sur `memberId`, **sans**
  /// `orderBy` (pas d'index composite à déployer — convention repo). Le tri
  /// par `assignedAt` décroissant est fait côté client. Le `parentKind` /
  /// `parentId` sont dérivés du chemin du snapshot (cf.
  /// `OfficialAssignment.fromFirestore`).
  Stream<List<OfficialAssignment>> watchMyAssignments(String memberId) {
    final query = FirebaseRefs.officialAssignmentsGroup()
        .where('memberId', isEqualTo: memberId);
    return query.snapshots().map((snapshot) {
      final list = snapshot.docs
          .map(OfficialAssignment.fromFirestore)
          .toList(growable: false)
        ..sort((a, b) => b.assignedAt.compareTo(a.assignedAt));
      return list;
    });
  }

  // --- Mutations ----------------------------------------------------------

  /// Auto-inscription de l'officiel courant à un match.
  ///
  /// Écrit un doc `status: 'pending'` dans la sous-collection
  /// `officialAssignments` du parent (booking ou match). Conforme à la rule
  /// `create` : `status == 'pending'`, `memberId == userDoc().memberId`.
  ///
  /// Renvoie l'id du doc créé.
  Future<String> selfRegister({
    required OfficialAssignmentParent parentKind,
    required String parentId,
    required String memberId,
    required int officialLevel,
  }) async {
    try {
      final coll = _assignmentsCollection(parentKind, parentId);
      final ref = await coll.add({
        'memberId': memberId,
        'officialLevel': officialLevel,
        'status': OfficialAssignmentStatus.pending.wire,
        'assignedAt': FieldValue.serverTimestamp(),
        'assignedBy': currentUid,
        'respondedAt': null,
      });
      return ref.id;
    } catch (error, stack) {
      _log.error(
        'selfRegister failed [${parentKind.name}/$parentId]',
        error,
        stack,
      );
      throw AppException.fromFirebase(error, stack);
    }
  }

  /// Répond à une assignation existante (confirme ou décline).
  ///
  /// Met à jour uniquement `status` et `respondedAt` — le seul update permis à
  /// l'officiel par les rules.
  Future<void> respond({
    required OfficialAssignmentParent parentKind,
    required String parentId,
    required String assignmentId,
    required OfficialAssignmentStatus status,
  }) async {
    try {
      final coll = _assignmentsCollection(parentKind, parentId);
      await coll.doc(assignmentId).update({
        'status': status.wire,
        'respondedAt': FieldValue.serverTimestamp(),
      });
    } catch (error, stack) {
      _log.error(
        'respond failed [${parentKind.name}/$parentId/$assignmentId]',
        error,
        stack,
      );
      throw AppException.fromFirebase(error, stack);
    }
  }

  /// Sous-collection `officialAssignments` du parent (booking ou match).
  CollectionReference<Map<String, dynamic>> _assignmentsCollection(
    OfficialAssignmentParent parentKind,
    String parentId,
  ) {
    final parentDoc = switch (parentKind) {
      OfficialAssignmentParent.booking =>
        FirebaseRefs.bookings.doc(parentId),
      OfficialAssignmentParent.match => FirebaseRefs.matches.doc(parentId),
    };
    return parentDoc.collection(FsCollections.officialAssignments);
  }
}
