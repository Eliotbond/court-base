import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Identité du joueur soumise via l'app register (`/registrations.player`).
class RegistrationPlayerIdentity {
  const RegistrationPlayerIdentity({
    required this.firstName,
    required this.lastName,
    required this.birthDate,
    required this.gender,
    required this.avs,
    required this.avsUnavailable,
    required this.phone,
  });

  final String firstName;
  final String lastName;
  final DateTime? birthDate;

  /// "M" | "F" | "other" | null — gardé en string brut (peu d'usage mobile).
  final String? gender;
  final String? avs;
  final bool avsUnavailable;
  final String? phone;

  String get fullName => '$firstName $lastName'.trim();

  factory RegistrationPlayerIdentity.fromMap(Map<String, dynamic> map) =>
      RegistrationPlayerIdentity(
        firstName: FsConvert.str(map['firstName']),
        lastName: FsConvert.str(map['lastName']),
        birthDate: FsConvert.toDateTime(map['birthDate']),
        gender: FsConvert.strOrNull(map['gender']),
        avs: FsConvert.strOrNull(map['avs']),
        avsUnavailable: FsConvert.boolean(map['avsUnavailable']),
        phone: FsConvert.strOrNull(map['phone']),
      );
}

/// Document `/registrations/{registrationId}` — demande d'inscription
/// self-service. L'app mobile coach lit les inscriptions de ses équipes.
class Registration {
  const Registration({
    required this.id,
    required this.submittedByUid,
    required this.registrationFor,
    required this.player,
    required this.matchedMemberId,
    required this.teamId,
    required this.previouslyLicensed,
    required this.foreignTransfer,
    required this.status,
    required this.statusUpdatedAt,
    required this.trialStartedAt,
    required this.refusalReason,
    required this.refusedByUid,
    required this.createdAt,
  });

  final String id;

  /// uid de l'auteur de l'inscription.
  final String submittedByUid;
  final RegistrationFor registrationFor;
  final RegistrationPlayerIdentity player;

  /// Lien à un `/members/{id}` existant ; `null` = nouveau dossier.
  final String? matchedMemberId;
  final String teamId;
  final bool previouslyLicensed;
  final bool foreignTransfer;
  final RegistrationStatus status;
  final DateTime? statusUpdatedAt;
  final DateTime? trialStartedAt;
  final String? refusalReason;
  final String? refusedByUid;
  final DateTime createdAt;

  factory Registration.fromMap(String id, Map<String, dynamic> map) =>
      Registration(
        id: id,
        submittedByUid: FsConvert.str(map['submittedByUid']),
        registrationFor: RegistrationFor.fromWire(map['registrationFor']),
        player: RegistrationPlayerIdentity.fromMap(
          FsConvert.mapOrNull(map['player']) ?? const {},
        ),
        matchedMemberId: FsConvert.strOrNull(map['matchedMemberId']),
        teamId: FsConvert.str(map['teamId']),
        previouslyLicensed: FsConvert.boolean(map['previouslyLicensed']),
        foreignTransfer: FsConvert.boolean(map['foreignTransfer']),
        status: RegistrationStatus.fromWire(map['status']),
        statusUpdatedAt: FsConvert.toDateTime(map['statusUpdatedAt']),
        trialStartedAt: FsConvert.toDateTime(map['trialStartedAt']),
        refusalReason: FsConvert.strOrNull(map['refusalReason']),
        refusedByUid: FsConvert.strOrNull(map['refusedByUid']),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
      );

  factory Registration.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      Registration.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  Registration copyWith({
    String? submittedByUid,
    RegistrationFor? registrationFor,
    RegistrationPlayerIdentity? player,
    String? matchedMemberId,
    String? teamId,
    bool? previouslyLicensed,
    bool? foreignTransfer,
    RegistrationStatus? status,
    DateTime? statusUpdatedAt,
    DateTime? trialStartedAt,
    String? refusalReason,
    String? refusedByUid,
    DateTime? createdAt,
  }) =>
      Registration(
        id: id,
        submittedByUid: submittedByUid ?? this.submittedByUid,
        registrationFor: registrationFor ?? this.registrationFor,
        player: player ?? this.player,
        matchedMemberId: matchedMemberId ?? this.matchedMemberId,
        teamId: teamId ?? this.teamId,
        previouslyLicensed: previouslyLicensed ?? this.previouslyLicensed,
        foreignTransfer: foreignTransfer ?? this.foreignTransfer,
        status: status ?? this.status,
        statusUpdatedAt: statusUpdatedAt ?? this.statusUpdatedAt,
        trialStartedAt: trialStartedAt ?? this.trialStartedAt,
        refusalReason: refusalReason ?? this.refusalReason,
        refusedByUid: refusedByUid ?? this.refusedByUid,
        createdAt: createdAt ?? this.createdAt,
      );
}
