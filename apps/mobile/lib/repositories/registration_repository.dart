import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/registration.dart';

/// Repository des inscriptions (`/registrations`).
///
/// Périmètre coach : observer les inscriptions d'UNE équipe. Les rules
/// imposent une lecture par équipe (`isCoachOfTeam(teamId)`), d'où l'absence
/// de requête globale. Les mutations (confirm/refuse/markTrial) passent par
/// les callables existantes — cf. `CallablesRepository`.
class RegistrationRepository {
  RegistrationRepository();

  // ignore: unused_field
  final AppLogger _log = const AppLogger('RegistrationRepository');

  /// Observe les inscriptions de l'équipe [teamId].
  ///
  /// Requête `where('teamId', ==)` seule + tri `createdAt` desc côté client
  /// (petit volume — pas d'index composite, cf. CLAUDE.md §10).
  Stream<List<Registration>> watchRegistrationsForTeam(String teamId) {
    return FirebaseRefs.registrations
        .where('teamId', isEqualTo: teamId)
        .snapshots()
        .map((snapshot) {
      final registrations = snapshot.docs
          .map(Registration.fromFirestore)
          .toList(growable: true);
      registrations.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      return registrations;
    });
  }
}
