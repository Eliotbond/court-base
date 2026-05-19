// Tests de `NotificationDeepLink` — dérivation de la cible de deep-link
// depuis les `data` d'un message push. Logique pure.
import 'package:courtbase_mobile/core/notification_deep_link.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('NotificationDeepLink.fromData', () {
    test('relatedMatchId -> cible match', () {
      final link = NotificationDeepLink.fromData({'relatedMatchId': 'm1'});
      expect(link, isNotNull);
      expect(link!.kind, NotificationTargetKind.match);
      expect(link.id, 'm1');
    });

    test('relatedBookingId -> cible booking', () {
      final link = NotificationDeepLink.fromData({'relatedBookingId': 'b9'});
      expect(link, isNotNull);
      expect(link!.kind, NotificationTargetKind.booking);
      expect(link.id, 'b9');
    });

    test('le match a priorité sur le booking si les deux sont présents', () {
      final link = NotificationDeepLink.fromData({
        'relatedMatchId': 'm1',
        'relatedBookingId': 'b1',
      });
      expect(link!.kind, NotificationTargetKind.match);
      expect(link.id, 'm1');
    });

    test('data vide -> null', () {
      expect(NotificationDeepLink.fromData(const {}), isNull);
    });

    test('id vide -> null', () {
      expect(
        NotificationDeepLink.fromData({'relatedMatchId': ''}),
        isNull,
      );
    });

    test('id non-string -> null', () {
      expect(
        NotificationDeepLink.fromData({'relatedMatchId': 42}),
        isNull,
      );
    });
  });

  group('NotificationDeepLink — égalité de valeur', () {
    test('même kind + id sont égaux', () {
      const a = NotificationDeepLink(
        kind: NotificationTargetKind.match,
        id: 'x',
      );
      const b = NotificationDeepLink(
        kind: NotificationTargetKind.match,
        id: 'x',
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('kind différent -> non égaux', () {
      const a = NotificationDeepLink(
        kind: NotificationTargetKind.match,
        id: 'x',
      );
      const b = NotificationDeepLink(
        kind: NotificationTargetKind.booking,
        id: 'x',
      );
      expect(a, isNot(b));
    });
  });
}
