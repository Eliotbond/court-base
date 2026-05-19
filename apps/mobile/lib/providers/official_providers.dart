import 'package:collection/collection.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../main.dart' show localNotificationsPlugin;
import '../models/booking.dart';
import '../models/enums.dart';
import '../models/match.dart';
import '../models/match_type.dart';
import '../models/member.dart';
import '../models/official_assignment.dart';
import '../repositories/booking_repository.dart';
import '../repositories/calendar_service.dart';
import '../repositories/local_notification_repository.dart';
import '../repositories/match_repository.dart';
import '../repositories/match_type_repository.dart';
import '../repositories/official_assignment_repository.dart';
import 'auth_providers.dart';
import 'firebase_providers.dart';

// =============================================================================
// Repositories
// =============================================================================

/// Repository des types de match (`/matchTypes`).
final matchTypeRepositoryProvider = Provider<MatchTypeRepository>((ref) {
  return MatchTypeRepository();
});

/// Repository des bookings (`/bookings`).
final bookingRepositoryProvider = Provider<BookingRepository>((ref) {
  return BookingRepository();
});

/// Repository des matchs (`/matches`).
final matchRepositoryProvider = Provider<MatchRepository>((ref) {
  return MatchRepository();
});

/// Repository des assignations d'officiels.
///
/// Dépend de l'uid courant (porté dans `assignedBy`). `null` si déconnecté —
/// l'écran officiel n'est de toute façon atteignable qu'authentifié.
final officialAssignmentRepositoryProvider =
    Provider<OfficialAssignmentRepository?>((ref) {
  final uid = ref.watch(appUserProvider)?.id;
  if (uid == null) return null;
  return OfficialAssignmentRepository(currentUid: uid);
});

/// Repository des notifications locales (rappels de match).
final localNotificationRepositoryProvider =
    Provider<LocalNotificationRepository>((ref) {
  return LocalNotificationRepository(localNotificationsPlugin);
});

/// Service d'ajout au calendrier de l'appareil.
final calendarServiceProvider = Provider<CalendarService>((ref) {
  return CalendarService();
});

// =============================================================================
// Données brutes
// =============================================================================

/// Tous les types de match (caché côté repo).
final matchTypesProvider = StreamProvider<List<MatchType>>((ref) {
  return ref.watch(matchTypeRepositoryProvider).watchMatchTypes();
});

/// Index `matchTypeId -> MatchType` dérivé de [matchTypesProvider].
final matchTypesByIdProvider = Provider<Map<String, MatchType>>((ref) {
  final types = ref.watch(matchTypesProvider).value ?? const [];
  return {for (final type in types) type.id: type};
});

/// Bookings de match à domicile à venir.
final homeMatchBookingsProvider = StreamProvider<List<Booking>>((ref) {
  return ref.watch(bookingRepositoryProvider).watchMatchHomeBookingsUpcoming();
});

/// Matchs à l'extérieur à venir.
final awayMatchesProvider = StreamProvider<List<Match>>((ref) {
  return ref.watch(matchRepositoryProvider).watchAwayMatchesUpcoming();
});

/// Membre `/members/{memberId}` lié au user courant.
///
/// Porte `officialLevel` (qualification) et `officialLicense` (officiel actif)
/// — indispensables pour filtrer les matchs au niveau de l'officiel et pour
/// la garde d'auto-inscription. Émet `null` si le user n'a pas de `memberId`.
final currentMemberProvider = StreamProvider<Member?>((ref) {
  final memberId = ref.watch(appUserProvider)?.memberId;
  if (memberId == null) {
    return Stream<Member?>.value(null);
  }
  return ref.watch(memberRepositoryProvider).watchMember(memberId);
});

/// Assignations d'un booking donné (`provider.family`).
final assignmentsForBookingProvider =
    StreamProvider.family<List<OfficialAssignment>, String>((ref, bookingId) {
  final repo = ref.watch(officialAssignmentRepositoryProvider);
  if (repo == null) return Stream.value(const []);
  return repo.watchAssignmentsForBooking(bookingId);
});

/// Assignations d'un match donné (`provider.family`).
final assignmentsForMatchProvider =
    StreamProvider.family<List<OfficialAssignment>, String>((ref, matchId) {
  final repo = ref.watch(officialAssignmentRepositoryProvider);
  if (repo == null) return Stream.value(const []);
  return repo.watchAssignmentsForMatch(matchId);
});

/// Match donné (`provider.family`) — utilisé par l'écran de détail away.
final matchByIdProvider =
    StreamProvider.family<Match?, String>((ref, matchId) {
  return ref.watch(matchRepositoryProvider).watchMatch(matchId);
});

/// Booking donné (`provider.family`) — utilisé par l'écran de détail d'un
/// match à domicile. Dérivé de la liste des bookings home à venir : l'écran
/// de détail n'est atteignable que pour un booking présent dans cette liste.
final bookingByIdProvider =
    Provider.family<AsyncValue<Booking?>, String>((ref, bookingId) {
  return ref.watch(homeMatchBookingsProvider).whenData(
        (bookings) =>
            bookings.firstWhereOrNull((b) => b.id == bookingId),
      );
});

/// Assignations de l'officiel courant, tri `assignedAt` décroissant.
final myAssignmentsProvider =
    StreamProvider<List<OfficialAssignment>>((ref) {
  final repo = ref.watch(officialAssignmentRepositoryProvider);
  final memberId = ref.watch(appUserProvider)?.memberId;
  if (repo == null || memberId == null) return Stream.value(const []);
  return repo.watchMyAssignments(memberId);
});

// =============================================================================
// Vues dérivées — matchs à pourvoir
// =============================================================================

