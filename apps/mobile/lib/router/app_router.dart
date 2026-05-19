import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/orphan_account_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/auth/splash_screen.dart';
import '../features/coach/coach_home_screen.dart';
import '../features/coach/coach_routes.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/official/official_home_screen.dart';
import '../features/official/official_routes.dart';
import '../features/shell/home_shell.dart';
import '../providers/auth_providers.dart';
import 'role_guard.dart';
import 'routes.dart';

/// Clés de navigateur — racine + une par branche du shell.
final _rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');
final _officialNavKey = GlobalKey<NavigatorState>(debugLabel: 'official');
final _coachNavKey = GlobalKey<NavigatorState>(debugLabel: 'coach');
final _notificationsNavKey =
    GlobalKey<NavigatorState>(debugLabel: 'notifications');

/// Adapte un provider Riverpod en [Listenable] pour `GoRouter.refreshListenable`.
///
/// GoRouter ré-évalue son `redirect` à chaque `notifyListeners()` — on
/// notifie donc dès que [sessionStateProvider] change.
class _RouterRefreshNotifier extends ChangeNotifier {
  _RouterRefreshNotifier(this._ref) {
    _subscription = _ref.listen<AsyncValue<SessionState>>(
      sessionStateProvider,
      (_, __) => notifyListeners(),
      fireImmediately: false,
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AsyncValue<SessionState>> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}

/// Notifier de rafraîchissement du router.
final _routerRefreshProvider = Provider<_RouterRefreshNotifier>((ref) {
  final notifier = _RouterRefreshNotifier(ref);
  ref.onDispose(notifier.dispose);
  return notifier;
});

/// `GoRouter` de l'application — redirect branché sur l'état de session,
/// shell à onglets dérivés des rôles.
final goRouterProvider = Provider<GoRouter>((ref) {
  final refresh = ref.watch(_routerRefreshProvider);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: AppRoutes.splashPath,
    refreshListenable: refresh,
    debugLogDiagnostics: kDebugMode,
    redirect: (context, state) {
      final session = ref.read(sessionStateProvider);
      final location = state.matchedLocation;

      // Session encore en cours de résolution → splash.
      if (session.isLoading) {
        return location == AppRoutes.splashPath
            ? null
            : AppRoutes.splashPath;
      }

      // Erreur de résolution → on traite comme déconnecté (écran sign-in).
      final sessionState = session.value;
      if (sessionState == null || sessionState is SessionSignedOut) {
        return location == AppRoutes.signInPath
            ? null
            : AppRoutes.signInPath;
      }

      // Compte orphelin → écran dédié.
      if (sessionState is SessionOrphan) {
        return location == AppRoutes.orphanPath
            ? null
            : AppRoutes.orphanPath;
      }

      // Session valide.
      if (sessionState is SessionValid) {
        final roles = sessionState.user.knownRoles;
        final landing = RoleGuard.landingPath(roles);

        // Sortie des écrans hors-app (splash / sign-in / orphan) → home.
        final atAuthGate = location == AppRoutes.splashPath ||
            location == AppRoutes.signInPath ||
            location == AppRoutes.orphanPath;
        if (atAuthGate) {
          return landing ?? AppRoutes.notificationsPath;
        }

        // Garde par rôle : un official-only ne peut pas atteindre /coaching
        // et inversement.
        if (!RoleGuard.canAccess(roles, location)) {
          return landing ?? AppRoutes.notificationsPath;
        }
      }

      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.splashPath,
        name: AppRoutes.splash,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.signInPath,
        name: AppRoutes.signIn,
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: AppRoutes.orphanPath,
        name: AppRoutes.orphan,
        builder: (context, state) => const OrphanAccountScreen(),
      ),
      // Shell à 3 branches (ordre fixe : officiel, coach, notifications).
      // Les onglets visibles sont filtrés par HomeShell selon les rôles.
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            HomeShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            navigatorKey: _officialNavKey,
            routes: [
              GoRoute(
                path: AppRoutes.officialPath,
                name: AppRoutes.official,
                builder: (context, state) => const OfficialHomeScreen(),
                routes: officialRoutes,
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _coachNavKey,
            routes: [
              GoRoute(
                path: AppRoutes.coachPath,
                name: AppRoutes.coach,
                builder: (context, state) => const CoachHomeScreen(),
                routes: coachRoutes,
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _notificationsNavKey,
            routes: [
              GoRoute(
                path: AppRoutes.notificationsPath,
                name: AppRoutes.notifications,
                builder: (context, state) => const NotificationsScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});
