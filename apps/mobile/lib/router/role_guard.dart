import '../models/enums.dart';
import 'routes.dart';

/// Onglet du shell — un par capacité de l'utilisateur.
enum ShellTab { officiating, coaching, notifications }

extension ShellTabRoute on ShellTab {
  /// Chemin de l'onglet.
  String get path => switch (this) {
        ShellTab.officiating => AppRoutes.officialPath,
        ShellTab.coaching => AppRoutes.coachPath,
        ShellTab.notifications => AppRoutes.notificationsPath,
      };
}

/// Calcule l'allowlist d'onglets visibles selon les rôles de l'utilisateur.
///
/// Règles (cf. plan B4) :
/// - `official` → onglet Officiating.
/// - `coach`    → onglet Coaching.
/// - Notifications est toujours présent dès qu'au moins un rôle app existe.
/// - Les rôles sont **additifs** : un user `coach + official` voit 3 onglets.
/// - Un official-only ne voit JAMAIS l'onglet coach et inversement.
class RoleGuard {
  const RoleGuard._();

  /// Liste ordonnée des onglets autorisés pour [roles].
  ///
  /// Ordre stable : Officiating, Coaching, Notifications. Les onglets absents
  /// du set sont filtrés — l'index de branche reste cohérent côté
  /// `StatefulShellRoute` car on construit les branches dans le même ordre.
  static List<ShellTab> tabsFor(Set<UserRole> roles) {
    final tabs = <ShellTab>[];
    if (roles.contains(UserRole.official)) {
      tabs.add(ShellTab.officiating);
    }
    if (roles.contains(UserRole.coach)) {
      tabs.add(ShellTab.coaching);
    }
    // Notifications visible dès qu'on a au moins une capacité app.
    if (tabs.isNotEmpty) {
      tabs.add(ShellTab.notifications);
    }
    return tabs;
  }

  /// `true` si le user porteur de [roles] peut atteindre [path].
  ///
  /// Sert au redirect du router : un official-only qui tape `/coaching`
  /// (deep-link, restauration d'état) est redirigé vers son premier onglet.
  static bool canAccess(Set<UserRole> roles, String path) {
    final allowed = tabsFor(roles).map((t) => t.path).toSet();
    // Une route hors-shell (sign-in, orphan, splash) n'est pas gardée ici.
    final shellPaths = {
      AppRoutes.officialPath,
      AppRoutes.coachPath,
      AppRoutes.notificationsPath,
    };
    if (!shellPaths.any(path.startsWith)) return true;
    return allowed.any(path.startsWith);
  }

  /// Chemin de repli (premier onglet autorisé) pour [roles].
  ///
  /// `null` si l'utilisateur n'a aucune capacité app — cas traité en amont
  /// par l'écran orphelin / un message dédié.
  static String? landingPath(Set<UserRole> roles) {
    final tabs = tabsFor(roles);
    return tabs.isEmpty ? null : tabs.first.path;
  }
}
