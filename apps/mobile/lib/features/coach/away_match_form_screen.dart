import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/match_type.dart';
import '../../providers/coach_providers.dart';
import '../../shared/formatters/date_formatters.dart';
import 'coach_routes.dart';
import 'widgets/coach_widgets.dart';

/// Formulaire de création d'un match à l'extérieur.
///
/// `/matches` étant write-admin-only, la création passe par la callable
/// `coachCreateAwayMatch` (re-vérifie le scope coach côté serveur et libère
/// les entraînements en conflit).
class AwayMatchFormScreen extends ConsumerStatefulWidget {
  const AwayMatchFormScreen({super.key, required this.teamId});

  final String teamId;

  @override
  ConsumerState<AwayMatchFormScreen> createState() =>
      _AwayMatchFormScreenState();
}

class _AwayMatchFormScreenState extends ConsumerState<AwayMatchFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _opponentController = TextEditingController();
  final _addressController = TextEditingController();
  final _notesController = TextEditingController();

  String? _matchTypeId;
  DateTime? _date;
  TimeOfDay? _startTime;
  TimeOfDay? _endTime;
  bool _submitting = false;

  @override
  void dispose() {
    _opponentController.dispose();
    _addressController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final matchTypesAsync = ref.watch(matchTypesProvider);
    final coachTeam = ref.watch(coachTeamByIdProvider(widget.teamId));

    return Scaffold(
      appBar: AppBar(title: const Text('Match à l\'extérieur')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (coachTeam != null) ...[
                  Text(
                    'Équipe : ${coachTeam.name}',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 16),
                ],
                matchTypesAsync.when(
                  loading: () => const LinearProgressIndicator(),
                  error: (e, _) => Text(
                    'Types de match indisponibles : ${_errorText(e)}',
                    style: TextStyle(
                        color: Theme.of(context).colorScheme.error),
                  ),
                  data: (types) => DropdownButtonFormField<String>(
                    value: _matchTypeId,
                    decoration: const InputDecoration(
                      labelText: 'Type de match *',
                      border: OutlineInputBorder(),
                    ),
                    items: types
                        .map((MatchType t) => DropdownMenuItem(
                              value: t.id,
                              child: Text(t.name),
                            ))
                        .toList(growable: false),
                    onChanged: (v) => setState(() => _matchTypeId = v),
                    validator: (v) =>
                        v == null ? 'Sélectionnez un type' : null,
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _opponentController,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Adversaire *',
                    border: OutlineInputBorder(),
                  ),
                  validator: _requiredValidator,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _addressController,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Adresse de la salle *',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 2,
                  validator: _requiredValidator,
                ),
                const SizedBox(height: 16),
                _PickerTile(
                  label: 'Date *',
                  value: _date == null
                      ? null
                      : DateFormatters.numericDate(_date!),
                  icon: Icons.calendar_today_outlined,
                  onTap: _pickDate,
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _PickerTile(
                        label: 'Début *',
                        value: _startTime?.format(context),
                        icon: Icons.schedule,
                        onTap: () => _pickTime(isStart: true),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _PickerTile(
                        label: 'Fin *',
                        value: _endTime?.format(context),
                        icon: Icons.schedule,
                        onTap: () => _pickTime(isStart: false),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _notesController,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Notes (optionnel)',
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
                          child:
                              CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Créer le match'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickTime({required bool isStart}) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: (isStart ? _startTime : _endTime) ??
          const TimeOfDay(hour: 18, minute: 0),
    );
    if (picked != null) {
      setState(() {
        if (isStart) {
          _startTime = picked;
        } else {
          _endTime = picked;
        }
      });
    }
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_date == null || _startTime == null || _endTime == null) {
      showCoachSnack(context, 'Renseignez la date et les horaires.',
          isError: true);
      return;
    }
    setState(() => _submitting = true);

    final callables = ref.read(callablesRepositoryProvider);
    // La callable attend `date` en epoch-millis ; elle pose `match.date` à
    // minuit UTC côté serveur. On envoie minuit UTC du jour choisi pour
    // éviter tout glissement de fuseau.
    final dateUtc = DateTime.utc(_date!.year, _date!.month, _date!.day);

    try {
      final result = await callables.coachCreateAwayMatch(
        teamId: widget.teamId,
        matchTypeId: _matchTypeId!,
        opponentName: _opponentController.text.trim(),
        awayAddress: _addressController.text.trim(),
        date: dateUtc.millisecondsSinceEpoch,
        startTime: _formatTime(_startTime!),
        endTime: _formatTime(_endTime!),
        notes: _notesController.text.trim(),
      );
      if (!mounted) return;
      final freed = result.freedBookingIds.length;
      showCoachSnack(
        context,
        freed > 0
            ? 'Match créé. $freed entraînement(s) libéré(s).'
            : 'Match à l\'extérieur créé.',
      );
      _leaveToRoster(context, widget.teamId);
    } catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showCoachSnack(context, _errorText(error), isError: true);
    }
  }

  static String _formatTime(TimeOfDay t) {
    final h = t.hour.toString().padLeft(2, '0');
    final m = t.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }
}

/// Tuile cliquable type « champ » pour date / heure.
class _PickerTile extends StatelessWidget {
  const _PickerTile({
    required this.label,
    required this.value,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final String? value;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: Icon(icon),
        ),
        child: Text(
          value ?? 'Sélectionner',
          style: value == null
              ? TextStyle(color: Theme.of(context).hintColor)
              : null,
        ),
      ),
    );
  }
}

String? _requiredValidator(String? value) {
  if (value == null || value.trim().isEmpty) return 'Champ obligatoire';
  return null;
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
