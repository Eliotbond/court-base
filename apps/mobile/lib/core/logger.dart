import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';

/// Logger minimal — wrappe `dart:developer` pour des logs structurés sans
/// dépendance externe. En release, les `debug`/`info` sont silencieux ;
/// `warn`/`error` restent tracés.
class AppLogger {
  const AppLogger(this.tag);

  final String tag;

  void debug(String message) {
    if (kDebugMode) {
      developer.log(message, name: tag, level: 500);
    }
  }

  void info(String message) {
    if (kDebugMode) {
      developer.log(message, name: tag, level: 800);
    }
  }

  void warn(String message, [Object? error, StackTrace? stack]) {
    developer.log(
      message,
      name: tag,
      level: 900,
      error: error,
      stackTrace: stack,
    );
  }

  void error(String message, [Object? error, StackTrace? stack]) {
    developer.log(
      message,
      name: tag,
      level: 1000,
      error: error,
      stackTrace: stack,
    );
  }
}

/// Logger racine, utilisable directement quand un tag dédié n'est pas requis.
const AppLogger logger = AppLogger('courtbase');
