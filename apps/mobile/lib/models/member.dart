import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Référence dénormalisée vers la licence ACTIVE (confirmée) d'un membre pour
/// un rôle donné (`official` / `coach`). Posée par la callable `confirmLicense`.
///
/// Sert à dériver « officiel/coach actif » sans requête `/licenses`. À
/// distinguer de `officialLevel`/`coachLevel` qui sont des QUALIFICATIONS.
class ActiveLicenseRef {
  const ActiveLicenseRef({
    required this.licenseId,
    required this.seasonId,
    required this.level,
  });

  /// id du doc `/licenses/{id}`.
  final String licenseId;

  /// Saison de la licence (`/seasons/{id}`).
  final String seasonId;

  /// Niveau snapshot de la licence (numérique official/coach).
  final int? level;

  /// Parse une map Firestore ; `null` si la valeur n'est pas un objet exploitable.
  static ActiveLicenseRef? fromMapOrNull(Object? raw) {
    if (raw is! Map) return null;
    final map = raw.map((k, v) => MapEntry(k.toString(), v));
    final licenseId = FsConvert.strOrNull(map['licenseId']);
    final seasonId = FsConvert.strOrNull(map['seasonId']);
    if (licenseId == null || seasonId == null) return null;
    return ActiveLicenseRef(
      licenseId: licenseId,
      seasonId: seasonId,
      level: FsConvert.intOrNull(map['level']),
    );
  }
}

/// Document `/members/{memberId}` — fiche membre côté club.
///
/// **Pas de `email`/`phone`** ici : ces champs vivent dans la sous-collection
/// `/members/{id}/private/contact` ([MemberContact]).
class Member {
  const Member({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.status,
    required this.archivedAt,
    required this.archivedReason,
    required this.archivedByUid,
    required this.roles,
    required this.linkedUserId,
    required this.licenseNumber,
    required this.officialLevel,
    required this.coachLevel,
    required this.officialLicense,
    required this.coachLicense,
    required this.licensed,
    required this.duesStatus,
    required this.duesStatusUpdatedAt,
    required this.active,
    required this.birthDate,
    required this.guardianUserIds,
    required this.avs,
    required this.transferState,
  });

  final String id;
  final String firstName;
  final String lastName;
  final MemberStatus status;
  final DateTime? archivedAt;
  final String? archivedReason;
  final String? archivedByUid;

  /// Refs vers `/roles`.
  final List<String> roles;

  /// uid Auth si le membre a un compte lié.
  final String? linkedUserId;
  final String licenseNumber;

  /// Niveau de QUALIFICATION officiel (1, 2…). `null` si non qualifié officiel.
  /// Indépendant du fait d'être officiel ACTIF (cf. [officialLicense]).
  final int? officialLevel;

  /// Niveau de QUALIFICATION coach. `null` si non qualifié coach.
  final int? coachLevel;

  /// Réf vers la licence d'officiel ACTIVE (confirmée). `null` = pas de licence
  /// officiel active. Le membre peut s'auto-inscrire aux matchs si non-`null`
  /// (gaté `firestore.rules` → `callerHasOfficialLicense()`).
  final ActiveLicenseRef? officialLicense;

  /// Réf vers la licence de coach ACTIVE. Cf. [officialLicense].
  final ActiveLicenseRef? coachLicense;
  final bool licensed;
  final DuesStatus duesStatus;
  final DateTime? duesStatusUpdatedAt;
  final bool active;

  /// Date de naissance. `null` = inconnue (traité adulte côté defaults).
  final DateTime? birthDate;

  /// UIDs des tuteurs rattachés.
  final List<String> guardianUserIds;
  final String? avs;
  final MemberTransferState transferState;

  /// Nom complet « Prénom Nom ».
  String get fullName => '$firstName $lastName'.trim();

  /// `true` si le membre est QUALIFIÉ comme officiel (formé pour — `officialLevel`).
  bool get isQualifiedOfficial => officialLevel != null;

  /// `true` si le membre est officiel ACTIF — licence officiel confirmée.
  /// C'est cette propriété qui conditionne l'auto-inscription aux matchs.
  bool get isActiveOfficial => officialLicense != null;

  /// `true` si le membre est QUALIFIÉ comme coach (`coachLevel`).
  bool get isQualifiedCoach => coachLevel != null;

  /// `true` si le membre est coach ACTIF — licence coach confirmée.
  bool get isActiveCoach => coachLicense != null;

