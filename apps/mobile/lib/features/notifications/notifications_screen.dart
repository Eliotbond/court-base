import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/app_notification.dart';
import '../../models/enums.dart';
import '../../providers/auth_providers.dart';
import '../../providers/notification_providers.dart';
import '../../shared/formatters/date_formatters.dart';
import '../../shared/theme/app_colors.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/empty_state.dart';

/// Branche notifications du shell — liste temps réel des notifications du
/// club, triées de la plus récente à la plus ancienne.
///
/// Au tap : marque la notification lue (`readBy` arrayUnion) et, si elle
/// référence un match / booking, affiche le détail du lien.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificationsAsync = ref.watch(notificationsStreamProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: AsyncValueView<List<AppNotification>>(
        value: notificationsAsync,
        onRetry: () => ref.invalidate(notificationsStreamProvider),
        data: (notifications) {
          if (notifications.isEmpty) {
            return RefreshIndicator(
              onRefresh: () async =>
                  ref.invalidate(notificationsStreamProvider),
              child: ListView(
                children: const [
                  SizedBox(height: 120),
                  EmptyState(
                    icon: Icons.notifications_none,
                    title: 'Aucune notification',
                    message:
                        'Vous serez prévenu ici des matchs et des urgences.',
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(notificationsStreamProvider),
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: notifications.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final notification = notifications[index];
                return _NotificationTile(notification: notification);
              },
            ),
          );
        },
      ),
    );
  }
}

/// Une ligne de notification — style renforcé tant qu'elle n'est pas lue.
class _NotificationTile extends ConsumerWidget {
  const _NotificationTile({required this.notification});

  final AppNotification notification;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final uid = ref.watch(appUserProvider)?.id;
    final isUnread = uid != null && !notification.isReadBy(uid);

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      leading: _NotificationIcon(
        type: notification.type,
        highlighted: isUnread,
      ),
      title: Text(
        notification.title,
        style: theme.textTheme.titleSmall?.copyWith(
          fontWeight: isUnread ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Text(notification.body),
          const SizedBox(height: 4),
          Text(
            DateFormatters.dateTime(notification.createdAt),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
      trailing: isUnread
          ? Container(
              width: 10,
              height: 10,
              decoration: const BoxDecoration(
                color: AppColors.brand,
                shape: BoxShape.circle,
              ),
            )
          : null,
      tileColor: isUnread
          ? theme.colorScheme.primaryContainer.withValues(alpha: 0.22)
          : null,
      onTap: () => _onTap(context, ref, uid),
    );
  }

  Future<void> _onTap(
    BuildContext context,
    WidgetRef ref,
    String? uid,
  ) async {
    // Marque lue (best-effort — un échec rules ne bloque pas le deep-link).
    if (uid != null && !notification.isReadBy(uid)) {
      try {
        await ref
            .read(notificationRepositoryProvider)
            .markRead(notification.id, uid);
      } catch (_) {
        // Erreur déjà loggée par le repository ; on continue.
      }
    }

    if (!context.mounted) return;

    // Deep-link : si la notification référence un match / booking, on ouvre
    // une fiche de détail. Les écrans cibles dédiés appartiennent aux autres
    // branches du shell ; on présente ici le contexte du lien.
    final relatedId =
        notification.relatedMatchId ?? notification.relatedBookingId;
    if (relatedId != null) {
      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (context) => _NotificationDetailSheet(
          notification: notification,
        ),
      );
    }
  }
}

/// Pastille d'icône typée selon [NotificationType].
class _NotificationIcon extends StatelessWidget {
  const _NotificationIcon({required this.type, required this.highlighted});

  final NotificationType type;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (type) {
      NotificationType.newMatch => (Icons.event_available, AppColors.info),
      NotificationType.officialsNeeded => (
          Icons.sports_outlined,
          AppColors.warning,
        ),
      NotificationType.urgent => (Icons.priority_high, AppColors.danger),
      NotificationType.matchReminder => (Icons.alarm, AppColors.success),
    };

    return CircleAvatar(
      backgroundColor: color.withValues(alpha: highlighted ? 0.18 : 0.10),
      foregroundColor: color,
      child: Icon(icon, size: 22),
    );
  }
}

/// Détail d'une notification liée à un match / booking — feuille modale.
class _NotificationDetailSheet extends StatelessWidget {
  const _NotificationDetailSheet({required this.notification});

  final AppNotification notification;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final relatedMatchId = notification.relatedMatchId;
    final relatedBookingId = notification.relatedBookingId;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(notification.title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(notification.body, style: theme.textTheme.bodyMedium),
            const SizedBox(height: 16),
            if (relatedMatchId != null)
              _LinkRow(
                icon: Icons.sports_basketball,
                label: 'Match concerné',
                value: relatedMatchId,
              ),
            if (relatedBookingId != null)
              _LinkRow(
                icon: Icons.event,
                label: 'Réservation concernée',
                value: relatedBookingId,
              ),
            const SizedBox(height: 12),
            Text(
              'Ouvrez l\'onglet Officiel pour gérer ce match.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Ligne libellé + identifiant pour la feuille de détail.
class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 20, color: theme.colorScheme.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: theme.textTheme.labelSmall),
                Text(value, style: theme.textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
