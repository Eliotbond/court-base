import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/enums.dart';
import '../../models/registration.dart';
import '../../providers/coach_providers.dart';
import '../../shared/formatters/date_formatters.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/empty_state.dart';
import 'widgets/coach_widgets.dart';

/// Inscriptions d'une équipe.
///
/// Affiche les inscriptions soumises pour l'équipe ; le coach peut marquer un
/// essai (`markTrialInProgress`), confirmer (`confirmRegistration`) ou refuser
/// avec un motif (`refuseRegistration`) — toutes via callables.
class RegistrationsScreen extends ConsumerStatefulWidget {
  const RegistrationsScreen({super.key, required this.teamId});

  final String teamId;

  @override
  ConsumerState<RegistrationsScreen> createState() =>
      _RegistrationsScreenState();
}

class _RegistrationsScreenState
    extends ConsumerState<RegistrationsScreen> {
  /// id de l'inscription en cours de traitement (désactive ses boutons).
  String? _busyId;

  @override
  Widget build(BuildContext context) {
    final registrationsAsync =
        ref.watch(registrationsProvider(widget.teamId));

    return Scaffold(
      appBar: AppBar(title: const Text('Inscriptions')),
      body: RefreshIndicator(
        onRefresh: () async =>
            ref.invalidate(registrationsProvider(widget.teamId)),
        child: AsyncValueView<List<Registration>>(
          value: registrationsAsync,
          onRetry: () =>
              ref.invalidate(registrationsProvider(widget.teamId)),
          data: (registrations) {
            if (registrations.isEmpty) {
              return ListView(
                children: const [
                  SizedBox(height: 80),
                  EmptyState(
                    icon: Icons.how_to_reg_outlined,
                    title: 'Aucune inscription',
                    message:
                        'Aucune demande d\'inscription pour cette équipe.',
                  ),
                ],
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: registrations.length,
              itemBuilder: (context, index) => _RegistrationCard(
                registration: registrations[index],
                busy: _busyId == registrations[index].id,
                onConfirm: () => _confirm(registrations[index]),
                onRefuse: () => _refuse(registrations[index]),
                onMarkTrial: () => _markTrial(registrations[index]),
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _runAction(
    Registration registration,
    Future<void> Function() action,
    String successMessage,
  ) async {
    setState(() => _busyId = registration.id);
    try {
      await action();
      if (!mounted) return;
      showCoachSnack(context, successMessage);
      ref.invalidate(registrationsProvider(widget.teamId));
    } catch (error) {
      if (!mounted) return;
      showCoachSnack(context, _errorText(error), isError: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _confirm(Registration registration) async {
    final callables = ref.read(callablesRepositoryProvider);
    await _runAction(
      registration,
      () => callables.confirmRegistration(registration.id),
      'Inscription confirmée.',
    );
  }

  Future<void> _markTrial(Registration registration) async {
    final callables = ref.read(callablesRepositoryProvider);
    await _runAction(
      registration,
      () => callables.markTrialInProgress(registration.id),
      'Essai marqué comme en cours.',
    );
  }

  Future<void> _refuse(Registration registration) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _RefuseDialog(),
    );
    if (reason == null || !mounted) return;
    final callables = ref.read(callablesRepositoryProvider);
    await _runAction(
      registration,
      () => callables.refuseRegistration(registration.id, reason),
      'Inscription refusée.',
    );
  }
}

/// Carte d'une inscription avec ses actions contextuelles.
class _RegistrationCard extends StatelessWidget {
  const _RegistrationCard({
    required this.registration,
    required this.busy,
    required this.onConfirm,
    required this.onRefuse,
    required this.onMarkTrial,
  });

  final Registration registration;
  final bool busy;
  final VoidCallback onConfirm;
  final VoidCallback onRefuse;
  final VoidCallback onMarkTrial;

  /// L'inscription accepte-t-elle encore une décision du coach ?
  bool get _isActionable => switch (registration.status) {
        RegistrationStatus.submitted ||
        RegistrationStatus.openPendingTrial ||
        RegistrationStatus.conditionalPendingReview ||
        RegistrationStatus.conditionalPendingTrial ||
        RegistrationStatus.trialInProgress =>
          true,
        _ => false,
      };

  /// Le bouton « Marquer en essai » est-il pertinent ?
  bool get _canMarkTrial => switch (registration.status) {
        RegistrationStatus.submitted ||
        RegistrationStatus.openPendingTrial ||
        RegistrationStatus.conditionalPendingReview ||
        RegistrationStatus.conditionalPendingTrial =>
          true,
        _ => false,
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final player = registration.player;
    final birthDate = player.birthDate;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    player.fullName,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                RegistrationStatusBadge(status: registration.status),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              [
                if (birthDate != null)
                  'Né(e) le ${DateFormatters.numericDate(birthDate)}',
                'Soumise le '
                    '${DateFormatters.numericDate(registration.createdAt)}',
              ].join(' · '),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (registration.previouslyLicensed ||
                registration.foreignTransfer) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                children: [
                  if (registration.previouslyLicensed)
                    const StatusChip(
                      label: 'Déjà licencié',
                      color: Color(0xFF1565C0),
                    ),
                  if (registration.foreignTransfer)
                    const StatusChip(
                      label: 'Transfert étranger',
                      color: Color(0xFFE6A100),
                    ),
                ],
              ),
            ],
            if (registration.refusalReason != null) ...[
              const SizedBox(height: 8),
              Text(
                'Motif du refus : ${registration.refusalReason}',
                style: theme.textTheme.bodySmall,
              ),
            ],
            if (_isActionable) ...[
              const Divider(height: 24),
              if (busy)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(4),
                    child: SizedBox(
                      height: 20,
                      width: 20,
                      child:
                          CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                )
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  alignment: WrapAlignment.end,
                  children: [
                    if (_canMarkTrial)
                      OutlinedButton.icon(
                        onPressed: onMarkTrial,
                        icon: const Icon(Icons.timer_outlined, size: 18),
                        label: const Text('Marquer en essai'),
                      ),
                    OutlinedButton.icon(
                      onPressed: onRefuse,
                      icon: const Icon(Icons.close, size: 18),
                      label: const Text('Refuser'),
                    ),
                    FilledButton.icon(
                      onPressed: onConfirm,
                      icon: const Icon(Icons.check, size: 18),
                      label: const Text('Confirmer'),
                    ),
                  ],
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Dialogue de saisie du motif de refus.
class _RefuseDialog extends StatefulWidget {
  const _RefuseDialog();

  @override
  State<_RefuseDialog> createState() => _RefuseDialogState();
}

class _RefuseDialogState extends State<_RefuseDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Refuser l\'inscription'),
      content: TextField(
        controller: _controller,
        autofocus: true,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(
          labelText: 'Motif du refus',
          border: OutlineInputBorder(),
        ),
        maxLines: 3,
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Annuler'),
        ),
        FilledButton(
          onPressed: () {
            final reason = _controller.text.trim();
            if (reason.isEmpty) return;
            Navigator.of(context).pop(reason);
          },
          child: const Text('Refuser'),
        ),
      ],
    );
  }
}

String _errorText(Object error) {
  return error.toString().replaceFirst('Exception: ', '');
}
