/// Énumérations partagées par les modèles, alignées sur `packages/shared-types`
/// et `docs/firebase.md`.
///
/// Chaque enum expose `wire` (la clé exacte stockée en Firestore) et un parser
/// `fromWire` tolérant : une valeur inconnue retombe sur un repli + log (jamais
/// d'exception). Le parsing concret passe par `FsConvert.parseEnum`.
library;

import '../core/firestore_converters.dart';

/// Rôles applicatifs (`/users.roles`). Additifs / cumulables.
enum UserRole {
  admin('admin'),
  coach('coach'),
  official('official'),
  parent('parent'),
  treasurer('treasurer'),
  secretary('secretary');

  const UserRole(this.wire);

  final String wire;

  /// Parse une valeur wire. Retourne `null` pour les rôles custom inconnus
  /// (le champ `roles` reste extensible — on ne force pas de repli).
  static UserRole? fromWire(Object? raw) =>
      FsConvert.parseEnumOrNull(raw, values, (e) => e.wire, field: 'roles');
}

/// Statut cycle de vie d'un membre (`/members.status`).
enum MemberStatus {
  active('active'),
  archived('archived');

  const MemberStatus(this.wire);

  final String wire;

  static MemberStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        MemberStatus.active,
        field: 'status',
      );
}

/// Statut de cotisation d'un membre (`/members.duesStatus`).
enum DuesStatus {
  ok('ok'),
  pendingGrace('pending_grace'),
  due('due'),
  overdue('overdue'),
  excluded('excluded'),
  excepted('excepted'),
  na('n/a');

  const DuesStatus(this.wire);

  final String wire;

  static DuesStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        DuesStatus.na,
        field: 'duesStatus',
      );
}

/// État de transfert d'un joueur (`/members.transferState`).
enum MemberTransferState {
  none('none'),
  nationalPending('national_pending'),
  internationalPending('international_pending'),
  cleared('cleared');

  const MemberTransferState(this.wire);

  final String wire;

  static MemberTransferState fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        MemberTransferState.none,
        field: 'transferState',
      );
}

/// Genre d'une équipe (`/teams.gender`).
enum TeamGender {
  male('M'),
  female('F'),
  mixed('mixed');

  const TeamGender(this.wire);

  final String wire;

  static TeamGender fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        TeamGender.mixed,
        field: 'gender',
      );
}

/// Statut d'ouverture aux inscriptions d'une équipe (`/teams.registrationStatus`).
enum TeamRegistrationStatus {
  open('open'),
  conditional('conditional'),
  closed('closed');

  const TeamRegistrationStatus(this.wire);

  final String wire;

  static TeamRegistrationStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        TeamRegistrationStatus.closed,
        field: 'registrationStatus',
      );
}

/// Taille de court requise (`/matchTypes.requiredCourtSize`).
enum CourtSize {
  small('small'),
  normal('normal'),
  large('large');

  const CourtSize(this.wire);

  final String wire;

  static CourtSize fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        CourtSize.normal,
        field: 'requiredCourtSize',
      );
}

/// Nature d'un match (`/matches.kind`).
enum MatchKind {
  home('home'),
  away('away');

  const MatchKind(this.wire);

  final String wire;

  static MatchKind fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        MatchKind.home,
        field: 'kind',
      );
}

/// Statut d'un match (`/matches.status`).
enum MatchStatus {
  scheduled('scheduled'),
  cancelled('cancelled'),
  played('played');

  const MatchStatus(this.wire);

  final String wire;

  static MatchStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        MatchStatus.scheduled,
        field: 'status',
      );
}

/// Type de créneau (`/bookings.slotType`).
enum SlotType {
  training('training'),
  matchHome('match_home'),
  matchAway('match_away'),
  reserve('reserve'),
  custom('custom');

  const SlotType(this.wire);

  final String wire;

  static SlotType fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        SlotType.custom,
        field: 'slotType',
      );
}

/// Statut d'un booking (`/bookings.status`).
enum BookingStatus {
  scheduled('scheduled'),
  cancelled('cancelled'),
  freed('freed');

  const BookingStatus(this.wire);

  final String wire;

  static BookingStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        BookingStatus.scheduled,
        field: 'status',
      );
}

/// Statut d'une assignation d'officiel.
enum OfficialAssignmentStatus {
  pending('pending'),
  confirmed('confirmed'),
  declined('declined');

  const OfficialAssignmentStatus(this.wire);

  final String wire;

  static OfficialAssignmentStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        OfficialAssignmentStatus.pending,
        field: 'status',
      );
}

/// Type de notification (`/notifications.type`).
enum NotificationType {
  newMatch('new_match'),
  officialsNeeded('officials_needed'),
  urgent('urgent'),
  matchReminder('match_reminder');

  const NotificationType(this.wire);

  final String wire;

  static NotificationType fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        NotificationType.newMatch,
        field: 'type',
      );
}

/// Audience cible d'une notification (`/notifications.targetAudience`).
enum NotificationTargetAudience {
  allOfficials('all_officials'),
  unassignedOfficials('unassigned_officials'),
  assignedOfficials('assigned_officials');

  const NotificationTargetAudience(this.wire);

  final String wire;

  static NotificationTargetAudience fromWire(Object? raw) =>
      FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        NotificationTargetAudience.allOfficials,
        field: 'targetAudience',
      );
}

/// Type de demande de match (`/matchRequests.requestType`).
enum MatchRequestType {
  moveHome('move_home');

  const MatchRequestType(this.wire);

  final String wire;

  static MatchRequestType fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        MatchRequestType.moveHome,
        field: 'requestType',
      );
}

/// Statut d'une demande de match (`/matchRequests.status`).
enum MatchRequestStatus {
  pending('pending'),
  approved('approved'),
  rejected('rejected');

  const MatchRequestStatus(this.wire);

  final String wire;

  static MatchRequestStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        MatchRequestStatus.pending,
        field: 'status',
      );
}

/// Statut d'une demande de licence (`/licenseRequests.status`).
enum LicenseRequestStatus {
  pending('pending'),
  approved('approved'),
  rejected('rejected');

  const LicenseRequestStatus(this.wire);

  final String wire;

  static LicenseRequestStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        LicenseRequestStatus.pending,
        field: 'status',
      );
}

/// Statut d'une inscription (`/registrations.status`).
enum RegistrationStatus {
  draft('draft'),
  submitted('submitted'),
  openPendingTrial('open_pending_trial'),
  conditionalPendingReview('conditional_pending_review'),
  conditionalPendingTrial('conditional_pending_trial'),
  trialInProgress('trial_in_progress'),
  confirmedPendingDues('confirmed_pending_dues'),
  active('active'),
  refused('refused'),
  cancelled('cancelled');

  const RegistrationStatus(this.wire);

  final String wire;

  static RegistrationStatus fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        RegistrationStatus.submitted,
        field: 'status',
      );
}

/// Cible d'une inscription (`/registrations.registrationFor`).
enum RegistrationFor {
  self('self'),
  dependent('dependent');

  const RegistrationFor(this.wire);

  final String wire;

  static RegistrationFor fromWire(Object? raw) => FsConvert.parseEnum(
        raw,
        values,
        (e) => e.wire,
        RegistrationFor.self,
        field: 'registrationFor',
      );
}
