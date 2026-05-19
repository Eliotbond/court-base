import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/timezone.dart' as tz;

import '../core/constants.dart';
import '../core/logger.dart';

/// Repository des notifications locales — rappels de match planifiés sur
/// l'appareil (offline, indépendants de FCM).
///
/// Le plugin `FlutterLocalNotificationsPlugin` est initialisé dans `main.dart`
/// (settings Android + iOS) ; ce repository ne fait qu'orchestrer la
/// planification / l'annulation.
///
/// **Stratégie Android 14+** : on planifie en mode *inexact*
/// (`AndroidScheduleMode.inexactAllowWhileIdle`) pour éviter la permission
/// `SCHEDULE_EXACT_ALARM` — un rappel de match tolère parfaitement quelques
/// minutes de dérive.
class LocalNotificationRepository {
  LocalNotificationRepository(this._plugin);

  final FlutterLocalNotificationsPlugin _plugin;

  final AppLogger _log = const AppLogger('LocalNotificationRepository');

  /// Décalages des rappels avant le coup d'envoi.
  static const Duration _reminder24h = Duration(hours: 24);
  static const Duration _reminder3h = Duration(hours: 3);

  /// Planifie les deux rappels (24h / 3h avant) pour un match.
  ///
  /// [matchKey] identifie le match de façon stable (booking id ou match id) :
  /// il sert à dériver des ids de notification déterministes pour pouvoir les
  /// annuler ensuite. Un rappel dont l'échéance est déjà passée est ignoré.
  Future<void> scheduleMatchReminders({
    required String matchKey,
    required DateTime matchStart,
    String title = 'Rappel de match',
    String? body,
  }) async {
    final now = DateTime.now();
    final at24h = matchStart.subtract(_reminder24h);
    final at3h = matchStart.subtract(_reminder3h);

    await _scheduleOne(
      id: reminderId(matchKey, '24h'),
      when: at24h,
      now: now,
      title: title,
      body: body ?? 'Votre match a lieu demain.',
    );
    await _scheduleOne(
      id: reminderId(matchKey, '3h'),
      when: at3h,
      now: now,
      title: title,
      body: body ?? 'Votre match commence dans 3 heures.',
    );
  }

  /// Annule les deux rappels associés à [matchKey] (ex. sur un decline).
  Future<void> cancelMatchReminders(String matchKey) async {
    try {
      await _plugin.cancel(reminderId(matchKey, '24h'));
      await _plugin.cancel(reminderId(matchKey, '3h'));
    } catch (error, stack) {
      _log.warn('cancelMatchReminders failed [$matchKey]', error, stack);
    }
  }

  /// Planifie une notification unique si son échéance est dans le futur.
  Future<void> _scheduleOne({
    required int id,
    required DateTime when,
    required DateTime now,
    required String title,
    required String body,
  }) async {
    if (!when.isAfter(now)) {
      _log.debug('reminder $id ignoré (échéance passée)');
      return;
    }
    try {
      await _plugin.zonedSchedule(
        id,
        title,
        body,
        tz.TZDateTime.from(when, tz.local),
        _details,
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      );
    } catch (error, stack) {
      _log.warn('zonedSchedule failed [$id]', error, stack);
    }
  }

  /// Détails de présentation — canal `match_reminders` (haute priorité).
  static const NotificationDetails _details = NotificationDetails(
    android: AndroidNotificationDetails(
      NotificationChannels.matchReminders,
      'Rappels de match',
      channelDescription:
          'Rappels planifiés avant les matchs auxquels vous êtes inscrit.',
      importance: Importance.high,
      priority: Priority.high,
    ),
    iOS: DarwinNotificationDetails(),
  );

  /// id de notification déterministe dérivé de [matchKey] + [suffix].
  ///
  /// Doit tenir sur un `int` 32 bits positif (contrainte plateforme) — on
  /// masque le bit de signe. Exposé pour les tests : la stabilité de la
  /// dérivation est ce qui permet d'annuler les rappels plus tard.
  @visibleForTesting
  static int reminderId(String matchKey, String suffix) {
    return '${matchKey}_$suffix'.hashCode & 0x7fffffff;
  }
}
