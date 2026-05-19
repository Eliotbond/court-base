import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_providers.dart';
import '../../providers/notification_providers.dart';
import '../../router/role_guard.dart';

/// Description statique d'un onglet du shell.
class _TabSpec {
  const _TabSpec({
    required this.tab,
    required this.branchIndex,
    required this.icon,
    required this.selectedIcon,
    required this.label,
  });

  final ShellTab tab;

  /// Index de la branche correspondante dans le `StatefulShellRoute`.
  /// Ordre fixe : 0 officiating, 1 coaching, 2 notifications.
  final int branchIndex;
  final IconData icon;
  final IconData selectedIcon;
  final String label;
}

const List<_TabSpec> _allTabs = [
  _TabSpec(
    tab: ShellTab.officiating,
    branchIndex: 0,
    icon: Icons.sports_outlined,
    selectedIcon: Icons.sports,
    label: 'Officiel',
  ),
  _TabSpec(
    tab: ShellTab.coaching,
    branchIndex: 1,
    icon: Icons.groups_outlined,
    selectedIcon: Icons.groups,
    label: 'Coach',
  ),
  _TabSpec(
    tab: ShellTab.notifications,
    branchIndex: 2,
    icon: Icons.notifications_none,
    selectedIcon: Icons.notifications,
    label: 'Alertes',
  ),
];

/// Coquille principale de l'app — `NavigationBar` dont les onglets dérivent
/// du set de rôles de l'utilisateur.
///
/// Le `StatefulShellRoute` possède toujours 3 branches (ordre fixe). Le shell
/// n'affiche que les onglets autorisés par [RoleGuard] et mappe l'index
/// visible de la barre vers l'index de branche réel.
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.navigationShell});

  /// Shell fourni par `StatefulShellRoute.indexedStack`.
  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final roles = ref.watch(currentRolesProvider);
    final allowedTabs = RoleGuard.tabsFor(roles);

    // Démarre l'enregistrement FCM (permission + token + écouteurs) dès que
    // le shell est monté sous une session valide. `watch` garde le provider
    // en vie le temps de la session.
    ref.watch(fcmInitProvider);

    // Compteur de notifications non lues — alimente le badge de l'onglet.
    final unreadCount = ref.watch(unreadCountProvider);

    // Onglets visibles, dans l'ordre de RoleGuard.
    final visibleSpecs = _allTabs
        .where((spec) => allowedTabs.contains(spec.tab))
        .toList(growable: false);

    // Cas limite : aucune capacité app. Le redirect du router empêche en
    // principe d'arriver ici, mais on rend un fallback sûr.
    if (visibleSpecs.isEmpty) {
      return const Scaffold(
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(32),
            child: Text(
              'Aucun espace disponible pour votre compte.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }

    // Index visible (barre) sélectionné = position du spec dont la branche
    // est active.
    var selectedVisibleIndex = visibleSpecs.indexWhere(
      (spec) => spec.branchIndex == navigationShell.currentIndex,
    );
    if (selectedVisibleIndex < 0) selectedVisibleIndex = 0;

    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedVisibleIndex,
        onDestinationSelected: (visibleIndex) {
          final branchIndex = visibleSpecs[visibleIndex].branchIndex;
          navigationShell.goBranch(
            branchIndex,
            // Re-tap sur l'onglet actif → retour à la racine de la branche.
            initialLocation:
                branchIndex == navigationShell.currentIndex,
          );
        },
        destinations: visibleSpecs
            .map(
              (spec) => NavigationDestination(
                icon: _withBadge(
                  spec: spec,
                  unreadCount: unreadCount,
                  child: Icon(spec.icon),
                ),
                selectedIcon: _withBadge(
                  spec: spec,
                  unreadCount: unreadCount,
                  child: Icon(spec.selectedIcon),
                ),
                label: spec.label,
              ),
            )
            .toList(growable: false),
      ),
    );
  }

  /// Décore l'icône d'un onglet d'un badge de non-lus — uniquement sur
  /// l'onglet Notifications et si [unreadCount] > 0.
  Widget _withBadge({
    required _TabSpec spec,
    required int unreadCount,
    required Widget child,
  }) {
    if (spec.tab != ShellTab.notifications || unreadCount <= 0) {
      return child;
    }
    return Badge(
      label: Text(unreadCount > 99 ? '99+' : '$unreadCount'),
      child: child,
    );
  }
}
