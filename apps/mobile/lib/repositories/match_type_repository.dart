import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/match_type.dart';

/// Repository d'accès aux types de match (`/matchTypes`).
///
/// Les `MatchType` portent les besoins d'officiels — `homeOfficialRequirements`
/// (par niveau) pour les matchs à domicile et `awayOfficialCount` pour les
/// matchs à l'extérieur. Ils sont peu nombreux et quasi-statiques : on garde un
/// petit cache mémoire pour les lectures ponctuelles par id.
class MatchTypeRepository {
  MatchTypeRepository();

  final AppLogger _log = const AppLogger('MatchTypeRepository');

  /// Cache mémoire id -> MatchType, alimenté par [watchMatchTypes] et
  /// [getMatchType].
  final Map<String, MatchType> _cache = {};

  /// Observe tous les types de match. Alimente le cache au passage.
  ///
  /// Les erreurs de stream remontent (le `StreamProvider` les expose en
  /// `AsyncError`) — l'UI les rend via `AsyncValueView`.
  Stream<List<MatchType>> watchMatchTypes() {
    return FirebaseRefs.matchTypes.snapshots().map((snapshot) {
      final types = snapshot.docs
          .map(MatchType.fromFirestore)
          .toList(growable: false);
      for (final type in types) {
        _cache[type.id] = type;
      }
      return types;
    });
  }

  /// Lecture ponctuelle d'un type de match, cachée. `null` si introuvable.
  Future<MatchType?> getMatchType(String id) async {
    final cached = _cache[id];
    if (cached != null) return cached;
    try {
      final snapshot = await FirebaseRefs.matchTypes.doc(id).get();
      if (!snapshot.exists || snapshot.data() == null) return null;
      final type = MatchType.fromFirestore(snapshot);
      _cache[id] = type;
      return type;
    } catch (error, stack) {
      _log.error('getMatchType failed for /matchTypes/$id', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
  }
}
