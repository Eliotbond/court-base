import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Référence à un tag d'équipe (`/teams.tags[]`).
class TeamTagRef {
  const TeamTagRef({required this.tagId, required this.display});

  final String tagId;

  /// Flag d'affichage propre à cette équipe.
  final bool display;

  factory TeamTagRef.fromMap(Map<String, dynamic> map) => TeamTagRef(
        tagId: FsConvert.str(map['tagId']),
        display: FsConvert.boolean(map['display']),
      );
}

/// Document `/teams/{teamId}` — équipe du club.
///
/// `categoryId` et `cotisationId` sont des **références** : le libellé / prix
/// sont résolus à la lecture (pas dénormalisés). Seul un sous-ensemble des
/// champs du schéma est modélisé ici — les contraintes de planning et les
/// champs publics ne sont pas requis par l'app mobile officiel/coach.
class Team {
  const Team({
    required this.id,
    required this.name,
    required this.categoryId,
    required this.gender,
    required this.coachIds,
    required this.playerIds,
    required this.activeSeasonIds,
    required this.cotisationId,
    required this.tags,
    required this.registrationStatus,
    required this.active,
    required this.createdAt,
  });

  final String id;
  final String name;

  /// Référence vers `/categories/{categoryId}`.
  final String categoryId;
  final TeamGender gender;

  /// memberIds des coachs.
  final List<String> coachIds;

  /// memberIds des joueurs.
  final List<String> playerIds;
  final List<String> activeSeasonIds;

  /// Référence vers `/cotisations/{id}`.
  final String cotisationId;
  final List<TeamTagRef> tags;
  final TeamRegistrationStatus registrationStatus;
  final bool active;
  final DateTime createdAt;

  factory Team.fromMap(String id, Map<String, dynamic> map) => Team(
        id: id,
        name: FsConvert.str(map['name']),
        categoryId: FsConvert.str(map['categoryId']),
        gender: TeamGender.fromWire(map['gender']),
        coachIds: FsConvert.stringList(map['coachIds']),
        playerIds: FsConvert.stringList(map['playerIds']),
        activeSeasonIds: FsConvert.stringList(map['activeSeasonIds']),
        cotisationId: FsConvert.str(map['cotisationId']),
        tags: FsConvert.mapList(map['tags'])
            .map(TeamTagRef.fromMap)
            .toList(growable: false),
        registrationStatus:
            TeamRegistrationStatus.fromWire(map['registrationStatus']),
        active: FsConvert.boolean(map['active'], true),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
      );

  factory Team.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      Team.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  Team copyWith({
    String? name,
    String? categoryId,
    TeamGender? gender,
    List<String>? coachIds,
    List<String>? playerIds,
    List<String>? activeSeasonIds,
    String? cotisationId,
    List<TeamTagRef>? tags,
    TeamRegistrationStatus? registrationStatus,
    bool? active,
    DateTime? createdAt,
  }) =>
      Team(
        id: id,
        name: name ?? this.name,
        categoryId: categoryId ?? this.categoryId,
        gender: gender ?? this.gender,
        coachIds: coachIds ?? this.coachIds,
        playerIds: playerIds ?? this.playerIds,
        activeSeasonIds: activeSeasonIds ?? this.activeSeasonIds,
        cotisationId: cotisationId ?? this.cotisationId,
        tags: tags ?? this.tags,
        registrationStatus: registrationStatus ?? this.registrationStatus,
        active: active ?? this.active,
        createdAt: createdAt ?? this.createdAt,
      );
}