  /// `true` si le membre est archivé.
  bool get isArchived => status == MemberStatus.archived;

  factory Member.fromMap(String id, Map<String, dynamic> map) => Member(
        id: id,
        firstName: FsConvert.str(map['firstName']),
        lastName: FsConvert.str(map['lastName']),
        status: MemberStatus.fromWire(map['status']),
        archivedAt: FsConvert.toDateTime(map['archivedAt']),
        archivedReason: FsConvert.strOrNull(map['archivedReason']),
        archivedByUid: FsConvert.strOrNull(map['archivedByUid']),
        roles: FsConvert.stringList(map['roles']),
        linkedUserId: FsConvert.strOrNull(map['linkedUserId']),
        licenseNumber: FsConvert.str(map['licenseNumber']),
        officialLevel: FsConvert.intOrNull(map['officialLevel']),
        coachLevel: FsConvert.intOrNull(map['coachLevel']),
        officialLicense: ActiveLicenseRef.fromMapOrNull(map['officialLicense']),
        coachLicense: ActiveLicenseRef.fromMapOrNull(map['coachLicense']),
        licensed: FsConvert.boolean(map['licensed']),
        duesStatus: DuesStatus.fromWire(map['duesStatus']),
        duesStatusUpdatedAt: FsConvert.toDateTime(map['duesStatusUpdatedAt']),
        // Un doc sans `active` est traité comme actif (cf. docs/mobile-app.md).
        active: FsConvert.boolean(map['active'], true),
        birthDate: FsConvert.toDateTime(map['birthDate']),
        guardianUserIds: FsConvert.stringList(map['guardianUserIds']),
        avs: FsConvert.strOrNull(map['avs']),
        transferState: MemberTransferState.fromWire(map['transferState']),
      );

  factory Member.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      Member.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  Member copyWith({
    String? firstName,
    String? lastName,
    MemberStatus? status,
    DateTime? archivedAt,
    String? archivedReason,
    String? archivedByUid,
    List<String>? roles,
    String? linkedUserId,
    String? licenseNumber,
    int? officialLevel,
    int? coachLevel,
    ActiveLicenseRef? officialLicense,
    ActiveLicenseRef? coachLicense,
    bool? licensed,
    DuesStatus? duesStatus,
    DateTime? duesStatusUpdatedAt,
    bool? active,
    DateTime? birthDate,
    List<String>? guardianUserIds,
    String? avs,
    MemberTransferState? transferState,
  }) =>
      Member(
        id: id,
        firstName: firstName ?? this.firstName,
        lastName: lastName ?? this.lastName,
        status: status ?? this.status,
        archivedAt: archivedAt ?? this.archivedAt,
        archivedReason: archivedReason ?? this.archivedReason,
        archivedByUid: archivedByUid ?? this.archivedByUid,
        roles: roles ?? this.roles,
        linkedUserId: linkedUserId ?? this.linkedUserId,
        licenseNumber: licenseNumber ?? this.licenseNumber,
        officialLevel: officialLevel ?? this.officialLevel,
        coachLevel: coachLevel ?? this.coachLevel,
        officialLicense: officialLicense ?? this.officialLicense,
        coachLicense: coachLicense ?? this.coachLicense,
        licensed: licensed ?? this.licensed,
        duesStatus: duesStatus ?? this.duesStatus,
        duesStatusUpdatedAt: duesStatusUpdatedAt ?? this.duesStatusUpdatedAt,
        active: active ?? this.active,
        birthDate: birthDate ?? this.birthDate,
        guardianUserIds: guardianUserIds ?? this.guardianUserIds,
        avs: avs ?? this.avs,
        transferState: transferState ?? this.transferState,
      );
}

/// Document `/members/{memberId}/private/contact` (ID fixe `contact`).
///
/// Lecture restreinte (admin/coach/membre/tuteur) — les `official`-only ne
/// voient pas ce doc.
class MemberContact {
  const MemberContact({
    required this.id,
    required this.email,
    required this.phone,
  });

  final String id;
  final String email;
  final String phone;

  factory MemberContact.fromMap(String id, Map<String, dynamic> map) =>
      MemberContact(
        id: id,
        email: FsConvert.str(map['email']),
        phone: FsConvert.str(map['phone']),
      );

  factory MemberContact.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      MemberContact.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  MemberContact copyWith({String? email, String? phone}) => MemberContact(
        id: id,
        email: email ?? this.email,
        phone: phone ?? this.phone,
      );
}
