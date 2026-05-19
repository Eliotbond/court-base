import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/official_assignment.dart';
import '../../providers/official_providers.dart';
import '../../shared/formatters/date_formatters.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/empty_state.dart';
import 'official_routes.dart';

/// Écran d'accueil de la branche officiel.
///
/// Deux onglets : « Matchs à pourvoir » (domicile) et « À l'extérieur ».
/// Une action vers « Mes assignations » est offerte dans l'AppBar.
class OfficialHomeScreen extends ConsumerWidget {
  const OfficialHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Officiel'),
          actions: [
            IconButton(
              icon: const Icon(Icons.assignment_outlined),
              tooltip: 'Mes assignations',
              onPressed: () =>
                  context.go(OfficialRoutes.myAssignmentsLocation),
            ),
          ],
          bottom: const TabBar(
            tabs: [
              Tab(text: 'À domicile'),
              Tab(text: 'À l\'extérieur'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _HomeMatchesTab(),
            _AwayMatchesTab(),
          ],
        ),
      ),
    );
  }
}

/// Onglet des matchs à domicile à pourvoir.
class _HomeMatchesTab extends ConsumerWidget {
  const _HomeMatchesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final needs = ref.watch(matchesNeedingOfficialsProvider);
    return AsyncValueView<List<HomeMatchNeed>>(
      value: needs,
      onRetry: () => ref.invalidate(homeMatchBookingsProvider),
      data: (list) {
        if (list.isEmpty) {
          return const EmptyState(
            icon: Icons.sports_basketball_outlined,
            title: 'Aucun match à pourvoir',
            message:
                'Les matchs à domicile cherchant un officiel de votre niveau '
                'apparaîtront ici.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.all(12),
          itemCount: list.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (context, i) {
            final need = list[i];
            return _NeedCard(
              title: need.matchType?.name ?? 'Match à domicile',
              subtitle: need.booking.opponentName != null
                  ? 'vs ${need.booking.opponentName}'
                  : 'Match à domicile',
              date: need.booking.date,
              timeRange: DateFormatters.timeRange(
                need.booking.startTime,
                need.booking.endTime,
              ),
              openSlots: need.openSlotsAtMyLevel,
              onTap: () => context.go(
                OfficialRoutes.matchDetailLocation(
                  kind: OfficialAssignmentParent.booking,
                  id: need.booking.id,
                ),
              ),
            );
          },
        );
      },
    );
  }
}

/// Onglet des matchs à l'extérieur à pourvoir.
class _AwayMatchesTab extends ConsumerWidget {
  const _AwayMatchesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final needs = ref.watch(awayMatchesNeedingOfficialsProvider);
    return AsyncValueView<List<AwayMatchNeed>>(
      value: needs,
      onRetry: () => ref.invalidate(awayMatchesProvider),
      data: (list) {
        if (list.isEmpty) {
          return const EmptyState(
            icon: Icons.directions_bus_outlined,
            title: 'Aucun match à pourvoir',
            message:
                'Les matchs à l\'extérieur cherchant un officiel '
                'apparaîtront ici.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.all(12),
          itemCount: list.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (context, i) {
            final need = list[i];
            return _NeedCard(
              title: need.matchType?.name ?? 'Match à l\'extérieur',
              subtitle: need.match.opponentName != null
                  ? 'vs ${need.match.opponentName}'
                  : 'Match à l\'extérieur',
              date: need.match.date,
              timeRange: DateFormatters.timeRange(
                need.match.startTime,
                need.match.endTime,
              ),
              openSlots: need.openSlots,
              onTap: () => context.go(
                OfficialRoutes.matchDetailLocation(
                  kind: OfficialAssignmentParent.match,
                  id: need.match.id,
                ),
              ),
            );
          },
        );
      },
    );
  }
}

/// Carte d'un match à pourvoir.
class _NeedCard extends StatelessWidget {
  const _NeedCard({
    required this.title,
    required this.subtitle,
    required this.date,
    required this.timeRange,
    required this.openSlots,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final DateTime date;
  final String timeRange;
  final int openSlots;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        onTap: onTap,
        title: Text(title, style: theme.textTheme.titleMedium),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Text(subtitle),
            const SizedBox(height: 2),
            Text('${DateFormatters.shortDate(date)} · $timeRange'),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              '$openSlots',
              style: theme.textTheme.titleLarge?.copyWith(
                color: theme.colorScheme.primary,
              ),
            ),
            Text(
              openSlots > 1 ? 'places' : 'place',
              style: theme.textTheme.labelSmall,
            ),
          ],
        ),
      ),
    );
  }
}
