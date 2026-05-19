// Tests de logique pure côté notifications :
// - calcul du compteur de non-lues (cf. `unreadCountProvider`),
// - dérivation déterministe des ids de rappels locaux.
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:courtbase_mobile/models/app_notification.dart';
import 'package:courtbase_mobile/repositories/local_notification_repository.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reproduit le calcul de `unreadCountProvider` : une notification est non lue
/// si l'uid courant n'est pas dans `readBy`.
int unreadCountFor(String uid, List<AppNotification> notifications) =>
    notifications.where((n) => !n.isReadBy(uid)).length;

AppNotification _notif(String id, List<String> readBy) =>
    AppNotification.fromMap(id, {
      'type': 'new_match',
      'title': 't',
      'body': 'b',
      'createdAt': Timestamp.fromDate(DateTime.utc(2026, 1, 1)),
      'readBy': readBy,
    });

void main() {
  group('unreadCount — compte des notifications non lues', () {
    test('liste vide -> 0', () {
      expect(unreadCountFor('uid-1', const []), 0);
    });

    test('aucune lue par l\'uid -> tout est non lu', () {
      final notifs = [
        _notif('n1', const []),
        _notif('n2', const ['autre-uid']),
        _notif('n3', const ['x', 'y']),
      ];
      expect(unreadCountFor('uid-1', notifs), 3);
    });

    test('certaines lues par l\'uid courant', () {
      final notifs = [
        _notif('n1', const ['uid-1']), // lue
        _notif('n2', const ['autre']), // non lue
        _notif('n3', const ['uid-1', 'autre']), // lue
      ];
      expect(unreadCountFor('uid-1', notifs), 1);
    });

    test('toutes lues -> 0', () {
      final notifs = [
        _notif('n1', const ['uid-1']),
        _notif('n2', const ['uid-1']),
      ];
      expect(unreadCountFor('uid-1', notifs), 0);
    });
  });

  group('LocalNotificationRepository.reminderId — ids déterministes', () {
    test('même clé + suffixe -> même id (stable entre appels)', () {
      final a = LocalNotificationRepository.reminderId('match-42', '24h');
      final b = LocalNotificationRepository.reminderId('match-42', '24h');
      expect(a, b);
    });

    test('les deux rappels d\'un match ont des ids distincts', () {
      final id24 = LocalNotificationRepository.reminderId('match-42', '24h');
      final id3 = LocalNotificationRepository.reminderId('match-42', '3h');
      expect(id24, isNot(id3));
    });

    test('deux matchs différents -> ids différents', () {
      final a = LocalNotificationRepository.reminderId('match-a', '24h');
      final b = LocalNotificationRepository.reminderId('match-b', '24h');
      expect(a, isNot(b));
    });

    test('id toujours positif et sur 32 bits (contrainte plateforme)', () {
      for (final key in ['x', 'match-99', 'bk_abc-123', 'éàü']) {
        for (final suffix in ['24h', '3h']) {
          final id = LocalNotificationRepository.reminderId(key, suffix);
          expect(id, greaterThanOrEqualTo(0));
          expect(id, lessThanOrEqualTo(0x7fffffff));
        }
      }
    });
  });
}
