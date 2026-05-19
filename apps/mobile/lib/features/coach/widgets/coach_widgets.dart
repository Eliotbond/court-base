import 'package:flutter/material.dart';

import '../../../models/enums.dart';
import '../../../models/member.dart';
import '../../../shared/theme/app_colors.dart';

/// Petite pastille de statut colorée — libellé + couleur sémantique.
class StatusChip extends StatelessWidget {
  const StatusChip({
    super.key,
    required this.label,
    required this.color,
    this.icon,
  });

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Badge de statut de cotisation d'un membre.
class DuesStatusBadge extends StatelessWidget {
  const DuesStatusBadge({super.key, required this.status});

  final DuesStatus status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      DuesStatus.ok => ('À jour', AppColors.success),
      DuesStatus.pendingGrace => ('Délai', AppColors.warning),
      DuesStatus.due => ('Due', AppColors.warning),
      DuesStatus.overdue => ('En retard', AppColors.danger),
      DuesStatus.excluded => ('Exclu', AppColors.danger),
      DuesStatus.excepted => ('Exception', AppColors.info),
      DuesStatus.na => ('—', AppColors.info),
    };
    return StatusChip(label: label, color: color);
  }
}

/// Badge de licence d'un membre (active / non licencié).
class LicenseBadge extends StatelessWidget {
  const LicenseBadge({super.key, required this.member});

  final Member member;

  @override
  Widget build(BuildContext context) {
    final licensed = member.licensed;
    return StatusChip(
      label: licensed ? 'Licencié' : 'Sans licence',
      color: licensed ? AppColors.success : AppColors.info,
      icon: licensed ? Icons.verified_outlined : Icons.badge_outlined,
    );
  }
}

/// Badge de statut d'une inscription.
class RegistrationStatusBadge extends StatelessWidget {
  const RegistrationStatusBadge({super.key, required this.status});

  final RegistrationStatus status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      RegistrationStatus.draft => ('Brouillon', AppColors.info),
      RegistrationStatus.submitted => ('Soumise', AppColors.warning),
      RegistrationStatus.openPendingTrial =>
        ('Essai à planifier', AppColors.warning),
      RegistrationStatus.conditionalPendingReview =>
        ('À examiner', AppColors.warning),
      RegistrationStatus.conditionalPendingTrial =>
        ('Essai à planifier', AppColors.warning),
      RegistrationStatus.trialInProgress => ('En essai', AppColors.info),
      RegistrationStatus.confirmedPendingDues =>
        ('Confirmée', AppColors.success),
      RegistrationStatus.active => ('Active', AppColors.success),
      RegistrationStatus.refused => ('Refusée', AppColors.danger),
      RegistrationStatus.cancelled => ('Annulée', AppColors.danger),
    };
    return StatusChip(label: label, color: color);
  }
}

/// Affiche un `SnackBar` de succès / d'erreur de façon homogène.
void showCoachSnack(
  BuildContext context,
  String message, {
  bool isError = false,
}) {
  ScaffoldMessenger.of(context)
    ..clearSnackBars()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? AppColors.danger : AppColors.success,
        behavior: SnackBarBehavior.floating,
      ),
    );
}
