import 'package:cloud_functions/cloud_functions.dart';

import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';

/// Résultat de `coachCreateMember`.
class CoachCreateMemberResult {
  const CoachCreateMemberResult({
    required this.memberId,
    required this.memberCreated,
    required this.addedToTeam,
  });

  /// id du `/members/{id}` créé ou dédupliqué.
  final String memberId;

  /// `true` si un nouveau doc membre a été créé (sinon dédup sur un existant).
  final bool memberCreated;

  /// `true` si le membre a été ajouté à `team.playerIds`.
  final bool addedToTeam;
}

/// Résultat de `coachCreateAwayMatch`.
class CoachCreateAwayMatchResult {
  const CoachCreateAwayMatchResult({
    required this.matchId,
    required this.freedBookingIds,
  });

  /// id du `/matches/{id}` créé.
  final String matchId;

  /// ids des bookings d'entraînement libérés par conflit (best-effort serveur).
  final List<String> freedBookingIds;
}

/// Repository typé au-dessus des Cloud Functions callables (`europe-west6`).
///
/// `/members` et `/matches` sont write-admin-only dans les rules : les
/// mutations coach passent donc OBLIGATOIREMENT par ces callables, qui
/// re-vérifient le scope coach côté serveur. Toute `FirebaseFunctionsException`
/// est mappée en [AppException] (`kind: callable`).
class CallablesRepository {
  CallablesRepository();

  final AppLogger _log = const AppLogger('CallablesRepository');

  HttpsCallable _callable(String name) =>
      FirebaseRefs.functions.httpsCallable(name);

  Future<Map<String, dynamic>> _invoke(
    String name,
    Map<String, dynamic> payload,
  ) async {
    try {
      final result = await _callable(name).call<Object?>(payload);
      final data = result.data;
      if (data is Map) {
        return data.map((k, v) => MapEntry(k.toString(), v));
      }
      return const <String, dynamic>{};
    } on FirebaseFunctionsException catch (error, stack) {
      _log.error('callable "$name" failed [${error.code}]', error, stack);
      throw AppException.fromFirebase(error, stack);
    } catch (error, stack) {
      _log.error('callable "$name" failed', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
  }

  // --- Membres ------------------------------------------------------------

  /// `coachCreateMember` — crée (ou déduplique) un membre et l'ajoute à
  /// l'équipe. `birthDate` en epoch-millis ou `null`.
  Future<CoachCreateMemberResult> coachCreateMember({
    required String teamId,
    required String firstName,
    required String lastName,
    int? birthDate,
    String? avs,
    String? email,
    String? phone,
  }) async {
    final data = await _invoke('coachCreateMember', {
      'teamId': teamId,
      'firstName': firstName,
      'lastName': lastName,
      'birthDate': birthDate,
      'avs': avs,
      'email': email,
      'phone': phone,
    });
    return CoachCreateMemberResult(
      memberId: (data['memberId'] as String?) ?? '',
      memberCreated: (data['memberCreated'] as bool?) ?? false,
      addedToTeam: (data['addedToTeam'] as bool?) ?? false,
    );
  }

  /// `coachUpdateMember` — met à jour les champs éditables d'un membre par un
  /// coach (`firstName`, `lastName`, `birthDate`, contact `email`/`phone`,
  /// `comms.generalRecipients`). Les champs non fournis ne sont pas touchés.
  Future<String> coachUpdateMember({
    required String memberId,
    String? firstName,
    String? lastName,
    int? birthDate,
    bool clearBirthDate = false,
    String? email,
    String? phone,
    List<String>? generalRecipients,
  }) async {
    final payload = <String, dynamic>{'memberId': memberId};
    if (firstName != null) payload['firstName'] = firstName;
    if (lastName != null) payload['lastName'] = lastName;
    if (clearBirthDate) {
      payload['birthDate'] = null;
    } else if (birthDate != null) {
      payload['birthDate'] = birthDate;
    }
    if (email != null) payload['email'] = email;
    if (phone != null) payload['phone'] = phone;
    if (generalRecipients != null) {
      payload['comms'] = {'generalRecipients': generalRecipients};
    }
    final data = await _invoke('coachUpdateMember', payload);
    return (data['memberId'] as String?) ?? memberId;
  }

  /// `coachDeactivateMember` — désactive un membre.
  ///
  /// `mode: bench` → `active: false` seul ; `mode: archive` →
  /// `status: archived` + métadonnées d'archivage.
  Future<String> coachDeactivateMember({
    required String memberId,
    required String mode,
    String? reason,
  }) async {
    final data = await _invoke('coachDeactivateMember', {
      'memberId': memberId,
      'mode': mode,
      if (reason != null) 'reason': reason,
    });
    return (data['memberId'] as String?) ?? memberId;
  }

  // --- Matchs -------------------------------------------------------------

  /// `coachCreateAwayMatch` — crée un match à l'extérieur.
  /// `date` en epoch-millis ; `startTime`/`endTime` en `"HH:MM"`.
  Future<CoachCreateAwayMatchResult> coachCreateAwayMatch({
    required String teamId,
    required String matchTypeId,
    required String opponentName,
    required String awayAddress,
    required int date,
    required String startTime,
    required String endTime,
    String? notes,
  }) async {
    final data = await _invoke('coachCreateAwayMatch', {
      'teamId': teamId,
      'matchTypeId': matchTypeId,
      'opponentName': opponentName,
      'awayAddress': awayAddress,
      'date': date,
      'startTime': startTime,
      'endTime': endTime,
      'notes': notes ?? '',
    });
    final freed = data['freedBookingIds'];
    return CoachCreateAwayMatchResult(
      matchId: (data['matchId'] as String?) ?? '',
      freedBookingIds: freed is List
          ? freed.whereType<String>().toList(growable: false)
          : const <String>[],
    );
  }

  // --- Inscriptions -------------------------------------------------------

  /// `markTrialInProgress` — passe une inscription en essai.
  Future<void> markTrialInProgress(String registrationId) async {
    await _invoke('markTrialInProgress', {'registrationId': registrationId});
  }

  /// `confirmRegistration` — confirme une inscription.
  Future<void> confirmRegistration(String registrationId) async {
    await _invoke('confirmRegistration', {'registrationId': registrationId});
  }

  /// `refuseRegistration` — refuse une inscription avec un motif.
  Future<void> refuseRegistration(String registrationId, String reason) async {
    await _invoke('refuseRegistration', {
      'registrationId': registrationId,
      'reason': reason,
    });
  }
}