/// Un match à domicile à pourvoir : le booking + son type + ses besoins
/// d'officiels encore ouverts au niveau de l'officiel courant.
class HomeMatchNeed {
  const HomeMatchNeed({
    required this.booking,
    required this.matchType,
    required this.openSlotsAtMyLevel,
  });

  final Booking booking;
  final MatchType? matchType;

  /// Nombre de places encore ouvertes, niveaux confondus, que l'officiel
  /// courant est habilité à occuper (slots de niveau <= son `officialLevel`).
  final int openSlotsAtMyLevel;
}

/// Un match à l'extérieur à pourvoir : le match + son type + le compte de
/// places encore ouvertes.
class AwayMatchNeed {
  const AwayMatchNeed({
    required this.match,
    required this.matchType,
    required this.openSlots,
  });

  final Match match;
  final MatchType? matchType;
  final int openSlots;
}

/// Compte les assignations « actives » (pending + confirmed) par niveau.
///
/// Les `declined` ne consomment pas de place. Renvoie une map `level -> count`.
Map<int, int> _activeCountByLevel(List<OfficialAssignment> assignments) {
  final result = <int, int>{};
  for (final a in assignments) {
    if (a.status == OfficialAssignmentStatus.declined) continue;
    result.update(a.officialLevel, (n) => n + 1, ifAbsent: () => 1);
  }
  return result;
}

/// Total des assignations actives (pending + confirmed), niveaux confondus.
int _activeCount(List<OfficialAssignment> assignments) => assignments
    .where((a) => a.status != OfficialAssignmentStatus.declined)
    .length;

/// Places encore ouvertes sur un match à domicile, restreintes au niveau de
/// l'officiel courant.
///
/// Règle métier : un officiel de niveau N peut occuper les créneaux de niveau
/// <= N (pas l'inverse). Pour chaque exigence `{level, count}` dont
/// `level <= myLevel`, on compte les places libres `count - actives à ce
/// niveau` et on additionne.
int openHomeSlotsAtLevel({
  required MatchType matchType,
  required List<OfficialAssignment> assignments,
  required int myLevel,
}) {
  final activeByLevel = _activeCountByLevel(assignments);
  var open = 0;
  for (final req in matchType.homeOfficialRequirements) {
    if (req.level > myLevel) continue;
    final active = activeByLevel[req.level] ?? 0;
    final free = req.count - active;
    if (free > 0) open += free;
  }
  return open;
}

/// Liste des matchs à domicile encore à pourvoir pour l'officiel courant.
///
/// Joint : bookings home à venir + leurs assignations + le `MatchType`.
/// Ne garde que les bookings où il reste au moins une place à un niveau
/// <= `member.officialLevel`. Un officiel sans `officialLevel` ne voit rien.
final matchesNeedingOfficialsProvider =
    Provider<AsyncValue<List<HomeMatchNeed>>>((ref) {
  final bookingsAsync = ref.watch(homeMatchBookingsProvider);
  final typesById = ref.watch(matchTypesByIdProvider);
  final memberAsync = ref.watch(currentMemberProvider);

  return bookingsAsync.when(
    loading: () => const AsyncValue.loading(),
    error: (e, s) => AsyncValue.error(e, s),
    data: (bookings) {
      final myLevel = memberAsync.value?.officialLevel;
      if (myLevel == null) {
        return const AsyncValue.data(<HomeMatchNeed>[]);
      }
      final needs = <HomeMatchNeed>[];
      for (final booking in bookings) {
        final matchType = booking.matchTypeId == null
            ? null
            : typesById[booking.matchTypeId];
        if (matchType == null) continue;
        final assignments =
            ref.watch(assignmentsForBookingProvider(booking.id)).value;
        if (assignments == null) continue;
        final open = openHomeSlotsAtLevel(
          matchType: matchType,
          assignments: assignments,
          myLevel: myLevel,
        );
        if (open > 0) {
          needs.add(HomeMatchNeed(
            booking: booking,
            matchType: matchType,
            openSlotsAtMyLevel: open,
          ));
        }
      }
      needs.sortBy<DateTime>((n) => n.booking.date);
      return AsyncValue.data(needs);
    },
  );
});

/// Liste des matchs à l'extérieur encore à pourvoir.
///
/// Joint : matchs away à venir + leurs assignations + le `MatchType`.
/// Pour les matchs away, l'exigence est un simple total `awayOfficialCount`
/// (pas de découpage par niveau) — un officiel actif peut occuper n'importe
/// quelle place.
final awayMatchesNeedingOfficialsProvider =
    Provider<AsyncValue<List<AwayMatchNeed>>>((ref) {
  final matchesAsync = ref.watch(awayMatchesProvider);
  final typesById = ref.watch(matchTypesByIdProvider);

  return matchesAsync.when(
    loading: () => const AsyncValue.loading(),
    error: (e, s) => AsyncValue.error(e, s),
    data: (matches) {
      final needs = <AwayMatchNeed>[];
      for (final match in matches) {
        if (match.status == MatchStatus.cancelled) continue;
        final matchType = typesById[match.matchTypeId];
        if (matchType == null) continue;
        final assignments =
            ref.watch(assignmentsForMatchProvider(match.id)).value;
        if (assignments == null) continue;
        final open = matchType.awayOfficialCount - _activeCount(assignments);
        if (open > 0) {
          needs.add(AwayMatchNeed(
            match: match,
            matchType: matchType,
            openSlots: open,
          ));
        }
      }
      needs.sortBy<DateTime>((n) => n.match.date);
      return AsyncValue.data(needs);
    },
  );
});
