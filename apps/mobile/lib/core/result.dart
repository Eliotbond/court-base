import 'app_exception.dart';

/// Échec porté par un [Result] — alias sémantique sur [AppException].
typedef AppFailure = AppException;

/// Résultat d'une opération pouvant échouer, sans lever d'exception.
///
/// Pattern utilisé par les repositories pour les mutations : un appel
/// renvoie `Result<T>` plutôt que de jeter, ce qui force l'appelant à
/// traiter explicitement l'échec.
///
/// ```dart
/// final res = await repo.doThing();
/// switch (res) {
///   case Success(:final value): ...
///   case Failure(:final failure): ...
/// }
/// ```
sealed class Result<T> {
  const Result();

  /// Construit un succès.
  const factory Result.success(T value) = Success<T>;

  /// Construit un échec.
  const factory Result.failure(AppFailure failure) = Failure<T>;

  /// `true` si l'opération a réussi.
  bool get isSuccess => this is Success<T>;

  /// `true` si l'opération a échoué.
  bool get isFailure => this is Failure<T>;

  /// Valeur si succès, `null` sinon.
  T? get valueOrNull => switch (this) {
        Success<T>(:final value) => value,
        Failure<T>() => null,
      };

  /// Échec si erreur, `null` sinon.
  AppFailure? get failureOrNull => switch (this) {
        Success<T>() => null,
        Failure<T>(:final failure) => failure,
      };

  /// Replie le résultat sur une seule valeur.
  R fold<R>({
    required R Function(T value) onSuccess,
    required R Function(AppFailure failure) onFailure,
  }) =>
      switch (this) {
        Success<T>(:final value) => onSuccess(value),
        Failure<T>(:final failure) => onFailure(failure),
      };
}

/// Variante succès de [Result].
final class Success<T> extends Result<T> {
  const Success(this.value);

  final T value;
}

/// Variante échec de [Result].
final class Failure<T> extends Result<T> {
  const Failure(this.failure);

  final AppFailure failure;
}

/// Exécute [action] et capture toute exception Firebase en [Result.failure].
/// Wrappe le `try/catch` défensif imposé par CLAUDE.md §9.
Future<Result<T>> guardResult<T>(Future<T> Function() action) async {
  try {
    return Result.success(await action());
  } catch (error, stack) {
    return Result.failure(AppException.fromFirebase(error, stack));
  }
}
