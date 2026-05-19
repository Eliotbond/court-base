import 'package:flutter/material.dart';

import '../../../models/enums.dart';
import '../../../shared/theme/app_colors.dart';

/// Chip coloré reflétant le statut d'une assignation d'officiel.
class AssignmentStatusChip extends StatelessWidget {
  const AssignmentStatusChip({super.key, required this.status});

  final OfficialAssignmentStatus status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      OfficialAssignmentStatus.pending => ('En attente', AppColors.warning),
      OfficialAssignmentStatus.confirmed => ('Confirmé', AppColors.success),
      OfficialAssignmentStatus.declined => ('Décliné', AppColors.danger),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
