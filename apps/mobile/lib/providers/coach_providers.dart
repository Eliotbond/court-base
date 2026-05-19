import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/booking.dart';
import '../models/category.dart';
import '../models/match_type.dart';
import '../models/member.dart';
import '../models/registration.dart';
import '../models/team.dart';
import '../repositories/booking_repository.dart';
import '../repositories/callables_repository.dart';
import '../repositories/license_request_repository.dart';
import '../repositories/match_request_repository.dart';
import '../repositories/match_type_repository.dart';
import '../repositories/registration_repository.dart';
import '../repositories/team_repository.dart';
import 'auth_providers.dart';
import 'firebase_providers.dart';

/// Providers de la slice COACH — repositories + flux métier.
///
/// Couches : `screens → providers → repositories → Firebase`. Les widgets
/// coach ne lisent que ces providers, jamais un repository directement.

// --- Providers de repositories ------------------------------------------

/// Repository d'accès aux équipes / catégories.
final teamRepositoryProvider = Provider<TeamRepository>((ref) {
  return TeamRepository();
});

// `memberRepositoryProvider` est défini dans `firebase_providers.dart`
// (couche infrastructure, partagé avec la slice officiel).

/// Repository des types de match (besoins d'officiels) — partagé.
final matchTypeRepositoryProvider = Provider<MatchTypeRepository>((ref) {
  return MatchTypeRepository();
});

/// Repository des demandes de déplacement de match.
final matchRequestRepositoryProvider = Provider<MatchRequestRepository>((ref) {
  return MatchRequestRepository();
});

/// Repository des demandes de licence.
final licenseRequestRepositoryProvider =
    Provider<LicenseRequestRepository>((ref) {
  return LicenseRequestRepository();
});

/// Repository des inscriptions.
final registrationRepositoryProvider =
    Provider<RegistrationRepository>((ref) {
  return RegistrationRepository();
});

/// Repository des Cloud Functions callables.
final callablesRepositoryProvider = Provider<CallablesRepository>((ref) {
  return CallablesRepository();
});

/// Repository des bookings — partagé.
final bookingRepositoryProvider = Provider<BookingRepository>((ref) {
  return BookingRepository();
});

// --- Flux métier ---------------------------------------------------------

/// Vue-modèle « équipe + libellé de catégorie résolu » pour l'écran d'accueil.
class CoachTeam {
  const CoachTeam({required this.team, required this.categoryName});

  final Team team;

  /// Libellé de la catégorie de l'équipe ; `null` si non résolu.
  final String? categoryName;

  String get id => team.id;
  String get name => team.name;
}

/// Référentiel de catégories indexé par id.
final categoriesByIdProvider =
    StreamProvider<Map<String, Category>>((ref) {
  final repo = ref.watch(teamRepositoryProvider);
  return repo.watchCategories().map(
        (cats) => {for (final c in cats) c.id: c},
      );
});

/// Équipes coachées par le user courant, enrichies du nom de catégorie.
///
/// Dérivé de `AppUser.teamIds` → `team_repository.watchTeamsByIds`, croisé
/// avec le référentiel de catégories.
final myTeamsProvider = StreamProvider<List<CoachTeam>>((ref) {
  final user = ref.watch(appUserProvider);
  if (user == null || user.teamIds.isEmpty) {
    return Stream<List<CoachTeam>>.value(const <CoachTeam>[]);
  }
  final teamRepo = ref.watch(teamRepositoryProvider);
  final categoriesAsync = ref.watch(categoriesByIdProvider);
  final categories = categoriesAsync.value ?? const <String, Category>{};

  return teamRepo.watchTeamsByIds(user.teamIds).map((teams) {
    return teams
        .map((t) => CoachTeam(
              team: t,
              categoryName: categories[t.categoryId]?.name,
            ))
        .toList(growable: false);
  });
});

/// Une équipe coachée par id (lecture synchrone depuis [myTeamsProvider]).
final coachTeamByIdProvider =
    Provider.family<CoachTeam?, String>((ref, teamId) {
  final teams = ref.watch(myTeamsProvider).value ?? const <CoachTeam>[];
  for (final t in teams) {
    if (t.id == teamId) return t;
  }
  return null;
});

/// Effectif (joueurs actifs) d'une équipe.
final rosterProvider =
    StreamProvider.family<List<Member>, String>((ref, teamId) {
  final coachTeam = ref.watch(coachTeamByIdProvider(teamId));
  if (coachTeam == null) {
    return Stream<List<Member>>.value(const <Member>[]);
  }
  final memberRepo = ref.watch(memberRepositoryProvider);
  return memberRepo.watchRosterForTeam(coachTeam.team);
});

/// Inscriptions d'une équipe.
final registrationsProvider =
    StreamProvider.family<List<Registration>, String>((ref, teamId) {
  final repo = ref.watch(registrationRepositoryProvider);
  return repo.watchRegistrationsForTeam(teamId);
});

/// Types de match actifs (pour le picker de match à l'extérieur).
final matchTypesProvider = StreamProvider<List<MatchType>>((ref) {
  final repo = ref.watch(matchTypeRepositoryProvider);
  return repo.watchMatchTypes().map(
        (types) => types.where((t) => t.active).toList(growable: false),
      );
});

/// Bookings de match à domicile à venir, filtrés sur l'équipe [teamId].
///
/// Sert le picker de l'écran « déplacer un match » : un coach ne peut demander
/// le déplacement que d'un match de sa propre équipe.
final homeMatchBookingsForTeamProvider =
    StreamProvider.family<List<Booking>, String>((ref, teamId) {
  final repo = ref.watch(bookingRepositoryProvider);
  return repo.watchMatchHomeBookingsUpcoming().map(
        (bookings) => bookings
            .where((b) => b.teamId == teamId)
            .toList(growable: false),
      );
});
