import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/booking.dart';
import '../models/enums.dart';

/// Repository d'accès aux bookings (`/bookings`).
///
/// Périmètre officiel : les bookings de type `match_home` à venir — ce sont
/// les matchs à domicile susceptibles d'avoir besoin d'officiels.
class BookingRepository {
  BookingRepository();

  // ignore: unused_field
  final AppLogger _log = const AppLogger('BookingRepository');

  /// Observe les bookings de match à domicile à partir d'aujourd'hui.
  ///
  /// Requête `where`-only (`slotType` + `date >=`) + `orderBy date`. Le couple
  /// `(slotType ==, date >=, orderBy date)` tient sur un index simple
  /// auto-créé par Firestore (égalité + inégalité sur deux champs distincts,
  /// tri sur le champ d'inégalité) — pas d'index composite à déployer.
  Stream<List<Booking>> watchMatchHomeBookingsUpcoming() {
    final todayUtc = _todayMidnightUtc();
    final query = FirebaseRefs.bookings
        .where('slotType', isEqualTo: SlotType.matchHome.wire)
        .where('date', isGreaterThanOrEqualTo: Timestamp.fromDate(todayUtc))
        .orderBy('date');
    return query.snapshots().map(
          (snapshot) => snapshot.docs
              .map(Booking.fromFirestore)
              .toList(growable: false),
        );
  }

  /// Minuit UTC du jour — borne basse des requêtes "à venir".
  static DateTime _todayMidnightUtc() {
    final now = DateTime.now().toUtc();
    return DateTime.utc(now.year, now.month, now.day);
  }
}
