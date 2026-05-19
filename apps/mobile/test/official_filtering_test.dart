// Tests de `openHomeSlotsAtLevel` — règle métier de filtrage des créneaux
// d'officiels au niveau de l'officiel courant. Fonction pure exportée par
// `official_providers.dart`.
import 'package:courtbase_mobile/models/enums.dart';
import 'package:courtbase_mobile/models/match_type.dart';
import 'package:courtbase_mobile/models/official_assignment.dart';
import 'package:courtbase_mobile/providers/official_providers.dart';
import 'package:flutter_test/flutter_test.dart';

/// Construit un `MatchType` avec les seuls champs utiles au filtrage.
MatchType _matchType(List<OfficialRequirement> reqs) => MatchType(
      id: 'mt',
      name: 'Championnat',
      requiredCourtSize: CourtSize.normal,
      homeOfficialRequirements: reqs,
      awayOfficialCount: 0,
      color: '#000000',
      active: true,
      createdAt: DateTime(2026, 1, 1),
    );

/// Construit une assignation avec un niveau + un statut donnés.
OfficialAssignment _assignment(int level, OfficialAssignmentStatus status) =>
    OfficialAssignment(
      id: 'oa-$level-${status.name}',
      memberId: 'mem',
      officialLevel: level,
      status: status,
      assignedAt: DateTime(2026, 1, 1),
      assignedBy: 'admin',
      respondedAt: null,
      parentKind: OfficialAssignmentParent.booking,
      parentId: 'bk',
    );

void main() {
  group('openHomeSlotsAtLevel — un officiel de niveau N voit les slots <= N', () {
    test('aucune assignation : toutes les places de niveau <= N sont libres', () {
      final type = _matchType(const [
        OfficialRequirement(level: 1, count: 2),
        OfficialRequirement(level: 2, count: 1),
        OfficialRequirement(level: 3, count: 1),
      ]);
      // Officiel niveau 2 : voit les slots niveau 1 (2) + niveau 2 (1) = 3.
      // Le slot niveau 3 lui est invisible.
      expect(
        openHomeSlotsAtLevel(matchType: type, assignments: const [], myLevel: 2),
        3,
      );
    });

    test('un officiel de niveau 1 ne voit que les slots de niveau 1', () {
      final type = _matchType(const [
        OfficialRequirement(level: 1, count: 2),
        OfficialRequirement(level: 3, count: 5),
      ]);
      expect(
        openHomeSlotsAtLevel(matchType: type, assignments: const [], myLevel: 1),
        2,
      );
    });

    test('un officiel de haut niveau voit tous les slots', () {
      final type = _matchType(const [
        OfficialRequirement(level: 1, count: 1),
        OfficialRequirement(level: 2, count: 1),
        OfficialRequirement(level: 3, count: 1),
      ]);
      expect(
        openHomeSlotsAtLevel(matchType: type, assignments: const [], myLevel: 9),
        3,
      );
    });

    test('les assignations actives consomment les places', () {
      final type = _matchType(const [
        OfficialRequirement(level: 1, count: 3),
      ]);
      final assignments = [
        _assignment(1, OfficialAssignmentStatus.pending),
        _assignment(1, OfficialAssignmentStatus.confirmed),
      ];
      // 3 requis - 2 actifs (pending + confirmed) = 1 place libre.
      expect(
        openHomeSlotsAtLevel(
          matchType: type,
          assignments: assignments,
          myLevel: 1,
        ),
        1,
      );
    });

    test('les assignations declined ne consomment PAS de place', () {
      final type = _matchType(const [
        OfficialRequirement(level: 1, count: 2),
      ]);
      final assignments = [
        _assignment(1, OfficialAssignmentStatus.declined),
        _assignment(1, OfficialAssignmentStatus.declined),
      ];
      expect(
        openHomeSlotsAtLevel(
          matchType: type,
          assignments: assignments,
          myLevel: 1,
        ),
        2,
      );
    });

    test('un niveau sur-staffé ne produit pas de places négatives', () {
      final type = _matchType(const [
        OfficialRequirement(level: 1, count: 1),
        OfficialRequirement(level: 2, count: 2),
      ]);
      final assignments = [
        // niveau 1 : 3 actifs pour 1 requis -> -2, mais on ignore les négatifs.
        _assignment(1, OfficialAssignmentStatus.confirmed),
        _assignment(1, OfficialAssignmentStatus.confirmed),
        _assignment(1, OfficialAssignmentStatus.confirmed),
      ];
      // niveau 1 sur-staffé -> 0 (pas -2) ; niveau 2 -> 2 libres. Total 2.
      expect(
        openHomeSlotsAtLevel(
          matchType: type,
          assignments: assignments,
          myLevel: 2,
        ),
        2,
      );
    });

    test('aucune exigence -> 0 place', () {
      expect(
        openHomeSlotsAtLevel(
          matchType: _matchType(const []),
          assignments: const [],
          myLevel: 5,
        ),
        0,
      );
    });
  });
}
