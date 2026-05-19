// Tests unitaires de fondation — couvrent la logique pure qui ne dépend pas
// de Firebase (le boot Firebase n'est pas testable sans config réelle).
import 'package:courtbase_mobile/models/enums.dart';
import 'package:courtbase_mobile/router/role_guard.dart';
import 'package:courtbase_mobile/router/routes.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('enums — parsing tolérant', () {
    test('valeur connue', () {
      expect(DuesStatus.fromWire('overdue'), DuesStatus.overdue);
      expect(DuesStatus.fromWire('pending_grace'), DuesStatus.pendingGrace);
      expect(MatchKind.fromWire('away'), MatchKind.away);
    });

    test('valeur inconnue → repli', () {
      expect(DuesStatus.fromWire('???'), DuesStatus.na);
      expect(MatchStatus.fromWire(null), MatchStatus.scheduled);
    });

    test('UserRole.fromWire renvoie null pour un rôle custom', () {
      expect(UserRole.fromWire('coach'), UserRole.coach);
      expect(UserRole.fromWire('custom_role'), isNull);
    });
  });

  group('RoleGuard — allowlist par rôle', () {
    test('official-only voit Officiel + Notifications', () {
      final tabs = RoleGuard.tabsFor({UserRole.official});
      expect(tabs, [ShellTab.officiating, ShellTab.notifications]);
    });

    test('coach-only voit Coach + Notifications', () {
      final tabs = RoleGuard.tabsFor({UserRole.coach});
      expect(tabs, [ShellTab.coaching, ShellTab.notifications]);
    });

    test('coach + official voit les 3 onglets', () {
      final tabs = RoleGuard.tabsFor({UserRole.coach, UserRole.official});
      expect(tabs, [
        ShellTab.officiating,
        ShellTab.coaching,
        ShellTab.notifications,
      ]);
    });

    test('aucun rôle app → aucun onglet, landingPath null', () {
      expect(RoleGuard.tabsFor(const {}), isEmpty);
      expect(RoleGuard.landingPath(const {}), isNull);
    });

    test('official-only ne peut pas atteindre /coaching', () {
      const roles = {UserRole.official};
      expect(RoleGuard.canAccess(roles, AppRoutes.coachPath), isFalse);
      expect(RoleGuard.canAccess(roles, AppRoutes.officialPath), isTrue);
    });

    test('routes hors-shell ne sont pas gardées', () {
      expect(
        RoleGuard.canAccess(const {UserRole.official}, AppRoutes.signInPath),
        isTrue,
      );
    });
  });
}
