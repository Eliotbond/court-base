import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Document `/matches/{matchId}` — entité "match" (équipe locale, type,
/// adversaire, date, statut).
class Match {
  const Match({
    required this.id,
    required this.bookingId,
    required this.kind,
    required this.teamId,
    required this.matchTypeId,
    required this.opponentName,
    required this.awayAddress,
    required this.date,
    required this.startTime,
    required this.endTime,
    required this.status,
    required this.notes,
    required this.createdAt,
    required this.createdBy,
  });

  final String id;

  /// Ref vers `/bookings/{bookingId}` pour `kind == home` ; `null` pour away.
  final String? bookingId;
  final MatchKind kind;

  /// Notre équipe locale.
  final String teamId;
  final String matchTypeId;

  /// Optionnel pour home, obligatoire pour away.
  final String? opponentName;

  /// Adresse extérieure — uniquement pour `kind == away`.
  final String? awayAddress;

  /// Date du match (00:00 local).
  final DateTime date;

  /// "HH:MM".
  final String startTime;
  final String endTime;
  final MatchStatus status;
  final String? notes;
  final DateTime createdAt;
  final String createdBy;

  /// `true` si le match est à domicile.
  bool get isHome => kind == MatchKind.home;

  factory Match.fromMap(String id, Map<String, dynamic> map) => Match(
        id: id,
        bookingId: FsConvert.strOrNull(map['bookingId']),
        kind: MatchKind.fromWire(map['kind']),
        teamId: FsConvert.str(map['teamId']),
        matchTypeId: FsConvert.str(map['matchTypeId']),
        opponentName: FsConvert.strOrNull(map['opponentName']),
        awayAddress: FsConvert.strOrNull(map['awayAddress']),
        date: FsConvert.toDateTimeOr(map['date']),
        startTime: FsConvert.str(map['startTime']),
        endTime: FsConvert.str(map['endTime']),
        status: MatchStatus.fromWire(map['status']),
        notes: FsConvert.strOrNull(map['notes']),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
        createdBy: FsConvert.str(map['createdBy']),
      );

  factory Match.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      Match.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  Match copyWith({
    String? bookingId,
    MatchKind? kind,
    String? teamId,
    String? matchTypeId,
    String? opponentName,
    String? awayAddress,
    DateTime? date,
    String? startTime,
    String? endTime,
    MatchStatus? status,
    String? notes,
    DateTime? createdAt,
    String? createdBy,
  }) =>
      Match(
        id: id,
        bookingId: bookingId ?? this.bookingId,
        kind: kind ?? this.kind,
        teamId: teamId ?? this.teamId,
        matchTypeId: matchTypeId ?? this.matchTypeId,
        opponentName: opponentName ?? this.opponentName,
        awayAddress: awayAddress ?? this.awayAddress,
        date: date ?? this.date,
        startTime: startTime ?? this.startTime,
        endTime: endTime ?? this.endTime,
        status: status ?? this.status,
        notes: notes ?? this.notes,
        createdAt: createdAt ?? this.createdAt,
        createdBy: createdBy ?? this.createdBy,
      );
}
