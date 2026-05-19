import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_exception.dart';
import '../../models/booking.dart';
import '../../models/enums.dart';
import '../../models/match.dart';
import '../../models/match_type.dart';
import '../../models/member.dart';
import '../../models/official_assignment.dart';
import '../../providers/official_providers.dart';
import '../../shared/formatters/date_formatters.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/error_view.dart';
import 'widgets/assignment_status_chip.dart';

/// Données d'affichage unifiées d'un match — abstrait le booking (domicile) et
/// le match (extérieur).
class _MatchView {
  const _MatchView({
    required this.titleType,
    required this.opponentName,
    required this.date,
    required this.startTime,
    required this.endTime,
    required this.location,
    required this.matchTypeId,
  });

  final String titleType;
  final String? opponentName;
  final DateTime date;
  final String startTime;
  final String endTime;
  final String? location;
  final String? matchTypeId;

  /// `DateTime` de coup d'envoi = `date` (minuit) + `startTime` "HH:MM".
  DateTime get start {
    final parts = startTime.split(':');
    final h = parts.isNotEmpty ? int.tryParse(parts[0]) ?? 0 : 0;
    final m = parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0;
    return DateTime(date.year, date.month, date.day, h, m);
  }

  /// `DateTime` de fin = `date` + `endTime`.
  DateTime get end {
    final parts = endTime.split(':');
    final h = parts.isNotEmpty ? int.tryParse(parts[0]) ?? 0 : 0;
    final m = parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0;
    return DateTime(date.year, date.month, date.day, h, m);
  }

  factory _MatchView.fromBooking(Booking b) => _MatchView(
        titleType: 'Match à domicile',
        opponentName: b.opponentName,
        date: b.date,
        startTime: b.startTime,
        endTime: b.endTime,
        location: null,
        matchTypeId: b.matchTypeId,
      );

  factory _MatchView.fromMatch(Match m) => _MatchView(
        titleType: 'Match à l\'extérieur',
        opponentName: m.opponentName,
        date: m.date,
        startTime: m.startTime,
        endTime: m.endTime,
        location: m.awayAddress,
        matchTypeId: m.matchTypeId,
      );
}

/// Écran de détail d'un match — infos, besoins vs assignations, et action
/// d'auto-inscription ou de réponse selon l'état de l'officiel.
class MatchDetailScreen extends ConsumerWidget {
  const MatchDetailScreen({
    super.key,
    required this.parentKind,
    required this.parentId,
  });

  final OfficialAssignmentParent parentKind;
  final String parentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHome = parentKind == OfficialAssignmentParent.booking;
    final viewAsync = isHome
        ? ref.watch(bookingByIdProvider(parentId)).whenData(
              (b) => b == null ? null : _MatchView.fromBooking(b),
            )
        : ref.watch(matchByIdProvider(parentId)).whenData(
              (m) => m == null ? null : _MatchView.fromMatch(m),
            );

    return Scaffold(
      appBar: AppBar(title: const Text('Détail du match')),
      body: AsyncValueView<_MatchView?>(
        value: viewAsync,
        data: (view) {
          if (view == null) {
            return const ErrorView(
              error: AppException(
                kind: AppFailureKind.notFound,
                message: 'Match introuvable.',
              ),
            );
          }
          return _DetailBody(
            view: view,
            parentKind: parentKind,
            parentId: parentId,
          );
        },
      ),
    );
  }
}

/// Corps du détail — joint les assignations, le type de match et le membre
/// courant pour décider quelle action proposer.
class _DetailBody extends ConsumerWidget {
  const _DetailBody({
    required this.view,
    required this.parentKind,
    required this.parentId,
  });

  final _MatchView view;
  final OfficialAssignmentParent parentKind;
  final String parentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isHome = parentKind == OfficialAssignmentParent.booking;

    final assignmentsAsync = isHome
        ? ref.watch(assignmentsForBookingProvider(parentId))
        : ref.watch(assignmentsForMatchProvider(parentId));
    final memberAsync = ref.watch(currentMemberProvider);
    final typesById = ref.watch(matchTypesByIdProvider);
    final matchType =
        view.matchTypeId == null ? null : typesById[view.matchTypeId];

