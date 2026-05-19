import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/app_user.dart';

/// État du document `/users/{uid}` pour un compte authentifié.
///
/// Trois cas distincts (cf. plan B4 — deny-orphan) :
/// - [AppUserResolved] : le doc existe et est valide.
/// - [AppUserOrphan]   : signed-in mais aucun `/users/{uid}` → compte orphelin.
/// - [AppUserError]    : la lecture a échoué (réseau, rules…).
sealed class AppUserState {
  const AppUserState();
}

/// Le doc `/users/{uid}` existe — compte applicatif valide.
final class AppUserResolved extends AppUserState {
  const AppUserResolved(this.user);

  final AppUser user;
}

/// Signed-in sans doc `/users/{uid}` — compte orphelin (deny-orphan).
final class AppUserOrphan extends AppUserState {
  const AppUserOrphan(this.uid);

  final String uid;
}

/// La lecture du doc a échoué.
final class AppUserError extends AppUserState {
  const AppUserError(this.failure);

  final AppException failure;
}

/// Repository d'accès au document `/users/{uid}`.
class UserRepository {
  UserRepository();

  final AppLogger _log = const AppLogger('UserRepository');

  /// Observe `/users/{uid}` en continu et émet un [AppUserState].
  ///
  /// Émet [AppUserOrphan] quand le document est absent (compte authentifié
  /// mais jamais provisionné — l'app affiche alors `OrphanAccountScreen`).
  /// Les erreurs (réseau, rules, parsing) sont mappées en [AppUserError]
  /// plutôt que de propager une exception qui casserait le `StreamProvider`.
  Stream<AppUserState> watchUser(String uid) async* {
    final stream = FirebaseRefs.userDoc(uid).snapshots();
    await for (final event in stream.handleErrorAsState(_log, uid)) {
      yield event;
    }
  }

  /// Lecture ponctuelle de `/users/{uid}`. `null` si le doc n'existe pas.
  Future<AppUser?> getUser(String uid) async {
    try {
      final snapshot = await FirebaseRefs.userDoc(uid).get();
      if (!snapshot.exists || snapshot.data() == null) return null;
      return AppUser.fromFirestore(snapshot);
    } catch (error, stack) {
      _log.error('getUser failed for /users/$uid', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
  }
}

/// Conversion d'un stream de snapshots `/users/{uid}` en flux d'[AppUserState],
/// avec capture des erreurs.
extension on Stream<DocumentSnapshot<Map<String, dynamic>>> {
  Stream<AppUserState> handleErrorAsState(AppLogger log, String uid) {
    return transform(
      StreamTransformer<DocumentSnapshot<Map<String, dynamic>>,
          AppUserState>.fromHandlers(
        handleData: (snapshot, sink) {
          if (!snapshot.exists || snapshot.data() == null) {
            log.warn('watchUser: doc /users/$uid absent → orphan');
            sink.add(AppUserOrphan(uid));
            return;
          }
          try {
            sink.add(AppUserResolved(AppUser.fromFirestore(snapshot)));
          } catch (error, stack) {
            log.error('watchUser: parsing /users/$uid failed', error, stack);
            sink.add(AppUserError(AppException.fromFirebase(error, stack)));
          }
        },
        handleError: (error, stack, sink) {
          log.error('watchUser: stream error for /users/$uid', error, stack);
          sink.add(AppUserError(AppException.fromFirebase(error, stack)));
        },
      ),
    );
  }
}
