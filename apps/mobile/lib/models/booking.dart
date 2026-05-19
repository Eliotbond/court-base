import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Entrée du journal d'actions d'un booking (`/bookings.actionLog[]`).
class BookingActionLogEntry {
  const BookingActionLogEntry({
    required this.at,
    required this.by,
    required this.action,
    required this.note,
  });

  final DateTime at;

  /// uid de l'auteur.
  final String by;
  final String action;
  final String? note;

  factory BookingActionLogEntry.fromMap(Map<String, dynamic> map) =>
      BookingActionLogEntry(
        at: FsConvert.toDateTimeOr(map['at']),
        by: FsConvert.str(map['by']),
        action: FsConvert.str(map['action']),
        note: FsConvert.strOrNull(map['note']),
      );
}

/// Document `/bookings/{bookingId}` — instance concrète d'un slot à une date.
class Booking {
  const Booking({
    required this.id,
    required this.seasonId,
    required this.venueId,
    required this.courtId,
    required this.timeSlotId,
    required this.teamId,
    required this.slotType,
    required this.matchTypeId,
    required this.opponentName,
    required this.matchId,
    required this.awayAddress,
    required this.date,
    required this.startTime,
    required this.endTime,
    required this.status,
    required this.linkedBookingIds,
    required this.isCombinedCourtEvent,
    required this.seriesId,
    required this.isManual,
    required this.actionLog,
  });

  final String id;
  final String seasonId;
  final String venueId;
  final String courtId;
  final String timeSlotId;
  final String? teamId;
  final SlotType slotType;
  final String? matchTypeId;
  final String? opponentName;

  /// Ref vers `/matches/{matchId}` pour un match home rattaché.
  final String? matchId;
  final String? awayAddress;
  final DateTime date;

  /// "HH:MM".
  final String startTime;
  final String endTime;
  final BookingStatus status;
  final List<String> linkedBookingIds;
  final bool isCombinedCourtEvent;
  final String? seriesId;
  final bool isManual;
  final List<BookingActionLogEntry> actionLog;

  factory Booking.fromMap(String id, Map<String, dynamic> map) => Booking(
        id: id,
        seasonId: FsConvert.str(map['seasonId']),
        venueId: FsConvert.str(map['venueId']),
        courtId: FsConvert.str(map['courtId']),
        timeSlotId: FsConvert.str(map['timeSlotId']),
        teamId: FsConvert.strOrNull(map['teamId']),
        slotType: SlotType.fromWire(map['slotType']),
        matchTypeId: FsConvert.strOrNull(map['matchTypeId']),
        opponentName: FsConvert.strOrNull(map['opponentName']),
        matchId: FsConvert.strOrNull(map['matchId']),
        awayAddress: FsConvert.strOrNull(map['awayAddress']),
        date: FsConvert.toDateTimeOr(map['date']),
        startTime: FsConvert.str(map['startTime']),
        endTime: FsConvert.str(map['endTime']),
        status: BookingStatus.fromWire(map['status']),
        linkedBookingIds: FsConvert.stringList(map['linkedBookingIds']),
        isCombinedCourtEvent:
            FsConvert.boolean(map['isCombinedCourtEvent']),
        seriesId: FsConvert.strOrNull(map['seriesId']),
        isManual: FsConvert.boolean(map['isManual']),
        actionLog: FsConvert.mapList(map['actionLog'])
            .map(BookingActionLogEntry.fromMap)
            .toList(growable: false),
      );

  factory Booking.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      Booking.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  Booking copyWith({
    String? seasonId,
    String? venueId,
    String? courtId,
    String? timeSlotId,
    String? teamId,
    SlotType? slotType,
    String? matchTypeId,
    String? opponentName,
    String? matchId,
    String? awayAddress,
    DateTime? date,
    String? startTime,
    String? endTime,
    BookingStatus? status,
    List<String>? linkedBookingIds,
    bool? isCombinedCourtEvent,
    String? seriesId,
    bool? isManual,
    List<BookingActionLogEntry>? actionLog,
  }) =>
      Booking(
        id: id,
        seasonId: seasonId ?? this.seasonId,
        venueId: venueId ?? this.venueId,
        courtId: courtId ?? this.courtId,
        timeSlotId: timeSlotId ?? this.timeSlotId,
        teamId: teamId ?? this.teamId,
        slotType: slotType ?? this.slotType,
        matchTypeId: matchTypeId ?? this.matchTypeId,
        opponentName: opponentName ?? this.opponentName,
        matchId: matchId ?? this.matchId,
        awayAddress: awayAddress ?? this.awayAddress,
        date: date ?? this.date,
        startTime: startTime ?? this.startTime,
        endTime: endTime ?? this.endTime,
        status: status ?? this.status,
        linkedBookingIds: linkedBookingIds ?? this.linkedBookingIds,
        isCombinedCourtEvent:
            isCombinedCourtEvent ?? this.isCombinedCourtEvent,
        seriesId: seriesId ?? this.seriesId,
        isManual: isManual ?? this.isManual,
        actionLog: actionLog ?? this.actionLog,
      );
}
