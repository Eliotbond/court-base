import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_providers.dart';
import '../../providers/firebase_providers.dart';
import '../../shared/widgets/account_info_card.dart';

/// Écran affiché quand un utilisateur est authentifié mais n'a pas de
/// document `/users/{uid}` (compte orphelin — politique deny-orphan).
///
/// Volontairement **PAS** d'appel automatique à `acceptInvitation` côté
/// mobile : l'app affiche un message d'information et propose seulement de se
/// déconnecter. Le provisioning d'un compte se fait côté web / register.
class OrphanAccountScreen extends ConsumerStatefulWidget {
  const OrphanAccountScreen({super.key});

  @override
  ConsumerState<OrphanAccountScreen> createState() =>
      _OrphanAccountScreenState();
}

class _OrphanAccountScreenState extends ConsumerState<OrphanAccountScreen> {
  bool _busy = false;

  Future<void> _signOut() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).signOut();
      // Le redirect du router ramène vers /sign-in.
    } catch (_) {
      // Sign-out best-effort — on ne bloque pas l'utilisateur.
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
                  Icons.no_accounts_outlined,
                  size: 64,
                  color: theme.colorScheme.error,
                ),
                const SizedBox(height: 20),
                Text(
                  'Compte non rattaché',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Votre connexion a réussi, mais aucun profil de club n\'est '
                  'associé à ce compte.\n\n'
                  'Contactez un administrateur de votre club pour être ajouté, '
                  'ou utilisez le portail d\'inscription si vous êtes un '
                  'nouveau membre.',
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
