import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Besoin d'officiels pour un niveau donné (match à domicile).
class OfficialRequirement {
  const OfficialRequirement({required this.level, required this.count});

  final int level;
  final int count;

  factory OfficialRequirement.fromMap(Map<String, dynamic> map) =>
      OfficialRequirement(
        level: FsConvert.integer(map['level']),
        count: FsConvert.integer(map['count']),
      );
}

/// Document `/matchTypes/{matchTypeId}` — type de compétition.
class MatchType {
  const MatchType({
    required this.id,
    required this.name,
    required this.requiredCourtSize,
    required this.homeOfficialRequirements,
    required this.awayOfficialCount,
    required this.color,
    required this.active,
    required this.createdAt,
  });

  final String id;
  final String name;
  final CourtSize requiredCourtSize;

  /// Besoins d'officiels par niveau pour les matchs à domicile.
  final List<OfficialRequirement> homeOfficialRequirements;

  /// Nombre total d'officiels requis pour un match à l'extérieur.
  final int awayOfficialCount;

  /// Couleur d'affichage (hex).
  final String color;
  final bool active;
  final DateTime createdAt;

  factory MatchType.fromMap(String id, Map<String, dynamic> map) => MatchType(
        id: id,
        name: FsConvert.str(map['name']),
        requiredCourtSize: CourtSize.fromWire(map['requiredCourtSize']),
        homeOfficialRequirements: FsConvert.mapList(
          map['homeOfficialRequirements'],
        ).map(OfficialRequirement.fromMap).toList(growable: false),
        awayOfficialCount: FsConvert.integer(map['awayOfficialCount']),
        color: FsConvert.str(map['color']),
        active: FsConvert.boolean(map['active'], true),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
      );

  factory MatchType.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      MatchType.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  MatchType copyWith({
    String? name,
    CourtSize? requiredCourtSize,
    List<OfficialRequirement>? homeOfficialRequirements,
    int? awayOfficialCount,
    String? color,
    bool? active,
    DateTime? createdAt,
  }) =>
      MatchType(
        id: id,
        name: name ?? this.name,
        requiredCourtSize: requiredCourtSize ?? this.requiredCourtSize,
        homeOfficialRequirements:
            homeOfficialRequirements ?? this.homeOfficialRequirements,
        awayOfficialCount: awayOfficialCount ?? this.awayOfficialCount,
        color: color ?? this.color,
        active: active ?? this.active,
        createdAt: createdAt ?? this.createdAt,
      );
}
