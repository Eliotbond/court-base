import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import 'app.dart';
import 'core/constants.dart';
import 'core/logger.dart';
import 'firebase/firebase_bootstrap.dart';

/// Plugin partagé de notifications locales (rappels de match offline).
final FlutterLocalNotificationsPlugin localNotificationsPlugin =
    FlutterLocalNotificationsPlugin();

/// Handler FCM en arrière-plan.
///
/// Doit être une fonction top-level annotée `@pragma('vm:entry-point')`
/// (isolate séparé). On ré-initialise Firebase ici car l'isolate
/// d'arrière-plan ne partage pas l'état de l'isolate principal.
///
/// Quand le `RemoteMessage` porte un bloc `notification`, le système Android /
/// iOS affiche déjà la bannière tout seul — on ne ré-affiche donc rien ici
/// pour éviter un doublon. Les messages purement `data` (sans `notification`)
/// sont juste tracés ; ils sont retraités au prochain démarrage de l'app via
/// `getInitialMessage` / `onMessageOpenedApp`.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp(options: firebaseOptionsForCurrentClient());
  } catch (error, stack) {
    const AppLogger('FCM/bg').warn('Firebase init failed', error, stack);
  }
  const AppLogger('FCM/bg').info(
    'background message: ${message.messageId} '
    '(notification=${message.notification != null})',
  );
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Firebase.
  await Firebase.initializeApp(options: firebaseOptionsForCurrentClient());

  // 2. Données de locale `intl` (formatage de dates FR).
  await initializeDateFormatting(kAppLocale);

  // 3. Fuseau horaire — base des rappels locaux planifiés (`zonedSchedule`).
  await _initTimeZone();

  // 4. Notifications locales.
  await _initLocalNotifications();

  // 5. Handler FCM d'arrière-plan (enregistré avant runApp).
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

  runApp(const ProviderScope(child: CourtbaseApp()));
}

/// Initialise la base de données timezone et fixe la zone locale de l'appareil.
Future<void> _initTimeZone() async {
  tz_data.initializeTimeZones();
  try {
    final localTz = await FlutterTimezone.getLocalTimezone();
    tz.setLocalLocation(tz.getLocation(localTz.identifier));
  } catch (error, stack) {
    // Repli sur la zone du club si la détection échoue.
    const AppLogger('boot').warn('timezone detection failed', error, stack);
    tz.setLocalLocation(tz.getLocation(kDefaultTimeZone));
  }
}

/// Initialise le plugin de notifications locales (settings Android + iOS).
Future<void> _initLocalNotifications() async {
  const androidSettings =
      AndroidInitializationSettings('@mipmap/ic_launcher');
  const darwinSettings = DarwinInitializationSettings(
    // Les permissions iOS sont demandées explicitement après login (B7).
    requestAlertPermission: false,
    requestBadgePermission: false,
    requestSoundPermission: false,
  );
  const settings = InitializationSettings(
    android: androidSettings,
    iOS: darwinSettings,
  );

  try {
    await localNotificationsPlugin.initialize(settings);
  } catch (error, stack) {
    const AppLogger('boot')
        .warn('local notifications init failed', error, stack);
  }
}
