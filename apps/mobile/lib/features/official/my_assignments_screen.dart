import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_exception.dart';
import '../../models/enums.dart';
import '../../models/official_assignment.dart';
import '../../providers/official_providers.dart';
import '../../shared/formatters/date_formatters.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/empty_state.dart';
import 'official_routes.dart';
import 'widgets/assignment_status_chip.dart';

/// Écran « Mes assignations » — liste des assignations de l'officiel courant,
/// avec confirmation / refus en ligne pour celles en attente.
class MyAssignmentsScreen extends ConsumerWidget {
  const MyAssignmentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final assignments = ref.watch(myAssignmentsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mes assignations')),
      body: AsyncValueView<List<OfficialAssignment>>(
        value: assignments,
        onRetry: () => ref.invalidate(myAssignmentsProvider),
        data: (list) {
          if (list.isEmpty) {
            return const EmptyState(
              icon: Icons.assignment_outlined,
              title: 'Aucune assignation',
              message:
                  'Inscrivez-vous à un match depuis l\'onglet '
                  '« Matchs à pourvoir ».',
            );
          }
          // Tri : en attente d'abord, puis confirmées, puis déclinées.
          final ordered = [...list]..sort((a, b) {
              final byStatus =
                  _statusRank(a.status).compareTo(_statusRank(b.status));
              if (byStatus != 0) return byStatus;
              return b.assignedAt.compareTo(a.assignedAt);
            });
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: ordered.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) => _AssignmentCard(
              assignment: ordered[i],
            ),
          );
        },
      ),
    );
  }

  static int _statusRank(OfficialAssignmentStatus s) => switch (s) {
        OfficialAssignmentStatus.pending => 0,
        OfficialAssignmentStatus.confirmed => 1,
        OfficialAssignmentStatus.declined => 2,
      };
}

/// Carte d'une assignation avec actions inline (confirmer / décliner).
class _AssignmentCard extends ConsumerStatefulWidget {
  const _AssignmentCard({required this.assignment});

  final OfficialAssignment assignment;

  @override
  ConsumerState<_AssignmentCard> createState() => _AssignmentCardState();
}

class _AssignmentCardState extends ConsumerState<_AssignmentCard> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final a = widget.assignment;
    final isHome = a.parentKind == OfficialAssignmentParent.booking;
    final isPending = a.status == OfficialAssignmentStatus.pending;

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  isHome ? Icons.home_outlined : Icons.directions_bus_outlined,
                  size: 18,
                  color: theme.colorScheme.outline,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    isHome ? 'Match à domicile' : 'Match à l\'extérieur',
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                AssignmentStatusChip(status: a.status),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Inscrit le ${DateFormatters.numericDate(a.assignedAt)}'
              ' · niveau ${a.officialLevel}',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton.icon(
                  onPressed: () => context.go(
                    OfficialRoutes.matchDetailLocation(
                      kind: a.parentKind,
                      id: a.parentId,
                    ),
                  ),
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: const Text('Voir le match'),
                ),
                const Spacer(),
                if (isPending && !_busy) ...[
                  OutlinedButton(
                    onPressed: () =>
                        _respond(OfficialAssignmentStatus.declined),
                    child: const Text('Décliner'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: () =>
                        _respond(OfficialAssignmentStatus.confirmed),
                    child: const Text('Confirmer'),
                  ),
                ],
                if (_busy)
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Confirme ou décline l'assignation. Sur un decline, annule les rappels
  /// locaux planifiés pour ce match.
  Future<void> _respond(OfficialAssignmentStatus status) async {
    final repo = ref.read(officialAssignmentRepositoryProvider);
    if (repo == null) return;
    final a = widget.assignment;
    setState(() => _busy = true);
    try {
      await repo.respond(
        parentKind: a.parentKind,
        parentId: a.parentId,
        assignmentId: a.id,
        status: status,
      );
      if (status == OfficialAssignmentStatus.declined) {
        await ref
            .read(localNotificationRepositoryProvider)
            .cancelMatchReminders(a.parentId);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            status == OfficialAssignmentStatus.confirmed
                ? 'Assignation confirmée.'
                : 'Assignation déclinée.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      final message = error is AppException
          ? error.message
          : 'Échec de l\'opération.';
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
