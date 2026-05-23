import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_providers.dart';
import '../../providers/firebase_providers.dart';
import '../../shared/widgets/account_info_card.dart';

/// Écran de repli affiché aux comptes valides (`/users/{uid}` présent) qui
/// ne portent aucun rôle utilisable par l'app mobile (ni `coach`, ni
/// `official`).
///
/// Cas typique : admin web pur ouvrant l'app mobile, ou membre dont les
/// rôles app n'ont pas encore été provisionnés. On affiche les infos de
/// compte (pour qu'il sache quel compte est connecté) et un bouton de
/// déconnexion — il n'a sinon aucun moyen d'y accéder, l'app n'ayant pas de
/// page « profil » par ailleurs.
class NoClubSpaceScreen extends ConsumerStatefulWidget {
  const NoClubSpaceScreen({super.key});

  @override
  ConsumerState<NoClubSpaceScreen> createState() => _NoClubSpaceScreenState();
}

class _NoClubSpaceScreenState extends ConsumerState<NoClubSpaceScreen> {
  bool _busy = false;

  Future<void> _signOut() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).signOut();
      // Le redirect du router ramène vers /sign-in.
    } catch (_) {
      // Sign-out best-effort.
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accountInfo = ref.watch(currentAccountInfoProvider);

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
          child: ConstrainedBox(
            constraints: BoxConstraints(
              minHeight: MediaQuery.of(context).size.height -
                  MediaQuery.of(context).padding.vertical -
                  48,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(
                  Icons.workspaces_outline,
                  size: 64,
                  color: theme.colorScheme.outline,
                ),
                const SizedBox(height: 20),
                Text(
                  'Aucun espace disponible',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Votre compte est connecté mais aucun rôle coach ou officiel '
                  'ne lui est rattaché pour le moment.\n\n'
                  'Contactez un administrateur du club si vous pensez que '
                  'c\'est une erreur.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                if (accountInfo != null) ...[
                  const SizedBox(height: 24),
                  AccountInfoCard(info: accountInfo),
                ],
                const SizedBox(height: 24),
                FilledButton.tonalIcon(
                  onPressed: _busy ? null : _signOut,
                  icon: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.logout),
                  label: const Text('Se déconnecter'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
