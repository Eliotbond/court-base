import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/enums.dart';
import '../models/match.dart';

/// Repository d'accès aux matchs (`/matches`).
///
/// Périmètre officiel : les matchs à l'extérieur (`kind == away`) à venir, qui
/// requièrent `matchType.awayOfficialCount` officiels.
class MatchRepository {
  MatchRepository();

  final AppLogger _log = const AppLogger('MatchRepository');

  /// Observe les matchs à l'extérieur à partir d'aujourd'hui.
  ///
  /// Requête `where`-only (`kind ==`, `date >=`) + `orderBy date` — index
  /// simple auto-créé par Firestore (cf. [BookingRepository]).
  Stream<List<Match>> watchAwayMatchesUpcoming() {
    final todayUtc = _todayMidnightUtc();
    final query = FirebaseRefs.matches
        .where('kind', isEqualTo: MatchKind.away.wire)
        .where('date', isGreaterThanOrEqualTo: Timestamp.fromDate(todayUtc))
        .orderBy('date');
    return query.snapshots().map(
          (snapshot) =>
              snapshot.docs.map(Match.fromFirestore).toList(growable: false),
        );
  }

  /// Observe un match donné. Émet `null` si le doc n'existe pas / disparaît.
  ///
  /// Les erreurs de stream sont mappées puis ré-émises pour que le
  /// `StreamProvider` les expose en `AsyncError`.
  Stream<Match?> watchMatch(String matchId) {
    return FirebaseRefs.matches
        .doc(matchId)
        .snapshots()
        .map<Match?>((snapshot) {
      if (!snapshot.exists || snapshot.data() == null) return null;
      return Match.fromFirestore(snapshot);
    }).transform(
      StreamTransformer<Match?, Match?>.fromHandlers(
        handleError: (error, stack, sink) {
          _log.error('watchMatch failed for /matches/$matchId', error, stack);
          sink.addError(AppException.fromFirebase(error, stack), stack);
        },
      ),
    );
  }

  /// Minuit UTC du jour — borne basse des requêtes "à venir".
  static DateTime _todayMidnightUtc() {
    final now = DateTime.now().toUtc();
    return DateTime.utc(now.year, now.month, now.day);
  }
}
