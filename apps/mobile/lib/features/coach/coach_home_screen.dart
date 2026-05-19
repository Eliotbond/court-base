import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/coach_providers.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/empty_state.dart';
import 'coach_routes.dart';

/// Écran d'accueil de la branche coach — liste des équipes coachées.
///
/// Sert la racine de la branche coach (`/coaching`). Un appui sur une équipe
/// ouvre son effectif (route `coach-roster`).
class CoachHomeScreen extends ConsumerWidget {
  const CoachHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teamsAsync = ref.watch(myTeamsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Mes équipes')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(myTeamsProvider);
          ref.invalidate(categoriesByIdProvider);
        },
        child: AsyncValueView<List<CoachTeam>>(
          value: teamsAsync,
          onRetry: () => ref.invalidate(myTeamsProvider),
          data: (teams) {
            if (teams.isEmpty) {
              return ListView(
                children: const [
                  SizedBox(height: 80),
                  EmptyState(
                    icon: Icons.groups_outlined,
                    title: 'Aucune équipe',
                    message:
                        'Vous ne coachez aucune équipe pour le moment. '
                        'Contactez un administrateur du club.',
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: teams.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final coachTeam = teams[index];
                return _TeamTile(coachTeam: coachTeam);
              },
            );
          },
        ),
      ),
    );
  }
}

class _TeamTile extends StatelessWidget {
  const _TeamTile({required this.coachTeam});

  final CoachTeam coachTeam;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final team = coachTeam.team;
    final playerCount = team.playerIds.length;
    final subtitleParts = <String>[
      if (coachTeam.categoryName != null) coachTeam.categoryName!,
      '$playerCount joueur${playerCount > 1 ? 's' : ''}',
    ];

    return ListTile(
      leading: CircleAvatar(
        backgroundColor: theme.colorScheme.primaryContainer,
        child: Icon(
          Icons.sports_basketball_outlined,
          color: theme.colorScheme.onPrimaryContainer,
        ),
      ),
      title: Text(
        team.name,
        style: theme.textTheme.titleMedium,
      ),
      subtitle: Text(subtitleParts.join(' · ')),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.go(CoachRoutes.rosterLocation(team.id)),
    );
  }
}
