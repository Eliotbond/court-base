import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/enums.dart';
import '../models/match_request.dart';

/// Repository des demandes de déplacement de match (`/matchRequests`).
///
/// Les rules autorisent un coach à `create` directement (pas de callable) ;
/// la validation est faite par l'admin sur le web.
class MatchRequestRepository {
  MatchRequestRepository();

  final AppLogger _log = const AppLogger('MatchRequestRepository');

  /// Crée une demande de déplacement d'un match à domicile.
  ///
  /// Écriture directe `/matchRequests` (`requestType: move_home`,
  /// `requestedBy: <uid>`, `status: pending`, `createdAt: serverTimestamp`).
  Future<String> createMoveHomeRequest({
    required String bookingId,
    required String requestedByUid,
    DateTime? proposedDate,
    String? proposedSlotId,
    String? reason,
  }) async {
    try {
      final request = MatchRequest(
        id: '',
        bookingId: bookingId,
        requestedBy: requestedByUid,
        requestType: MatchRequestType.moveHome,
        proposedDate: proposedDate,
        proposedSlotId: proposedSlotId,
        reason: reason,
        status: MatchRequestStatus.pending,
        reviewedBy: null,
        reviewedAt: null,
        adminComment: null,
        createdAt: DateTime.now(),
      );
      final ref = await FirebaseRefs.matchRequests.add({
        ...request.toCreateMap(),
        'createdAt': FieldValue.serverTimestamp(),
      });
      return ref.id;
    } catch (error, stack) {
      _log.error('createMoveHomeRequest failed', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
  }

  /// Observe les demandes émises par [uid] (tri `createdAt` desc côté client —
  /// petit volume, pas d'index composite).
  Stream<List<MatchRequest>> watchMyRequests(String uid) {
    return FirebaseRefs.matchRequests
        .where('requestedBy', isEqualTo: uid)
        .snapshots()
        .map((snapshot) {
      final requests = snapshot.docs
          .map(MatchRequest.fromFirestore)
          .toList(growable: true);
      requests.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      return requests;
    });
  }
}
