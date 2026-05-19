import 'package:go_router/go_router.dart';

import '../../models/official_assignment.dart';
import 'match_detail_screen.dart';
import 'my_assignments_screen.dart';

/// Routes de la branche officiel du shell.
///
/// La racine de la branche (`AppRoutes.officialPath` = `/officiating`) est
/// déclarée par le routeur parent avec `OfficialHomeScreen` comme builder ;
/// ce fichier n'exporte que les **sous-routes** ([officialRoutes]) à splicer
/// dans le `routes:` de cette `GoRoute` racine.
///
/// Chemins relatifs (pas de `/` initial) → résolus sous `/officiating`.
class OfficialRoutes {
  const OfficialRoutes._();

  // --- Sous-chemins (relatifs à /officiating) -----------------------------

  /// Liste des assignations de l'officiel — `/officiating/assignments`.
  static const String myAssignmentsRelative = 'assignments';

  /// Détail d'un match — `/officiating/match/:kind/:id`.
  ///
  /// `:kind` ∈ {`booking`, `match`} (le type de parent d'assignation),
  /// `:id` = id du booking ou du match.
  static const String matchDetailRelative = 'match/:kind/:id';

  // --- Noms ---------------------------------------------------------------

  static const String myAssignments = 'official-assignments';
  static const String matchDetail = 'official-match-detail';

  // --- Helpers de navigation ---------------------------------------------

  /// Chemin absolu du détail d'un match, pour `context.go(...)`.
  static String matchDetailLocation({
    required OfficialAssignmentParent kind,
    required String id,
  }) =>
      '/officiating/match/${kind.name}/$id';

  /// Chemin absolu de la liste des assignations.
  static const String myAssignmentsLocation = '/officiating/assignments';
}

/// Sous-routes de la branche officiel — à splicer sous la `GoRoute` racine
/// `/officiating` par le routeur parent.
final List<RouteBase> officialRoutes = <RouteBase>[
  GoRoute(
    path: OfficialRoutes.myAssignmentsRelative,
    name: OfficialRoutes.myAssignments,
    builder: (context, state) => const MyAssignmentsScreen(),
  ),
  GoRoute(
    path: OfficialRoutes.matchDetailRelative,
    name: OfficialRoutes.matchDetail,
    builder: (context, state) {
      final kindParam = state.pathParameters['kind'] ?? 'booking';
      final id = state.pathParameters['id'] ?? '';
      final kind = kindParam == 'match'
          ? OfficialAssignmentParent.match
          : OfficialAssignmentParent.booking;
      return MatchDetailScreen(parentKind: kind, parentId: id);
    },
  ),
];
