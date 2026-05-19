import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/member.dart';
import '../../providers/coach_providers.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/empty_state.dart';
import 'coach_routes.dart';
import 'widgets/coach_widgets.dart';

/// Effectif d'une équipe — liste des joueurs actifs.
///
/// Chaque ligne : nom, badge licence, badge cotisation, menu d'actions
/// (éditer / désactiver / demander une licence). Recherche par nom. Le menu
/// `…` de l'AppBar donne accès aux actions niveau équipe (match extérieur,
/// déplacement de match, inscriptions).
class RosterScreen extends ConsumerStatefulWidget {
  const RosterScreen({super.key, required this.teamId});

  final String teamId;

  @override
  ConsumerState<RosterScreen> createState() => _RosterScreenState();
}

class _RosterScreenState extends ConsumerState<RosterScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final coachTeam = ref.watch(coachTeamByIdProvider(widget.teamId));
    final rosterAsync = ref.watch(rosterProvider(widget.teamId));
    final teamName = coachTeam?.name ?? 'Effectif';

    return Scaffold(
      appBar: AppBar(
        title: Text(teamName),
        actions: [
          PopupMenuButton<_TeamAction>(
            icon: const Icon(Icons.more_vert),
            onSelected: (action) => _onTeamAction(action),
            itemBuilder: (context) => const [
              PopupMenuItem(
                value: _TeamAction.registrations,
                child: ListTile(
                  leading: Icon(Icons.how_to_reg_outlined),
                  title: Text('Inscriptions'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuItem(
                value: _TeamAction.awayMatch,
                child: ListTile(
                  leading: Icon(Icons.directions_bus_outlined),
                  title: Text('Match à l\'extérieur'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuItem(
                value: _TeamAction.moveHome,
                child: ListTile(
                  leading: Icon(Icons.event_repeat_outlined),
                  title: Text('Déplacer un match'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ],
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openMemberForm(),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Ajouter'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Rechercher un joueur',
                isDense: true,
                border: OutlineInputBorder(),
              ),
              onChanged: (value) =>
                  setState(() => _query = value.trim().toLowerCase()),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async =>
                  ref.invalidate(rosterProvider(widget.teamId)),
              child: AsyncValueView<List<Member>>(
                value: rosterAsync,
                onRetry: () => ref.invalidate(rosterProvider(widget.teamId)),
                data: (members) {
                  final filtered = _query.isEmpty
                      ? members
                      : members
                          .where((m) =>
                              m.fullName.toLowerCase().contains(_query))
                          .toList(growable: false);
                  if (filtered.isEmpty) {
                    return ListView(
                      children: [
                        const SizedBox(height: 80),
                        EmptyState(
                          icon: Icons.person_outline,
                          title: members.isEmpty
                              ? 'Effectif vide'
                              : 'Aucun résultat',
                          message: members.isEmpty
                              ? 'Ajoutez un joueur avec le bouton ci-dessous.'
                              : 'Aucun joueur ne correspond à « $_query ».',
                        ),
                      ],
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.only(bottom: 88),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) => _PlayerRow(
                      member: filtered[index],
                      onEdit: () => _openMemberForm(member: filtered[index]),
                      onDeactivate: () =>
                          _confirmDeactivate(filtered[index]),
                      onRequestLicense: () =>
                          _openLicenseRequest(filtered[index]),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _onTeamAction(_TeamAction action) {
    final location = switch (action) {
      _TeamAction.registrations =>
        CoachRoutes.registrationsLocation(widget.teamId),
      _TeamAction.awayMatch => CoachRoutes.awayMatchLocation(widget.teamId),
      _TeamAction.moveHome => CoachRoutes.moveHomeLocation(widget.teamId),
    };
    context.go(location);
  }

  void _openMemberForm({Member? member}) {
    context.go(
      member == null
          ? CoachRoutes.memberCreateLocation(widget.teamId)
          : CoachRoutes.memberEditLocation(widget.teamId, member.id),
    );
  }

  void _openLicenseRequest(Member member) {
    context.go(
      CoachRoutes.licenseRequestLocation(widget.teamId, memberId: member.id),
    );
  }

  Future<void> _confirmDeactivate(Member member) async {
    final result = await showModalBottomSheet<_DeactivateChoice>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _DeactivateSheet(member: member),
    );
    if (result == null || !mounted) return;

    final callables = ref.read(callablesRepositoryProvider);
    try {
      await callables.coachDeactivateMember(
        memberId: member.id,
        mode: result.mode,
        reason: result.reason,
      );
      if (!mounted) return;
      showCoachSnack(
        context,
        result.mode == 'archive'
            ? '${member.fullName} archivé.'
            : '${member.fullName} mis sur le banc.',
      );
      ref.invalidate(rosterProvider(widget.teamId));
    } catch (error) {
      if (!mounted) return;
      showCoachSnack(context, _errorText(error), isError: true);
    }
  }
}

enum _TeamAction { registrations, awayMatch, moveHome }

/// Choix retourné par la feuille de désactivation.
class _DeactivateChoice {
  const _DeactivateChoice({required this.mode, this.reason});

  /// `bench` ou `archive`.
  final String mode;
  final String? reason;
}

/// Ligne d'un joueur dans l'effectif.
class _PlayerRow extends StatelessWidget {
  const _PlayerRow({
    required this.member,
    required this.onEdit,
    required this.onDeactivate,
    required this.onRequestLicense,
  });

  final Member member;
  final VoidCallback onEdit;
  final VoidCallback onDeactivate;
  final VoidCallback onRequestLicense;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: theme.colorScheme.secondaryContainer,
        child: Text(
          _initials(member.fullName),
          style: TextStyle(
            color: theme.colorScheme.onSecondaryContainer,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      title: Text(member.fullName, style: theme.textTheme.titleSmall),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            LicenseBadge(member: member),
            DuesStatusBadge(status: member.duesStatus),
          ],
        ),
      ),
      trailing: PopupMenuButton<_RowAction>(
        icon: const Icon(Icons.more_vert),
        onSelected: (action) {
          switch (action) {
            case _RowAction.edit:
              onEdit();
            case _RowAction.requestLicense:
              onRequestLicense();
            case _RowAction.deactivate:
              onDeactivate();
          }
        },
        itemBuilder: (context) => const [
          PopupMenuItem(
            value: _RowAction.edit,
            child: ListTile(
              leading: Icon(Icons.edit_outlined),
              title: Text('Modifier'),
              contentPadding: EdgeInsets.zero,
            ),
          ),
          PopupMenuItem(
            value: _RowAction.requestLicense,
            child: ListTile(
              leading: Icon(Icons.badge_outlined),
              title: Text('Demander une licence'),
              contentPadding: EdgeInsets.zero,
            ),
          ),
          PopupMenuItem(
            value: _RowAction.deactivate,
            child: ListTile(
              leading: Icon(Icons.person_off_outlined),
              title: Text('Désactiver'),
              contentPadding: EdgeInsets.zero,
            ),
          ),
        ],
      ),
      isThreeLine: true,
    );
  }

  static String _initials(String fullName) {
    final parts =
        fullName.split(' ').where((p) => p.isNotEmpty).toList(growable: false);
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.characters.first.toUpperCase();
    return (parts.first.characters.first + parts.last.characters.first)
        .toUpperCase();
  }
}

enum _RowAction { edit, requestLicense, deactivate }

/// Feuille de confirmation de désactivation — choix du mode + motif.
class _DeactivateSheet extends StatefulWidget {
  const _DeactivateSheet({required this.member});

  final Member member;

  @override
  State<_DeactivateSheet> createState() => _DeactivateSheetState();
}

class _DeactivateSheetState extends State<_DeactivateSheet> {
  String _mode = 'bench';
  final TextEditingController _reasonController = TextEditingController();

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Désactiver ${widget.member.fullName}',
              style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          RadioListTile<String>(
            value: 'bench',
            groupValue: _mode,
            contentPadding: EdgeInsets.zero,
            title: const Text('Mettre sur le banc'),
            subtitle: const Text(
                'Le joueur reste dans l\'effectif mais devient inactif.'),
            onChanged: (v) => setState(() => _mode = v ?? 'bench'),
          ),
          RadioListTile<String>(
            value: 'archive',
            groupValue: _mode,
            contentPadding: EdgeInsets.zero,
            title: const Text('Archiver'),
            subtitle: const Text(
                'Le joueur sort de l\'effectif actif (historique conservé).'),
            onChanged: (v) => setState(() => _mode = v ?? 'bench'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _reasonController,
            decoration: const InputDecoration(
              labelText: 'Motif (optionnel)',
              border: OutlineInputBorder(),
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Annuler'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: () {
                    final reason = _reasonController.text.trim();
                    Navigator.of(context).pop(
                      _DeactivateChoice(
                        mode: _mode,
                        reason: reason.isEmpty ? null : reason,
                      ),
                    );
                  },
                  child: const Text('Confirmer'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

String _errorText(Object error) {
  return error.toString().replaceFirst('Exception: ', '');
}
