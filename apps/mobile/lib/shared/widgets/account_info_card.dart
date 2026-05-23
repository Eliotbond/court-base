import 'package:flutter/material.dart';

import '../../repositories/auth_repository.dart';

/// Carte affichant les informations du compte Firebase Auth courant —
/// avatar, displayName, email, et provider OAuth.
///
/// Utilisée sur les écrans « hors espace club » (orphelin, fallback sans
/// rôle app) pour que l'utilisateur voie au moins quel compte est connecté
/// avant de se déconnecter.
class AccountInfoCard extends StatelessWidget {
  const AccountInfoCard({super.key, required this.info});

  final AuthAccountInfo info;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    final displayName = info.displayName.isNotEmpty
        ? info.displayName
        : (info.email.isNotEmpty ? info.email : 'Compte sans nom');
    final providerLabel = _providerLabel(info.providerIds);

    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                _Avatar(displayName: displayName, photoURL: info.photoURL),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        displayName,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (info.email.isNotEmpty &&
                          info.email != displayName) ...[
                        const SizedBox(height: 2),
                        Text(
                          info.email,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            if (providerLabel != null) ...[
              const SizedBox(height: 14),
              const Divider(height: 1),
              const SizedBox(height: 14),
              Row(
                children: [
                  Icon(Icons.shield_outlined,
                      size: 18, color: scheme.onSurfaceVariant),
                  const SizedBox(width: 8),
                  Text(
                    providerLabel,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Label humain pour les providers OAuth — `null` si aucun connu.
  static String? _providerLabel(List<String> ids) {
    final friendly = <String>[];
    for (final id in ids) {
      switch (id) {
        case 'google.com':
          friendly.add('Google');
        case 'apple.com':
          friendly.add('Apple');
        case 'password':
          friendly.add('Email');
        case 'phone':
          friendly.add('Téléphone');
      }
    }
    if (friendly.isEmpty) return null;
    return 'Connecté via ${friendly.join(', ')}';
  }
}

/// Avatar circulaire — photo distante si disponible, sinon initiale.
class _Avatar extends StatelessWidget {
  const _Avatar({required this.displayName, required this.photoURL});

  final String displayName;
  final String photoURL;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final initial = displayName.trim().isEmpty
        ? '?'
        : displayName.trim().characters.first.toUpperCase();

    if (photoURL.isEmpty) {
      return CircleAvatar(
        radius: 26,
        backgroundColor: scheme.primaryContainer,
        child: Text(
          initial,
          style: TextStyle(
            color: scheme.onPrimaryContainer,
            fontWeight: FontWeight.w600,
            fontSize: 18,
          ),
        ),
      );
    }

    return CircleAvatar(
      radius: 26,
      backgroundColor: scheme.primaryContainer,
      foregroundImage: NetworkImage(photoURL),
      onForegroundImageError: (_, __) {},
      child: Text(
        initial,
        style: TextStyle(
          color: scheme.onPrimaryContainer,
          fontWeight: FontWeight.w600,
          fontSize: 18,
        ),
      ),
    );
  }
}
