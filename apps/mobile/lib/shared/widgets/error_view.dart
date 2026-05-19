import 'package:flutter/material.dart';

import '../../core/app_exception.dart';

/// Vue d'erreur générique — message lisible + bouton "Réessayer".
///
/// Sait afficher un message adapté quand l'erreur est une [AppException]
/// (catégorie connue), sinon retombe sur `error.toString()`.
class ErrorView extends StatelessWidget {
  const ErrorView({
    super.key,
    required this.error,
    this.onRetry,
  });

  /// Erreur à afficher (idéalement une [AppException]).
  final Object error;

  /// Callback de réessai ; `null` = pas de bouton.
  final VoidCallback? onRetry;

  String get _message {
    final err = error;
    if (err is AppException) {
      return switch (err.kind) {
        AppFailureKind.permissionDenied =>
          'Accès refusé. Vous n\'avez pas les droits pour cette action.',
        AppFailureKind.network =>
          'Connexion indisponible. Vérifiez votre réseau.',
        AppFailureKind.notFound => 'Élément introuvable.',
        AppFailureKind.auth => err.message,
        AppFailureKind.callable => err.message,
        AppFailureKind.unknown => err.message,
      };
    }
    return err.toString();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline,
              size: 56,
              color: theme.colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              'Une erreur est survenue',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              _message,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 20),
              FilledButton.tonalIcon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Réessayer'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
