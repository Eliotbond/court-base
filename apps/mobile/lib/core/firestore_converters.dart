import 'package:cloud_firestore/cloud_firestore.dart';

import 'logger.dart';

/// Helpers de conversion entre les types Firestore bruts et les types Dart.
///
/// Centralise : Timestamp <-> DateTime, parsing d'enums tolérant, accès
/// null-safe aux champs de `Map<String, dynamic>`. Aucun modèle ne convertit
/// un Timestamp « à la main » — tout passe par ici.
class FsConvert {
  const FsConvert._();

  static final AppLogger _log = const AppLogger('FsConvert');

  // --- Timestamps ---------------------------------------------------------

  /// `Timestamp` -> `DateTime` (local). Tolère `null`, `DateTime` déjà
  /// converti, ou un `int` epoch-millis.
  static DateTime? toDateTime(Object? raw) {
    if (raw == null) return null;
    if (raw is Timestamp) return raw.toDate();
    if (raw is DateTime) return raw;
    if (raw is int) return DateTime.fromMillisecondsSinceEpoch(raw);
    _log.warn('toDateTime: type inattendu ${raw.runtimeType}');
    return null;
  }

  /// Variante non-nullable avec valeur de repli (epoch par défaut).
  static DateTime toDateTimeOr(Object? raw, [DateTime? fallback]) {
    return toDateTime(raw) ?? fallback ?? DateTime.fromMillisecondsSinceEpoch(0);
  }

  /// `DateTime` -> `Timestamp` pour l'écriture.
  static Timestamp fromDateTime(DateTime value) => Timestamp.fromDate(value);

  // --- Enums --------------------------------------------------------------

  /// Parse une valeur string vers un enum via [values], avec repli gracieux.
  ///
  /// `values` est typiquement `MyEnum.values` ; `nameOf` extrait la clé
  /// string de chaque variante (en général `(e) => e.name`, mais certains
  /// enums ont une clé wire différente — ex. `n/a`).
  ///
  /// Une valeur inconnue ne lève **jamais** : on log et on retourne
  /// [fallback] (cf. CLAUDE.md — robustesse face aux docs Firestore drift).
  static E parseEnum<E>(
    Object? raw,
    List<E> values,
    String Function(E) nameOf,
    E fallback, {
    String? field,
  }) {
    if (raw is String) {
      for (final value in values) {
        if (nameOf(value) == raw) return value;
      }
    }
    _log.warn(
      'parseEnum: valeur inconnue "$raw"'
      '${field != null ? ' (champ $field)' : ''} -> repli ${nameOf(fallback)}',
    );
    return fallback;
  }

  /// Variante de [parseEnum] pour les champs nullable : `null` en entrée
  /// reste `null`, sans warning.
  static E? parseEnumOrNull<E>(
    Object? raw,
    List<E> values,
    String Function(E) nameOf, {
    String? field,
  }) {
    if (raw == null) return null;
    if (raw is String) {
      for (final value in values) {
        if (nameOf(value) == raw) return value;
      }
    }
    _log.warn(
      'parseEnumOrNull: valeur inconnue "$raw"'
      '${field != null ? ' (champ $field)' : ''} -> null',
    );
    return null;
  }

  // --- Accès Map null-safe ------------------------------------------------

  /// String avec repli sur chaîne vide.
  static String str(Object? raw, [String fallback = '']) =>
      raw is String ? raw : fallback;

  /// String nullable.
  static String? strOrNull(Object? raw) => raw is String ? raw : null;

  /// Booléen avec repli.
  static bool boolean(Object? raw, [bool fallback = false]) =>
      raw is bool ? raw : fallback;

  /// Entier (tolère `num`).
  static int integer(Object? raw, [int fallback = 0]) {
    if (raw is int) return raw;
    if (raw is num) return raw.toInt();
    return fallback;
  }

  /// Entier nullable.
  static int? intOrNull(Object? raw) {
    if (raw is int) return raw;
    if (raw is num) return raw.toInt();
    return null;
  }

  /// Double (tolère `num`).
  static double number(Object? raw, [double fallback = 0]) {
    if (raw is num) return raw.toDouble();
    return fallback;
  }

  /// `List<String>` — filtre les éléments non-string, repli liste vide.
  static List<String> stringList(Object? raw) {
    if (raw is List) {
      return raw.whereType<String>().toList(growable: false);
    }
    return const <String>[];
  }

  /// `List<Map<String, dynamic>>` — utile pour les champs tableau d'objets.
  static List<Map<String, dynamic>> mapList(Object? raw) {
    if (raw is List) {
      return raw
          .whereType<Map>()
          .map((m) => Map<String, dynamic>.from(m))
          .toList(growable: false);
    }
    return const <Map<String, dynamic>>[];
  }

  /// `Map<String, dynamic>` ou `null`.
  static Map<String, dynamic>? mapOrNull(Object? raw) {
    if (raw is Map) return Map<String, dynamic>.from(raw);
    return null;
  }

  /// Extrait le `data()` d'un snapshot en `Map<String, dynamic>` non-null.
  /// Lève si le document n'existe pas — l'appelant doit avoir vérifié
  /// `snapshot.exists` au préalable.
  static Map<String, dynamic> requireData(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) {
    final data = snapshot.data();
    if (data == null) {
      throw StateError('Document ${snapshot.reference.path} sans données');
    }
    return data;
  }
}
