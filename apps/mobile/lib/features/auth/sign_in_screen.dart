import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_exception.dart';
import '../../providers/firebase_providers.dart';
import '../../shared/theme/app_colors.dart';

/// Écran de connexion — boutons Google et Apple.
///
/// Le redirect du router amène ici tout utilisateur déconnecté. Après un
/// sign-in réussi, `authStateChanges` émet et le router redirige
/// automatiquement (l'écran n'a pas à naviguer lui-même).
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _runSignIn(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      // Pas de navigation ici : le redirect du router prend le relais.
    } on AppException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signInGoogle() => _runSignIn(
        () => ref.read(authRepositoryProvider).signInWithGoogle(),
      );

  Future<void> _signInApple() => _runSignIn(
        () => ref.read(authRepositoryProvider).signInWithApple(),
      );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Apple Sign-In est obligatoire sur iOS, optionnel ailleurs.
    final showApple = Platform.isIOS || Platform.isMacOS;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(
                Icons.sports_basketball,
                size: 72,
                color: AppColors.brand,
              ),
              const SizedBox(height: 20),
              Text(
                'Courtbase',
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Connectez-vous pour gérer vos matchs et votre équipe.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 40),
              if (_error != null) ...[
                _ErrorBanner(message: _error!),
                const SizedBox(height: 16),
              ],
              FilledButton.icon(
                onPressed: _busy ? null : _signInGoogle,
                icon: const Icon(Icons.login),
                label: const Text('Continuer avec Google'),
              ),
              if (showApple) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _signInApple,
                  icon: const Icon(Icons.apple),
                  label: const Text('Continuer avec Apple'),
                ),
              ],
              const SizedBox(height: 24),
              if (_busy)
                const Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: scheme.onErrorContainer, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: scheme.onErrorContainer),
            ),
          ),
        ],
      ),
    );
  }
}
