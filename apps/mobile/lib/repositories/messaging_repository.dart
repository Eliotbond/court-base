import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../core/constants.dart';
import '../core/logger.dart';
import '../core/notification_deep_link.dart';
import '../firebase/firebase_refs.dart';
import '../main.dart' show localNotificationsPlugin;

/// Canaux Android créés au démarrage de l'app — `match_reminders` (rappels
/// locaux planifiés) et `push_general` (push FCM affichés en foreground).
const AndroidNotificationChannel kMatchRemindersChannel =
    AndroidNotificationChannel(
  NotificationChannels.matchReminders,
  'Rappels de match',
  description: 'Rappels 24h et 3h avant un match auquel vous êtes inscrit.',
  importance: Importance.high,
);

const AndroidNotificationChannel kPushGeneralChannel =
    AndroidNotificationChannel(
  NotificationChannels.pushGeneral,
  'Notifications du club',
  description: 'Annonces, matchs à pourvoir et messages urgents.',
  importance: Importance.high,
);

/// Repository FCM — enregistrement de token, écoute des messages, affichage
/// en foreground et deep-link à l'ouverture.
///
/// SEULE couche (avec `firebase/`) à toucher le SDK Firebase Messaging.
class MessagingRepository {
  MessagingRepository();

  final AppLogger _log = const AppLogger('MessagingRepository');

  /// Émet la cible de deep-link à ouvrir (notification tapée alors que l'app
  /// était en background ou tuée). Le `RemoteMessage` brut du SDK est traduit
  /// ici en [NotificationDeepLink] — il ne franchit pas la couche repository.
  final StreamController<NotificationDeepLink> _openedController =
      StreamController<NotificationDeepLink>.broadcast();

  /// Émet sans valeur utile quand un message push arrive — sert de signal au
  /// provider de notifications pour rafraîchir le flux Firestore.
  final StreamController<void> _refreshController =
      StreamController<void>.broadcast();

  StreamSubscription<String>? _tokenRefreshSub;
  StreamSubscription<RemoteMessage>? _onMessageSub;
  StreamSubscription<RemoteMessage>? _onOpenedSub;
  bool _channelsCreated = false;
  String? _currentUid;

  /// Stream des cibles de deep-link issues d'un tap sur notification.
  Stream<NotificationDeepLink> get onMessageOpened =>
      _openedController.stream;

  /// Stream-signal : un push est arrivé, le flux notifications peut se
  /// rafraîchir.
  Stream<void> get onPushReceived => _refreshController.stream;

  // --- Canaux Android -----------------------------------------------------

  /// Crée les canaux de notification Android haute-importance (idempotent).
  ///
  /// No-op hors Android. À appeler au démarrage ; sans canal, les notifs
  /// Android 8+ ne s'affichent pas.
  Future<void> ensureAndroidChannels() async {
    if (_channelsCreated || defaultTargetPlatform != TargetPlatform.android) {
      return;
    }
    try {
      final android =
          localNotificationsPlugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (android == null) return;
      await android.createNotificationChannel(kMatchRemindersChannel);
      await android.createNotificationChannel(kPushGeneralChannel);
      _channelsCreated = true;
    } catch (error, stack) {
      _log.warn('ensureAndroidChannels failed', error, stack);
    }
  }

  // --- Permission + enregistrement de token -------------------------------

  /// Demande la permission de notifications puis enregistre le token FCM dans
  /// `/users/{uid}/fcmTokens/{token}`.
  ///
  /// - iOS : `requestPermission` ouvre la boîte de dialogue système.
  /// - Android 13+ : `requestPermission` couvre `POST_NOTIFICATIONS`.
  /// L'écriture du token peut échouer en `permission-denied` tant que
  /// `firestore.rules` n'est pas déployé — on log sans planter.
  Future<void> requestPermissionAndRegister(String uid) async {
    _currentUid = uid;
    await ensureAndroidChannels();

    try {
      final settings = await FirebaseRefs.messaging.requestPermission();
      _log.info('FCM permission: ${settings.authorizationStatus}');
    } catch (error, stack) {
      _log.warn('requestPermission failed', error, stack);
    }

    try {
      final token = await FirebaseRefs.messaging.getToken();
      if (token != null) {
        await _writeToken(uid, token);
      } else {
        _log.warn('getToken returned null (APNs token pas encore prêt ?)');
      }
    } catch (error, stack) {
      _log.warn('getToken/_writeToken failed', error, stack);
    }

    // Re-écrit le doc token quand FCM le fait tourner.
    _tokenRefreshSub ??=
        FirebaseRefs.messaging.onTokenRefresh.listen((token) {
      final activeUid = _currentUid;
      if (activeUid == null) return;
      _writeToken(activeUid, token).catchError((Object error, StackTrace s) {
        _log.warn('onTokenRefresh write failed', error, s);
      });
    });
  }