    return AsyncValueView<List<OfficialAssignment>>(
      value: assignmentsAsync,
      data: (assignments) {
        final member = memberAsync.value;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _InfoCard(view: view, matchType: matchType),
            const SizedBox(height: 12),
            _RequirementsCard(
              isHome: isHome,
              matchType: matchType,
              assignments: assignments,
            ),
            const SizedBox(height: 12),
            _ActionSection(
              view: view,
              parentKind: parentKind,
              parentId: parentId,
              matchType: matchType,
              assignments: assignments,
              member: member,
            ),
            const SizedBox(height: 8),
            if (member == null)
              Text(
                'Votre fiche membre n\'a pas pu être chargée.',
                style: theme.textTheme.bodySmall,
              ),
          ],
        );
      },
    );
  }
}

/// Carte des informations du match.
class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.view, required this.matchType});

  final _MatchView view;
  final MatchType? matchType;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              matchType?.name ?? view.titleType,
              style: theme.textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            if (view.opponentName != null)
              Text('vs ${view.opponentName}',
                  style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            _InfoRow(
              icon: Icons.event,
              text: DateFormatters.longDate(view.date),
            ),
            _InfoRow(
              icon: Icons.schedule,
              text: DateFormatters.timeRange(view.startTime, view.endTime),
            ),
            if (view.location != null && view.location!.isNotEmpty)
              _InfoRow(icon: Icons.place_outlined, text: view.location!),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: theme.colorScheme.outline),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

/// Carte des besoins d'officiels vs les assignations actuelles.
class _RequirementsCard extends StatelessWidget {
  const _RequirementsCard({
    required this.isHome,
    required this.matchType,
    required this.assignments,
  });

  final bool isHome;
  final MatchType? matchType;
  final List<OfficialAssignment> assignments;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final activeByLevel = <int, int>{};
    var activeTotal = 0;
    for (final a in assignments) {
      if (a.status == OfficialAssignmentStatus.declined) continue;
      activeTotal++;
      activeByLevel.update(a.officialLevel, (n) => n + 1, ifAbsent: () => 1);
    }

    final rows = <Widget>[];
    if (matchType == null) {
      rows.add(const Text('Type de match inconnu.'));
    } else if (isHome) {
      if (matchType!.homeOfficialRequirements.isEmpty) {
        rows.add(const Text('Aucun besoin d\'officiel défini.'));
      }
      for (final req in matchType!.homeOfficialRequirements) {
        final filled = activeByLevel[req.level] ?? 0;
        rows.add(_ReqRow(
          label: 'Niveau ${req.level}',
          filled: filled,
          total: req.count,
        ));
      }
    } else {
      rows.add(_ReqRow(
        label: 'Officiels',
        filled: activeTotal,
        total: matchType!.awayOfficialCount,
      ));
    }

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Besoins en officiels', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            ...rows,
          ],
        ),
      ),
    );
  }
}

class _ReqRow extends StatelessWidget {
  const _ReqRow({
    required this.label,
    required this.filled,
    required this.total,
  });

  final String label;
  final int filled;
  final int total;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final complete = filled >= total;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(
            complete ? Icons.check_circle : Icons.radio_button_unchecked,
            size: 18,
            color: complete
                ? theme.colorScheme.primary
                : theme.colorScheme.outline,
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
          Text('$filled / $total', style: theme.textTheme.bodyMedium),
        ],
      ),
    );
  }
}

/// Section d'action — auto-inscription, état d'attente, ou confirmation.
class _ActionSection extends ConsumerStatefulWidget {
  const _ActionSection({
    required this.view,
    required this.parentKind,
    required this.parentId,
    required this.matchType,
    required this.assignments,
    required this.member,
  });

  final _MatchView view;
  final OfficialAssignmentParent parentKind;
  final String parentId;
  final MatchType? matchType;
  final List<OfficialAssignment> assignments;
  final Member? member;

  @override
  ConsumerState<_ActionSection> createState() => _ActionSectionState();
}

class _ActionSectionState extends ConsumerState<_ActionSection> {
  bool _busy = false;

  /// Assignation de l'officiel courant sur ce match, le cas échéant.
  OfficialAssignment? get _myAssignment {
    final memberId = widget.member?.id;
    if (memberId == null) return null;
    for (final a in widget.assignments) {
      if (a.memberId == memberId) return a;
    }
    return null;
  }

