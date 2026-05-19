import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'error_view.dart';

/// Rend un [AsyncValue] en branchant loading / error / data.
///
/// Centralise le pattern Riverpod `asyncValue.when(...)` pour éviter de
/// réécrire les états loading/error dans chaque écran.
///
/// ```dart
/// AsyncValueView<List<Match>>(
///   value: ref.watch(matchesProvider),
///   data: (matches) => MatchList(matches),
///   onRetry: () => ref.invalidate(matchesProvider),
/// )
/// ```
class AsyncValueView<T> extends StatelessWidget {
  const AsyncValueView({
    super.key,
    required this.value,
    required this.data,
    this.loading,
    this.onRetry,
  });

  /// L'[AsyncValue] à rendre.
  final AsyncValue<T> value;

  /// Builder du cas data.
  final Widget Function(T value) data;

  /// Widget de chargement personnalisé ; défaut = spinner centré.
  final Widget? loading;

  /// Callback de réessai passé à [ErrorView].
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: data,
      loading: () =>
          loading ?? const Center(child: CircularProgressIndicator()),
      error: (error, _) => ErrorView(error: error, onRetry: onRetry),
    );
  }
}
