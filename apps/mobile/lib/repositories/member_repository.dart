import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/app_exception.dart';
import '../core/logger.dart';
import '../firebase/firebase_refs.dart';
import '../models/enums.dart';
import '../models/member.dart';
import '../models/team.dart';

/// Repository d'accès aux membres (`/members`) et à leurs contacts privés
/// (`/members/{id}/private/contact`).
///
/// Périmètre coach : l'effectif d'une équipe est dérivé de `team.playerIds`
/// (lecture des docs `/members` par id). Les contacts sont lus à part — un
/// `permission-denied` y est toléré (renvoie `null`).
class MemberRepository {
  MemberRepository();

  final AppLogger _log = const AppLogger('MemberRepository');

  /// Taille maximale d'une clause `whereIn` Firestore.
  static const int _whereInChunk = 30;

  /// Observe l'effectif (joueurs) de [team], résolu depuis `team.playerIds`.
  ///
  /// Découpe `playerIds` en lots de 30 (limite `whereIn`). Filtre côté client
  /// les membres `status == active` (les archivés restent dans `playerIds`
  /// pour l'historique mais ne sont pas affichés dans le roster actif).
  Stream<List<Member>> watchRosterForTeam(Team team) {
    final ids = team.playerIds.toSet().toList(growable: false);
    if (ids.isEmpty) {
      return Stream<List<Member>>.value(const <Member>[]);
    }

    final chunks = _chunk(ids, _whereInChunk);
    final perChunk = chunks.map((chunk) {
      return FirebaseRefs.members
          .where(FieldPath.documentId, whereIn: chunk)
          .snapshots()
          .map((snapshot) =>
              snapshot.docs.map(Member.fromFirestore).toList(growable: false));
    }).toList(growable: false);

    return _combineLatestList(perChunk).map((listOfLists) {
      final all = <Member>[];
      for (final sub in listOfLists) {
        all.addAll(sub);
      }
      return deriveActiveRoster(all);
    });
  }

  /// Dérive l'effectif actif affichable depuis l'ensemble brut des membres
  /// résolus depuis `team.playerIds` : ne garde que les `status == active`
  /// (les archivés restent dans `playerIds` pour l'historique) et trie par
  /// nom complet (insensible à la casse).
  ///
  /// Fonction pure — extraite pour être testable sans Firebase.
  static List<Member> deriveActiveRoster(List<Member> members) {
    final active = members
        .where((m) => m.status == MemberStatus.active)
        .toList(growable: true);
    active.sort(
      (a, b) => a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase()),
    );
    return active;
  }

  /// Observe un membre par id (`/members/{id}`).
  Stream<Member?> watchMember(String id) {
    return FirebaseRefs.members.doc(id).snapshots().map((snapshot) {
      if (!snapshot.exists || snapshot.data() == null) return null;
      return Member.fromFirestore(snapshot);
    });
  }

  /// Lit le contact privé d'un membre (`/members/{id}/private/contact`).
  ///
  /// Tolère `permission-denied` (un coach peut ne pas avoir accès au contact
  /// d'un membre hors de ses équipes) → renvoie `null` sans lever.
  Future<MemberContact?> getContact(String memberId) async {
    try {
      final snapshot = await FirebaseRefs.memberContactDoc(memberId).get();
      if (!snapshot.exists || snapshot.data() == null) return null;
      return MemberContact.fromFirestore(snapshot);
    } on FirebaseException catch (error, stack) {
      if (error.code == 'permission-denied') {
        _log.warn('getContact: accès refusé pour /members/$memberId/private');
        return null;
      }
      _log.error('getContact failed for /members/$memberId', error, stack);
      throw AppException.fromFirebase(error, stack);
    } catch (error, stack) {
      _log.error('getContact failed for /members/$memberId', error, stack);
      throw AppException.fromFirebase(error, stack);
    }
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
        controller.add(latest.map((e) => e as T).toList(growable: false));
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
