// Tests de `MemberRepository.deriveActiveRoster` — dérivation de l'effectif
// affichable depuis les membres résolus de `team.playerIds`. Fonction pure.
import 'package:courtbase_mobile/models/member.dart';
import 'package:courtbase_mobile/repositories/member_repository.dart';
import 'package:flutter_test/flutter_test.dart';

Member _member(String id, String first, String last, {String status = 'active'}) =>
    Member.fromMap(id, {
      'firstName': first,
      'lastName': last,
      'status': status,
    });

void main() {
  group('MemberRepository.deriveActiveRoster', () {
    test('liste vide -> effectif vide', () {
      expect(MemberRepository.deriveActiveRoster(const []), isEmpty);
    });

    test('les membres archivés sont exclus', () {
      final roster = MemberRepository.deriveActiveRoster([
        _member('m1', 'Anna', 'Blanc'),
        _member('m2', 'Bruno', 'Noir', status: 'archived'),
        _member('m3', 'Chloé', 'Vert'),
      ]);
      expect(roster.map((m) => m.id), ['m1', 'm3']);
    });

    test('tri par nom complet, insensible à la casse', () {
      final roster = MemberRepository.deriveActiveRoster([
        _member('m1', 'zoé', 'Aaa'),
        _member('m2', 'Adam', 'Bbb'),
        _member('m3', 'bart', 'Ccc'),
      ]);
      expect(
        roster.map((m) => m.fullName),
        ['Adam Bbb', 'bart Ccc', 'zoé Aaa'],
      );
    });

    test('effectif 100% archivé -> vide', () {
      final roster = MemberRepository.deriveActiveRoster([
        _member('m1', 'X', 'Y', status: 'archived'),
        _member('m2', 'A', 'B', status: 'archived'),
      ]);
      expect(roster, isEmpty);
    });
  });
}
