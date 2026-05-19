import 'package:flutter/material.dart';

/// État vide générique — illustration légère + message, optionnellement une
/// action. Utilisé quand une liste n'a aucun élément.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
    this.title,
    this.actionLabel,
    this.onAction,
  });

  /// Icône d'illustration.
  final IconData icon;

  /// Titre optionnel (gras).
  final String? title;

  /// Message explicatif.
  final String message;

  /// Libellé du bouton d'action ; `null` = pas de bouton.
  final String? actionLabel;

  /// Callback du bouton d'action.
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: theme.colorScheme.outline),
            const SizedBox(height: 16),
            if (title != null) ...[
              Text(
                title!,
                style: theme.textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
            ],
            Text(
              message,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 20),
              OutlinedButton(
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
