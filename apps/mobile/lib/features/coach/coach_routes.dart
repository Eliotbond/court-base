import 'package:go_router/go_router.dart';

import '../../router/routes.dart';
import 'away_match_form_screen.dart';
import 'license_request_screen.dart';
import 'member_form_screen.dart';
import 'move_home_request_screen.dart';
import 'registrations_screen.dart';
import 'roster_screen.dart';

/// Chemins et noms de routes de la slice COACH.
///
/// Les sous-routes sont relatives à la racine de la branche coach
/// (`AppRoutes.coachPath` = `/coaching`) — la racine elle-même est servie par
/// `CoachHomeScreen` (cf. `app_router.dart`). Ce fichier expose [coachRoutes]
/// pour brancher ces enfants sous la branche coach du `StatefulShellRoute`.
class CoachRoutes {
  const CoachRoutes._();

  /// Effectif d'une équipe — `/coaching/teams/:teamId/roster`.
  static const String rosterName = 'coach-roster';
  static const String rosterPath = 'teams/:teamId/roster';

  /// Création d'un membre — `/coaching/teams/:teamId/members/new`.
  static const String memberCreateName = 'coach-member-create';
  static const String memberCreatePath = 'teams/:teamId/members/new';

  /// Édition d'un membre — `/coaching/teams/:teamId/members/:memberId/edit`.
  static const String memberEditName = 'coach-member-edit';
  static const String memberEditPath = 'teams/:teamId/members/:memberId/edit';

  /// Création d'un match à l'extérieur — `/coaching/teams/:teamId/away-match`.
  static const String awayMatchName = 'coach-away-match';
  static const String awayMatchPath = 'teams/:teamId/away-match';

  /// Demande de déplacement d'un match — `/coaching/teams/:teamId/move-home`.
  static const String moveHomeName = 'coach-move-home';
  static const String moveHomePath = 'teams/:teamId/move-home';

  /// Demande de licence — `/coaching/teams/:teamId/license-request`.
  static const String licenseRequestName = 'coach-license-request';
  static const String licenseRequestPath = 'teams/:teamId/license-request';

  /// Inscriptions d'une équipe — `/coaching/teams/:teamId/registrations`.
  static const String registrationsName = 'coach-registrations';
  static const String registrationsPath = 'teams/:teamId/registrations';

  // --- Helpers de navigation (chemins absolus, pour `context.go`) ----------

  /// Effectif d'une équipe — `/coaching/teams/:teamId/roster`.
  static String rosterLocation(String teamId) =>
      '${AppRoutes.coachPath}/teams/$teamId/roster';

  /// Création d'un membre — `/coaching/teams/:teamId/members/new`.
  static String memberCreateLocation(String teamId) =>
      '${AppRoutes.coachPath}/teams/$teamId/members/new';

  /// Édition d'un membre — `/coaching/teams/:teamId/members/:memberId/edit`.
  static String memberEditLocation(String teamId, String memberId) =>
      '${AppRoutes.coachPath}/teams/$teamId/members/$memberId/edit';

  /// Match à l'extérieur — `/coaching/teams/:teamId/away-match`.
  static String awayMatchLocation(String teamId) =>
      '${AppRoutes.coachPath}/teams/$teamId/away-match';

  /// Déplacement d'un match — `/coaching/teams/:teamId/move-home`.
  static String moveHomeLocation(String teamId) =>
      '${AppRoutes.coachPath}/teams/$teamId/move-home';

  /// Demande de licence — `/coaching/teams/:teamId/license-request`.
  ///
  /// [memberId] optionnel : pré-sélectionne un joueur via le query param
  /// `member` (`?member=<id>`).
  static String licenseRequestLocation(String teamId, {String? memberId}) {
    final base = '${AppRoutes.coachPath}/teams/$teamId/license-request';
    return memberId == null ? base : '$base?member=$memberId';
  }

  /// Inscriptions d'une équipe — `/coaching/teams/:teamId/registrations`.
  static String registrationsLocation(String teamId) =>
      '${AppRoutes.coachPath}/teams/$teamId/registrations';
}

/// Sous-routes de la branche coach — à insérer dans les `routes` de la branche
/// coach du `StatefulShellRoute` (cf. `app_router.dart`).
final List<RouteBase> coachRoutes = <RouteBase>[
  GoRoute(
    path: CoachRoutes.rosterPath,
    name: CoachRoutes.rosterName,
    builder: (context, state) => RosterScreen(
      teamId: state.pathParameters['teamId'] ?? '',
    ),
  ),
  GoRoute(
    path: CoachRoutes.memberCreatePath,
    name: CoachRoutes.memberCreateName,
    builder: (context, state) => MemberFormScreen(
      teamId: state.pathParameters['teamId'] ?? '',
    ),
  ),
  GoRoute(
    path: CoachRoutes.memberEditPath,
    name: CoachRoutes.memberEditName,
    builder: (context, state) => MemberFormScreen(
      teamId: state.pathParameters['teamId'] ?? '',
      memberId: state.pathParameters['memberId'],
    ),
  ),
  GoRoute(
    path: CoachRoutes.awayMatchPath,
    name: CoachRoutes.awayMatchName,
    builder: (context, state) => AwayMatchFormScreen(
      teamId: state.pathParameters['teamId'] ?? '',
    ),
  ),
  GoRoute(
    path: CoachRoutes.moveHomePath,
    name: CoachRoutes.moveHomeName,
    builder: (context, state) => MoveHomeRequestScreen(
      teamId: state.pathParameters['teamId'] ?? '',
    ),
  ),
  GoRoute(
    path: CoachRoutes.licenseRequestPath,
    name: CoachRoutes.licenseRequestName,
    builder: (context, state) => LicenseRequestScreen(
      teamId: state.pathParameters['teamId'] ?? '',
      preselectedMemberId: state.uri.queryParameters['member'],
    ),
  ),
  GoRoute(
    path: CoachRoutes.registrationsPath,
    name: CoachRoutes.registrationsName,
    builder: (context, state) => RegistrationsScreen(
      teamId: state.pathParameters['teamId'] ?? '',
    ),
  ),
];
