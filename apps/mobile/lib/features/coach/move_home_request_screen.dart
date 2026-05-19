import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/booking.dart';
import '../../providers/auth_providers.dart';
import '../../providers/coach_providers.dart';
import '../../shared/formatters/date_formatters.dart';
import '../../shared/widgets/async_value_view.dart';
import '../../shared/widgets/empty_state.dart';
import 'coach_routes.dart';
import 'widgets/coach_widgets.dart';

/// Demande de déplacement d'un match à domicile.
///
/// Le coach choisit un booking `match_home` de son équipe, propose
/// optionnellement une nouvelle date, et motive la demande. Les rules
/// autorisent un coach à créer directement un `/matchRequests` — pas de
/// callable. La validation est faite par l'admin sur le web.
class MoveHomeRequestScreen extends ConsumerStatefulWidget {
  const MoveHomeRequestScreen({super.key, required this.teamId});

  final String teamId;

  @override
  ConsumerState<MoveHomeRequestScreen> createState() =>
      _MoveHomeRequestScreenState();
}

class _MoveHomeRequestScreenState
    extends ConsumerState<MoveHomeRequestScreen> {
  final _reasonController = TextEditingController();
  Booking? _selected;
  DateTime? _proposedDate;
  bool _submitting = false;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync =
        ref.watch(homeMatchBookingsForTeamProvider(widget.teamId));

    return Scaffold(
      appBar: AppBar(title: const Text('Déplacer un match')),
      body: AsyncValueView<List<Booking>>(
        value: bookingsAsync,
        onRetry: () =>
            ref.invalidate(homeMatchBookingsForTeamProvider(widget.teamId)),
        data: (bookings) {
          if (bookings.isEmpty) {
            return const EmptyState(
              icon: Icons.event_busy_outlined,
              title: 'Aucun match à domicile',
              message:
                  'Aucun match à domicile à venir pour cette équipe.',
            );
          }
          return SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Match à déplacer',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  ...bookings.map((b) => _BookingTile(
                        booking: b,
                        selected: _selected?.id == b.id,
                        onTap: () => setState(() => _selected = b),
                      )),
                  const SizedBox(height: 24),
                  Text(
                    'Nouvelle date proposée (optionnel)',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  InkWell(
                    onTap: _pickProposedDate,
                    child: InputDecorator(
                      decoration: InputDecoration(
                        border: const OutlineInputBorder(),
                        suffixIcon: _proposedDate == null
                            ? const Icon(Icons.calendar_today_outlined)
                            : IconButton(
                                icon: const Icon(Icons.clear),
                                onPressed: () =>
                                    setState(() => _proposedDate = null),
                              ),
                      ),
                      child: Text(
                        _proposedDate == null
                            ? 'Aucune préférence'
                            : DateFormatters.numericDate(_proposedDate!),
                        style: _proposedDate == null
                            ? TextStyle(color: Theme.of(context).hintColor)
                            : null,
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  TextField(
                    controller: _reasonController,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Motif de la demande',
                      border: OutlineInputBorder(),
                    ),
                    maxLines: 3,
                  ),
                  const SizedBox(height: 28),
                  FilledButton(
                    onPressed: _submitting ? null : _submit,
                    child: _submitting
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2),
                          )
                        : const Text('Envoyer la demande'),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _pickProposedDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _proposedDate ?? now,
      firstDate: now,
      lastDate: DateTime(now.year + 2),
    );
    if (picked != null) setState(() => _proposedDate = picked);
  }

  Future<void> _submit() async {
    final selected = _selected;
    if (selected == null) {
      showCoachSnack(context, 'Sélectionnez un match à déplacer.',
          isError: true);
      return;
    }
    final user = ref.read(appUserProvider);
    if (user == null) {
      showCoachSnack(context, 'Session expirée.', isError: true);
      return;
    }
    setState(() => _submitting = true);

    final repo = ref.read(matchRequestRepositoryProvider);
    final reason = _reasonController.text.trim();
    try {
      await repo.createMoveHomeRequest(
        bookingId: selected.id,
        requestedByUid: user.id,
        proposedDate: _proposedDate,
        reason: reason.isEmpty ? null : reason,
      );
      if (!mounted) return;
      showCoachSnack(context, 'Demande envoyée à l\'administration.');
      _leaveToRoster(context, widget.teamId);
    } catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showCoachSnack(context, _errorText(error), isError: true);
    }
  }
}

/// Tuile sélectionnable d'un booking de match à domicile.
class _BookingTile extends StatelessWidget {
  const _BookingTile({
    required this.booking,
    required this.selected,
    required this.onTap,
  });

  final Booking booking;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final opponent = booking.opponentName?.trim();
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      color: selected ? theme.colorScheme.primaryContainer : null,
      child: ListTile(
        leading: Icon(
          selected
              ? Icons.radio_button_checked
              : Icons.radio_button_unchecked,
          color: selected ? theme.colorScheme.primary : null,
        ),
        title: Text(
          opponent == null || opponent.isEmpty
              ? 'Match à domicile'
              : 'vs $opponent',
        ),
        subtitle: Text(
          '${DateFormatters.shortDate(booking.date)} · '
          '${DateFormatters.timeRange(booking.startTime, booking.endTime)}',
        ),
        onTap: onTap,
      ),
    );
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
