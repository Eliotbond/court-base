import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/member.dart';
import '../../providers/coach_providers.dart';
import '../../providers/firebase_providers.dart';
import '../../shared/formatters/date_formatters.dart';
import 'coach_routes.dart';
import 'widgets/coach_widgets.dart';

/// Formulaire de création / édition d'un membre.
///
/// - Création (`memberId == null`) → `coachCreateMember`.
/// - Édition (`memberId != null`)  → `coachUpdateMember`.
///
/// `/members` étant write-admin-only, l'écriture passe exclusivement par les
/// callables. Les contacts (`email`/`phone`) sont chargés depuis
/// `/members/{id}/private/contact` en mode édition (tolère `permission-denied`).
class MemberFormScreen extends ConsumerStatefulWidget {
  const MemberFormScreen({
    super.key,
    required this.teamId,
    this.memberId,
  });

  final String teamId;

  /// `null` = création ; sinon édition du membre ciblé.
  final String? memberId;

  bool get isEdit => memberId != null;

  @override
  ConsumerState<MemberFormScreen> createState() => _MemberFormScreenState();
}

class _MemberFormScreenState extends ConsumerState<MemberFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();

  DateTime? _birthDate;
  bool _loadingExisting = false;
  bool _submitting = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) {
      _loadExisting();
    }
  }

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _loadExisting() async {
    setState(() => _loadingExisting = true);
    final memberRepo = ref.read(memberRepositoryProvider);
    try {
      final member = await memberRepo
          .watchMember(widget.memberId!)
          .firstWhere((m) => m != null, orElse: () => null);
      MemberContact? contact;
      try {
        contact = await memberRepo.getContact(widget.memberId!);
      } catch (_) {
        contact = null;
      }
      if (!mounted) return;
      setState(() {
        if (member != null) {
          _firstNameController.text = member.firstName;
          _lastNameController.text = member.lastName;
          _birthDate = member.birthDate;
        }
        if (contact != null) {
          _emailController.text = contact.email;
          _phoneController.text = contact.phone;
        }
        _loadingExisting = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadError = _errorText(error);
        _loadingExisting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isEdit ? 'Modifier le joueur' : 'Nouveau joueur'),
      ),
      body: _loadingExisting
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_loadError != null) ...[
                        Text(
                          'Certaines données n\'ont pas pu être chargées : '
                          '$_loadError',
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      TextFormField(
                        controller: _firstNameController,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(
                          labelText: 'Prénom *',
                          border: OutlineInputBorder(),
                        ),
                        validator: _requiredValidator,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _lastNameController,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(
                          labelText: 'Nom *',
                          border: OutlineInputBorder(),
                        ),
                        validator: _requiredValidator,
                      ),
                      const SizedBox(height: 16),
                      _BirthDateField(
                        value: _birthDate,
                        onPick: _pickBirthDate,
                        onClear: () => setState(() => _birthDate = null),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(
                          labelText: 'E-mail',
                          border: OutlineInputBorder(),
                        ),
                        validator: _emailValidator,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                          labelText: 'Téléphone',
                          border: OutlineInputBorder(),
                        ),
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
                            : Text(widget.isEdit
                                ? 'Enregistrer'
                                : 'Créer le joueur'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
    );
  }

  Future<void> _pickBirthDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _birthDate ?? DateTime(now.year - 12),
      firstDate: DateTime(now.year - 80),
      lastDate: now,
      helpText: 'Date de naissance',
    );
    if (picked != null) {
      setState(() => _birthDate = picked);
    }
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _submitting = true);

    final callables = ref.read(callablesRepositoryProvider);
    final firstName = _firstNameController.text.trim();
    final lastName = _lastNameController.text.trim();
    final email = _emailController.text.trim();
    final phone = _phoneController.text.trim();
    final birthMillis = _birthDate?.millisecondsSinceEpoch;

    try {
      if (widget.isEdit) {
        await callables.coachUpdateMember(
          memberId: widget.memberId!,
          firstName: firstName,
          lastName: lastName,
          birthDate: birthMillis,
          clearBirthDate: _birthDate == null,
          email: email.isEmpty ? null : email,
          phone: phone.isEmpty ? null : phone,
        );
        if (!mounted) return;
        showCoachSnack(context, 'Joueur mis à jour.');
      } else {
        final result = await callables.coachCreateMember(
          teamId: widget.teamId,
          firstName: firstName,
          lastName: lastName,
          birthDate: birthMillis,
          email: email.isEmpty ? null : email,
          phone: phone.isEmpty ? null : phone,
        );
        if (!mounted) return;
        showCoachSnack(
          context,
          result.memberCreated
              ? 'Joueur créé et ajouté à l\'équipe.'
              : 'Joueur existant rattaché à l\'équipe.',
        );
      }
      ref.invalidate(rosterProvider(widget.teamId));
      if (mounted) _leave();
    } catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showCoachSnack(context, _errorText(error), isError: true);
    }
  }

  /// Retourne à l'effectif. `context.pop()` si possible (navigation interne),
  /// sinon `context.go` vers le roster (cas d'un deep-link sans back-stack).
  void _leave() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(CoachRoutes.rosterLocation(widget.teamId));
    }
  }
}

/// Champ de sélection de la date de naissance.
class _BirthDateField extends StatelessWidget {
  const _BirthDateField({
    required this.value,
    required this.onPick,
    required this.onClear,
  });

  final DateTime? value;
  final VoidCallback onPick;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPick,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: 'Date de naissance',
          border: const OutlineInputBorder(),
          suffixIcon: value == null
              ? const Icon(Icons.calendar_today_outlined)
              : IconButton(
                  icon: const Icon(Icons.clear),
                  onPressed: onClear,
                ),
        ),
        child: Text(
          value == null
              ? 'Non renseignée'
              : DateFormatters.numericDate(value!),
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

String? _emailValidator(String? value) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) return null;
  if (!text.contains('@') || !text.contains('.')) {
    return 'E-mail invalide';
  }
  return null;
}

String _errorText(Object error) {
  return error.toString().replaceFirst('Exception: ', '');
}
