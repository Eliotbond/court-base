import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';

/// Document `/categories/{categoryId}` — référentiel d'âge éditable par l'admin.
class Category {
  const Category({
    required this.id,
    required this.name,
    required this.minAge,
    required this.maxAge,
    required this.displayOrder,
    required this.active,
    required this.createdAt,
  });

  final String id;
  final String name;

  /// Borne basse incluse. `null` = catégorie ouverte par le bas.
  final int? minAge;

  /// Borne haute incluse. `null` = catégorie ouverte par le haut.
  final int? maxAge;
  final int displayOrder;
  final bool active;
  final DateTime createdAt;

  /// Libellé de la tranche d'âge dérivé des bornes.
  String get ageRangeLabel {
    if (minAge == null && maxAge == null) return 'Ouvert';
    if (minAge != null && maxAge == null) return '$minAge ans+';
    if (minAge != null && maxAge != null) {
      return minAge == maxAge ? '$minAge ans' : '$minAge-$maxAge ans';
    }
    return 'Jusqu\'à $maxAge ans';
  }

  factory Category.fromMap(String id, Map<String, dynamic> map) => Category(
        id: id,
        name: FsConvert.str(map['name']),
        minAge: FsConvert.intOrNull(map['minAge']),
        maxAge: FsConvert.intOrNull(map['maxAge']),
        displayOrder: FsConvert.integer(map['displayOrder']),
        active: FsConvert.boolean(map['active'], true),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
      );

  factory Category.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      Category.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  Category copyWith({
    String? name,
    int? minAge,
    int? maxAge,
    int? displayOrder,
    bool? active,
    DateTime? createdAt,
  }) =>
      Category(
        id: id,
        name: name ?? this.name,
        minAge: minAge ?? this.minAge,
        maxAge: maxAge ?? this.maxAge,
        displayOrder: displayOrder ?? this.displayOrder,
        active: active ?? this.active,
        createdAt: createdAt ?? this.createdAt,
      );
}
