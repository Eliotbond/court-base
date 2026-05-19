import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/enums.dart';
import '../models/license_request.dart';

/// Repository des demandes de licence (`/licenseRequests`).
///
/// Les rules autorisent un coach d'une équipe (`teamId in userDoc().teamIds`)
/// à `create` directement — la validation est faite par l'admin sur le web.
class LicenseRequestRepository {
  LicenseRequestRepository();

  final AppLogger _log = const AppLogger('LicenseRequestRepository');

  /// Crée une demande de licence pour un joueur de l'équipe [teamId].
  ///
  /// Écriture directe `/licenseRequests` (`requestedBy: <uid>`,
  /// `status: pending`, `createdAt: serverTimestamp`).
  Future<String> createLicenseRequest({
    required String memberId,
    required String teamId,
    required String requestedByUid,
  }) async {
    try {
      final request = LicenseRequest(
        id: '',
        memberId: memberId,
        teamId: teamId,
        requestedBy: requestedByUid,
        status: LicenseRequestStatus.pending,
        reviewedBy: null,
        reviewedAt: null,
        adminComment: null,
        createdAt: DateTime.now(),
      );
      final ref = await FirebaseRefs.licenseRequests.add({
        ...request.toCreateMap(),
        'createdAt': FieldValue.serverTimestamp(),
      });
      return ref.id;
    } catch (error, stack) {
      _log.error('createLicenseRequest failed', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
  }

  /// Observe les demandes de licence d'une équipe (tri `createdAt` desc).
  Stream<List<LicenseRequest>> watchRequestsForTeam(String teamId) {
    return FirebaseRefs.licenseRequests
        .where('teamId', isEqualTo: teamId)
        .snapshots()
        .map((snapshot) {
      final requests = snapshot.docs
          .map(LicenseRequest.fromFirestore)
          .toList(growable: true);
      requests.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      return requests;
    });
  }
}