  /// Branche les écouteurs de messages : affichage foreground + deep-link.
  /// Idempotent — un second appel ne double pas les abonnements.
  Future<void> startListening() async {
    _onMessageSub ??= FirebaseMessaging.onMessage.listen(_handleForeground);
    _onOpenedSub ??=
        FirebaseMessaging.onMessageOpenedApp.listen(_handleOpened);

    // App lancée à froid via un tap sur notification.
    try {
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) {
        _emitDeepLink(initial);
      }
    } catch (error, stack) {
      _log.warn('getInitialMessage failed', error, stack);
    }
  }

  /// Écrit (merge) le doc token. `tokenId` = la chaîne token elle-même →
  /// dédup naturelle, multi-device.
  Future<void> _writeToken(String uid, String token) async {
    final platform = defaultTargetPlatform == TargetPlatform.iOS
        ? 'ios'
        : 'android';
    try {
      await FirebaseRefs.fcmTokens(uid).doc(token).set(
        {
          'token': token,
          'platform': platform,
          'createdAt': FieldValue.serverTimestamp(),
          'lastSeenAt': FieldValue.serverTimestamp(),
        },
        SetOptions(merge: true),
      );
      _log.info('FCM token enregistré pour /users/$uid');
    } on FirebaseException catch (error, stack) {
      // `permission-denied` attendu tant que les rules ne sont pas déployées.
      _log.warn('writeToken failed [${error.code}]', error, stack);
    } catch (error, stack) {
      _log.warn('writeToken failed', error, stack);
    }
  }

  /// Supprime le doc token courant — appelé au sign-out pour ne plus pousser
  /// vers un appareil déconnecté.
  Future<void> removeToken(String uid) async {
    try {
      final token = await FirebaseRefs.messaging.getToken();
      if (token != null) {
        await FirebaseRefs.fcmTokens(uid).doc(token).delete();
      }
      await FirebaseRefs.messaging.deleteToken();
    } catch (error, stack) {
      _log.warn('removeToken failed', error, stack);
    } finally {
      _currentUid = null;
    }
  }

  // --- Handlers -----------------------------------------------------------

  /// Foreground : FCM n'affiche pas de notif système → on la rend nous-mêmes
  /// via `flutter_local_notifications`, puis on signale un refresh.
  void _handleForeground(RemoteMessage message) {
    _log.info('foreground push: ${message.messageId}');
    _refreshController.add(null);

    final notification = message.notification;
    if (notification == null) return;

    final androidDetails = AndroidNotificationDetails(
      kPushGeneralChannel.id,
      kPushGeneralChannel.name,
      channelDescription: kPushGeneralChannel.description,
      importance: Importance.high,
      priority: Priority.high,
    );
    const darwinDetails = DarwinNotificationDetails();
    final details = NotificationDetails(
      android: androidDetails,
      iOS: darwinDetails,
    );

    final notificationId =
        message.messageId?.hashCode ?? DateTime.now().millisecondsSinceEpoch;
    localNotificationsPlugin
        .show(
          notificationId,
          notification.title,
          notification.body,
          details,
          payload: _payloadFor(message),
        )
        .catchError((Object error, StackTrace s) {
      _log.warn('foreground show failed', error, s);
    });
  }

  /// Notification tapée alors que l'app tournait en background.
  void _handleOpened(RemoteMessage message) {
    _log.info('opened from background: ${message.messageId}');
    _emitDeepLink(message);
  }

  /// Traduit un `RemoteMessage` en [NotificationDeepLink] et l'émet si une
  /// cible exploitable est présente. Sans cible → message ignoré.
  void _emitDeepLink(RemoteMessage message) {
    final link = NotificationDeepLink.fromData(message.data);
    if (link != null) {
      _openedController.add(link);
    }
  }

  /// Construit un payload string compact (`type:id`) pour la notification
  /// locale affichée en foreground, à partir des `data` du message.
  static String? _payloadFor(RemoteMessage message) {
    final link = NotificationDeepLink.fromData(message.data);
    return link == null ? null : '${link.kind.name}:${link.id}';
  }

  /// Libère les abonnements — appelé à la disposition du provider.
  Future<void> dispose() async {
    await _tokenRefreshSub?.cancel();
    await _onMessageSub?.cancel();
    await _onOpenedSub?.cancel();
    await _openedController.close();
    await _refreshController.close();
  }
}
