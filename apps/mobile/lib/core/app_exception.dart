import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Catégorie d'échec applicatif — sert à brancher l'UI (retry, message, etc.)
/// sans dépendre des codes d'erreur SDK bruts.
enum AppFailureKind {
  /// Permissions Firestore refusées (`permission-denied`).
  permissionDenied,

  /// Document / ressource introuvable.
  notFound,

  /// Problème réseau ou indisponibilité du service.
  network,

  /// Échec d'authentification (sign-in annulé, credential invalide…).
  auth,

  /// Erreur retournée par une Cloud Function callable.
  callable,

  /// Tout le reste.
  unknown,
}

/// Échec applicatif normalisé. Toute exception Firebase / callable est mappée
/// vers cette classe avant de remonter à l'UI (cf. règle CLAUDE.md §9).
class AppException implements Exception {
  const AppException({
    required this.kind,
    required this.message,
    this.code,
    this.cause,
    this.stackTrace,
  });

  /// Catégorie haut niveau.
  final AppFailureKind kind;

  /// Message lisible (peut être affiché à l'utilisateur, en français).
  final String message;

  /// Code d'erreur SDK d'origine (`permission-denied`, `unavailable`…).
  final String? code;

  /// Exception d'origine, conservée pour le log.
  final Object? cause;

  final StackTrace? stackTrace;

  /// Construit une [AppException] à partir d'une exception Firebase brute.
  /// Centralise le mapping code SDK -> [AppFailureKind].
  factory AppException.fromFirebase(Object error, [StackTrace? stack]) {
    if (error is AppException) return error;

    if (error is FirebaseFunctionsException) {
      return AppException(
        kind: AppFailureKind.callable,
        message: error.message ?? 'Échec de l\'opération.',
        code: error.code,
        cause: error,
        stackTrace: stack,
      );
    }

    if (error is FirebaseAuthException) {
      return AppException(
        kind: AppFailureKind.auth,
        message: error.message ?? 'Échec de l\'authentification.',
        code: error.code,
        cause: error,
        stackTrace: stack,
      );
    }

    if (error is FirebaseException) {
      final code = error.code;
      final kind = switch (code) {
        'permission-denied' => AppFailureKind.permissionDenied,
        'not-found' => AppFailureKind.notFound,
        'unavailable' || 'deadline-exceeded' => AppFailureKind.network,
        _ => AppFailureKind.unknown,
      };
      return AppException(
        kind: kind,
        message: error.message ?? 'Erreur Firebase.',
        code: code,
        cause: error,
        stackTrace: stack,
      );
    }

    return AppException(
      kind: AppFailureKind.unknown,
      message: error.toString(),
      cause: error,
      stackTrace: stack,
    );
  }

  @override
  String toString() =>
      'AppException(${kind.name}, code: $code, message: $message)';
}
