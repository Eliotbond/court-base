import 'dart:math';

import 'package:crypto/crypto.dart' show sha256;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';

/// Repository d'authentification — encapsule Firebase Auth, Google Sign-In et
/// Sign in with Apple. SEULE couche (avec `firebase/`) à importer ces SDK.
class AuthRepository {
  AuthRepository();

  final AppLogger _log = const AppLogger('AuthRepository');

  bool _googleInitialized = false;

  /// Stream de l'uid Firebase authentifié. `null` = déconnecté.
  ///
  /// Le type `User` du SDK ne franchit jamais cette frontière : les couches
  /// supérieures (providers, router) ne raisonnent que sur l'uid.
  Stream<String?> authUidChanges() =>
      FirebaseRefs.auth.authStateChanges().map((user) => user?.uid);

  /// Uid Firebase courant (synchrone), `null` si déconnecté.
  String? get currentUid => FirebaseRefs.auth.currentUser?.uid;

  /// Récupère les custom claims du token (ex. `rootAdmin`). Best-effort.
  Future<Map<String, dynamic>> idTokenClaims({bool forceRefresh = false}) async {
    try {
      final user = FirebaseRefs.auth.currentUser;
      if (user == null) return const {};
      final result = await user.getIdTokenResult(forceRefresh);
      return result.claims ?? const {};
    } catch (error, stack) {
      _log.warn('idTokenClaims failed', error, stack);
      return const {};
    }
  }

  // --- Google -------------------------------------------------------------

  /// Initialise le singleton Google Sign-In (idempotent).
  ///
  /// google_sign_in 7.x impose un `initialize()` explicite avant tout
  /// `authenticate()`. Le `clientId` / `serverClientId` est résolu par
  /// défaut depuis la config native (google-services.json / plist) — on ne
  /// le passe donc pas ici.
  Future<void> _ensureGoogleInitialized() async {
    if (_googleInitialized) return;
    await GoogleSignIn.instance.initialize();
    _googleInitialized = true;
  }

  /// Sign-in via Google → renvoie le [User] Firebase.
  ///
  /// google_sign_in 7.x : `GoogleSignIn.instance.authenticate()` remplace
  /// l'ancien `signIn()`. L'`idToken` obtenu suffit pour construire le
  /// `GoogleAuthProvider.credential` (Firebase n'exige pas l'accessToken).
  Future<User> signInWithGoogle() async {
    try {
      await _ensureGoogleInitialized();

      if (!GoogleSignIn.instance.supportsAuthenticate()) {
        throw const AppException(
          kind: AppFailureKind.auth,
          message: 'Connexion Google non supportée sur cette plateforme.',
        );
      }

      final account = await GoogleSignIn.instance.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null) {
        throw const AppException(
          kind: AppFailureKind.auth,
          message: 'Jeton Google introuvable.',
        );
      }

      final credential = GoogleAuthProvider.credential(idToken: idToken);
      final result =
          await FirebaseRefs.auth.signInWithCredential(credential);
      final user = result.user;
      if (user == null) {
        throw const AppException(
          kind: AppFailureKind.auth,
          message: 'Connexion Google échouée.',
        );
      }
      return user;
    } on GoogleSignInException catch (error, stack) {
      _log.warn('Google sign-in cancelled/failed [${error.code}]', error,
          stack);
      throw AppException(
        kind: AppFailureKind.auth,
        message: 'Connexion Google annulée.',
        code: error.code.name,
        cause: error,
        stackTrace: stack,
      );
    } catch (error, stack) {
      _log.error('signInWithGoogle failed', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
  }

  // --- Apple --------------------------------------------------------------

  /// Sign-in via Apple → renvoie le [User] Firebase.
  ///
  /// On génère un `nonce` aléatoire dont le SHA-256 est passé à Apple ; le
  /// nonce brut est ensuite donné à Firebase pour vérifier le token.
  Future<User> signInWithApple() async {
    try {
      final rawNonce = _generateNonce();
      final hashedNonce = _sha256OfString(rawNonce);

      final appleCredential = await SignInWithApple.getAppleIDCredential(
        scopes: const [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
        nonce: hashedNonce,
      );

      final idToken = appleCredential.identityToken;
      if (idToken == null) {
        throw const AppException(
          kind: AppFailureKind.auth,
          message: 'Jeton Apple introuvable.',
        );
      }

      final credential = OAuthProvider('apple.com').credential(
        idToken: idToken,
        rawNonce: rawNonce,
        accessToken: appleCredential.authorizationCode,
      );

      final result =
          await FirebaseRefs.auth.signInWithCredential(credential);
      final user = result.user;
      if (user == null) {
        throw const AppException(
          kind: AppFailureKind.auth,
          message: 'Connexion Apple échouée.',
        );
      }
      return user;
    } on SignInWithAppleAuthorizationException catch (error, stack) {
      _log.warn('Apple sign-in cancelled/failed [${error.code}]', error,
          stack);
      throw AppException(
        kind: AppFailureKind.auth,
        message: 'Connexion Apple annulée.',
        code: error.code.name,
        cause: error,
        stackTrace: stack,
      );
    } catch (error, stack) {
      _log.error('signInWithApple failed', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
  }

  // --- Sign-out -----------------------------------------------------------

  /// Déconnecte le user de Firebase et de Google.
  Future<void> signOut() async {
    try {
      if (_googleInitialized) {
        await GoogleSignIn.instance.signOut();
      }
      await FirebaseRefs.auth.signOut();
    } catch (error, stack) {
      _log.error('signOut failed', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
  }

  // --- Nonce helpers ------------------------------------------------------

  static const String _nonceCharset =
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';

  String _generateNonce([int length = 32]) {
    final random = Random.secure();
    return List.generate(
      length,
      (_) => _nonceCharset[random.nextInt(_nonceCharset.length)],
    ).join();
  }

  String _sha256OfString(String input) {
    return sha256.convert(input.codeUnits).toString();
  }
}