  /// `true` s'il reste une place ouverte que l'officiel peut occuper.
  bool get _slotOpenAtMyLevel {
    final member = widget.member;
    final matchType = widget.matchType;
    if (member == null || matchType == null) return false;

    if (widget.parentKind == OfficialAssignmentParent.match) {
      final active = widget.assignments
          .where((a) => a.status != OfficialAssignmentStatus.declined)
          .length;
      return active < matchType.awayOfficialCount;
    }

    final myLevel = member.officialLevel;
    if (myLevel == null) return false;
    return openHomeSlotsAtLevel(
          matchType: matchType,
          assignments: widget.assignments,
          myLevel: myLevel,
        ) >
        0;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mine = _myAssignment;

    // Cas 1 : l'officiel a déjà une assignation.
    if (mine != null) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('Votre inscription',
                      style: theme.textTheme.titleMedium),
                  const Spacer(),
                  AssignmentStatusChip(status: mine.status),
                ],
              ),
              if (mine.status == OfficialAssignmentStatus.pending) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _busy
                            ? null
                            : () =>
                                _respond(OfficialAssignmentStatus.declined),
                        child: const Text('Décliner'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        onPressed: _busy
                            ? null
                            : () =>
                                _respond(OfficialAssignmentStatus.confirmed),
                        child: const Text('Confirmer'),
                      ),
                    ),
                  ],
                ),
              ],
              if (mine.status == OfficialAssignmentStatus.confirmed) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _addToCalendar,
                  icon: const Icon(Icons.event_available),
                  label: const Text('Ajouter à mon agenda'),
                ),
              ],
            ],
          ),
        ),
      );
    }

    // Cas 2 : pas d'assignation — bouton d'auto-inscription si éligible.
    final member = widget.member;
    final isActiveOfficial = member?.officialLicense != null;
    final canRegister = isActiveOfficial && _slotOpenAtMyLevel;

    if (!isActiveOfficial) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            'Vous n\'avez pas de licence d\'officiel active : '
            'inscription impossible.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
      );
    }

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!_slotOpenAtMyLevel)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  'Aucune place ouverte à votre niveau pour ce match.',
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            FilledButton.icon(
              onPressed: (canRegister && !_busy) ? _selfRegister : null,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.how_to_reg),
              label: const Text('M\'inscrire à ce match'),
            ),
          ],
        ),
      ),
    );
  }

  /// Auto-inscription : crée l'assignation, planifie les rappels locaux, puis
  /// propose l'ajout au calendrier.
  Future<void> _selfRegister() async {
    final repo = ref.read(officialAssignmentRepositoryProvider);
    final member = widget.member;
    if (repo == null || member == null) return;
    final level = member.officialLevel;
    if (level == null) return;

    setState(() => _busy = true);
    try {
      await repo.selfRegister(
        parentKind: widget.parentKind,
        parentId: widget.parentId,
        memberId: member.id,
        officialLevel: level,
      );
      // Rappels locaux 24h / 3h avant le coup d'envoi.
      await ref.read(localNotificationRepositoryProvider).scheduleMatchReminders(
            matchKey: widget.parentId,
            matchStart: widget.view.start,
            body: widget.view.opponentName != null
                ? 'Match vs ${widget.view.opponentName}.'
                : 'Vous officiez bientôt.',
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Inscription enregistrée.')),
      );
      await _promptCalendar();
    } catch (error) {
      if (!mounted) return;
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Confirme ou décline. Sur un decline, annule les rappels locaux.
  Future<void> _respond(OfficialAssignmentStatus status) async {
    final repo = ref.read(officialAssignmentRepositoryProvider);
    final mine = _myAssignment;
    if (repo == null || mine == null) return;

    setState(() => _busy = true);
    try {
      await repo.respond(
        parentKind: widget.parentKind,
        parentId: widget.parentId,
        assignmentId: mine.id,
        status: status,
      );
      if (status == OfficialAssignmentStatus.declined) {
        await ref
            .read(localNotificationRepositoryProvider)
            .cancelMatchReminders(widget.parentId);
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
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Dialogue « Ajouter à mon agenda » proposé après l'auto-inscription.
  Future<void> _promptCalendar() async {
    if (!mounted) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Ajouter à mon agenda'),
        content: const Text(
          'Voulez-vous ajouter ce match à votre calendrier ?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Plus tard'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Ajouter'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _addToCalendar();
    }
  }

  /// Ouvre l'éditeur de calendrier natif avec l'événement du match.
  Future<void> _addToCalendar() async {
    final opponent = widget.view.opponentName;
    await ref.read(calendarServiceProvider).addMatchEvent(
          title: opponent != null
              ? 'Match vs $opponent'
              : widget.view.titleType,
          start: widget.view.start,
          end: widget.view.end,
          location: widget.view.location,
          description: 'Vous officiez ce match.',
        );
  }

  void _showError(Object error) {
    final message =
        error is AppException ? error.message : 'Échec de l\'opération.';
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}
