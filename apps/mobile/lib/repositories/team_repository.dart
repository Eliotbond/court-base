import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/category.dart';
import '../models/team.dart';

/// Repository d'accès aux équipes (`/teams`) et au référentiel de catégories
/// (`/categories`).
///
/// Périmètre coach : observer les équipes coachées (résolues depuis
/// `AppUser.teamIds`) et résoudre les libellés de catégorie.
class TeamRepository {
  TeamRepository();

  // ignore: unused_field
  final AppLogger _log = const AppLogger('TeamRepository');

  /// Taille maximale d'une clause `whereIn` Firestore.
  static const int _whereInChunk = 30;

  /// Observe les équipes dont l'`id` est dans [ids].
  ///
  /// Découpe [ids] en lots de 30 (limite `whereIn`) ; combine les streams en
  /// fusionnant les snapshots par lot. `ids` vide → stream d'une liste vide.
  Stream<List<Team>> watchTeamsByIds(List<String> ids) {
    final unique = ids.toSet().toList(growable: false);
    if (unique.isEmpty) {
      return Stream<List<Team>>.value(const <Team>[]);
    }

    final chunks = _chunk(unique, _whereInChunk);
    final perChunk = chunks.map((chunk) {
      return FirebaseRefs.teams
          .where(FieldPath.documentId, whereIn: chunk)
          .snapshots()
          .map((snapshot) =>
              snapshot.docs.map(Team.fromFirestore).toList(growable: false));
    }).toList(growable: false);

    return _combineLatestList(perChunk).map((listOfLists) {
      final all = <Team>[];
      for (final sub in listOfLists) {
        all.addAll(sub);
      }
      all.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      return all;
    });
  }

  /// Observe le référentiel complet de catégories (`/categories`).
  Stream<List<Category>> watchCategories() {
    return FirebaseRefs.categories.snapshots().map((snapshot) {
      final cats =
          snapshot.docs.map(Category.fromFirestore).toList(growable: true);
      cats.sort((a, b) => a.displayOrder.compareTo(b.displayOrder));
      return cats;
    });
  }

  // --- Helpers ------------------------------------------------------------

  static List<List<T>> _chunk<T>(List<T> source, int size) {
    final chunks = <List<T>>[];
    for (var i = 0; i < source.length; i += size) {
      chunks.add(source.sublist(
        i,
        i + size > source.length ? source.length : i + size,
      ));
    }
    return chunks;
  }

  /// Combine une liste de streams en un stream émettant la liste des dernières
  /// valeurs connues, dès que chaque source a émis au moins une fois.
  static Stream<List<T>> _combineLatestList<T>(List<Stream<T>> streams) {
    if (streams.isEmpty) {
      return Stream<List<T>>.value(const []);
    }
    final controller = StreamController<List<T>>();
    final latest = List<T?>.filled(streams.length, null);
    final seen = List<bool>.filled(streams.length, false);
    final subs = <StreamSubscription<T>>[];

    void emitIfReady() {
      if (seen.every((e) => e)) {
        controller.add(
          latest.map((e) => e as T).toList(growable: false),
        );
      }
    }

    for (var i = 0; i < streams.length; i++) {
      final index = i;
      subs.add(streams[index].listen(
        (value) {
          latest[index] = value;
          seen[index] = true;
          emitIfReady();
        },
        onError: controller.addError,
      ));
    }

    controller.onCancel = () async {
      for (final sub in subs) {
        await sub.cancel();
      }
    };

    return controller.stream;
  }
}
