import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/member.dart';
import '../../providers/auth_providers.dart';
import '../../providers/coach_providers.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/empty_state.dart';
import 'coach_routes.dart';
import 'widgets/coach_widgets.dart';

/// Demande de licence pour un joueur de l'effectif.
///
/// Le coach choisit un membre du roster ; les rules autorisent une création
/// directe de `/licenseRequests` quand `teamId in userDoc().teamIds`. La
/// validation est faite par l'admin sur le web.
class LicenseRequestScreen extends ConsumerStatefulWidget {
  const LicenseRequestScreen({
    super.key,
    required this.teamId,
    this.preselectedMemberId,
  });

  final String teamId;

  /// Membre pré-sélectionné si l'écran est ouvert depuis une ligne du roster.
  final String? preselectedMemberId;

  @override
  ConsumerState<LicenseRequestScreen> createState() =>
      _LicenseRequestScreenState();
}

class _LicenseRequestScreenState
    extends ConsumerState<LicenseRequestScreen> {
  String? _selectedMemberId;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _selectedMemberId = widget.preselectedMemberId;
  }

  @override
  Widget build(BuildContext context) {
    final rosterAsync = ref.watch(rosterProvider(widget.teamId));

    return Scaffold(
      appBar: AppBar(title: const Text('Demander une licence')),
      body: AsyncValueView<List<Member>>(
        value: rosterAsync,
        onRetry: () => ref.invalidate(rosterProvider(widget.teamId)),
        data: (members) {
          if (members.isEmpty) {
            return const EmptyState(
              icon: Icons.person_outline,
              title: 'Effectif vide',
              message: 'Ajoutez un joueur avant de demander une licence.',
            );
          }
          return SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: members.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final member = members[index];
                      return RadioListTile<String>(
                        value: member.id,
                        groupValue: _selectedMemberId,
                        title: Text(member.fullName),
                        subtitle: LicenseBadge(member: member),
                        onChanged: member.licensed
                            ? null
                            : (v) =>
                                setState(() => _selectedMemberId = v),
                        secondary: member.licensed
                            ? const Tooltip(
                                message: 'Déjà licencié',
                                child: Icon(Icons.verified_outlined),
                              )
                            : null,
                      );
                    },
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _submitting || _selectedMemberId == null
                          ? null
                          : _submit,
                      child: _submitting
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2),
                            )
                          : const Text('Envoyer la demande'),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _submit() async {
    final memberId = _selectedMemberId;
    if (memberId == null) return;
    final user = ref.read(appUserProvider);
    if (user == null) {
      showCoachSnack(context, 'Session expirée.', isError: true);
      return;
    }
    setState(() => _submitting = true);

    final repo = ref.read(licenseRequestRepositoryProvider);
    try {
      await repo.createLicenseRequest(
        memberId: memberId,
        teamId: widget.teamId,
        requestedByUid: user.id,
      );
      if (!mounted) return;
      showCoachSnack(context, 'Demande de licence envoyée.');
      _leaveToRoster(context, widget.teamId);
    } catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showCoachSnack(context, _errorText(error), isError: true);
    }
  }
}

String _errorText(Object error) {
  return error.toString().replaceFirst('Exception: ', '');
}

/// Retour à l'effectif après soumission — `context.pop()` si la pile de
/// navigation le permet, sinon `context.go` vers le roster (deep-link direct).
void _leaveToRoster(BuildContext context, String teamId) {
  if (context.canPop()) {
    context.pop();
  } else {
    context.go(CoachRoutes.rosterLocation(teamId));
  }
}
