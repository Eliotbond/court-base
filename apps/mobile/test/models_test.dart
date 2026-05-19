// Tests de `fromMap` des modèles clés — parsing tolérant, valeurs de repli,
// objets imbriqués. Aucun Firebase requis : on exerce `fromMap(id, map)`
// directement avec des Map brutes (équivalent du `data()` d'un snapshot).
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:courtbase_mobile/models/app_notification.dart';
import 'package:courtbase_mobile/models/booking.dart';
import 'package:courtbase_mobile/models/enums.dart';
import 'package:courtbase_mobile/models/match.dart';
import 'package:courtbase_mobile/models/member.dart';
import 'package:courtbase_mobile/models/official_assignment.dart';
import 'package:courtbase_mobile/models/team.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Member.fromMap', () {
    test('document complet — tous les champs parsés', () {
      final member = Member.fromMap('mem1', {
        'firstName': 'Léa',
        'lastName': 'Martin',
        'status': 'active',
        'roles': ['role-a', 'role-b'],
        'linkedUserId': 'uid-7',
        'licenseNumber': 'LIC-42',
        'officialLevel': 2,
        'coachLevel': 1,
        'officialLicense': {
          'licenseId': 'lic-o',
          'seasonId': 's2026',
          'level': 3,
        },
        'licensed': true,
        'duesStatus': 'overdue',
        'active': true,
        'birthDate': Timestamp.fromDate(DateTime.utc(2010, 6, 1)),
        'guardianUserIds': ['g1'],
        'avs': '756.1234',
        'transferState': 'national_pending',
      });

      expect(member.id, 'mem1');
      expect(member.fullName, 'Léa Martin');
      expect(member.status, MemberStatus.active);
      expect(member.roles, ['role-a', 'role-b']);
      expect(member.officialLevel, 2);
      expect(member.coachLevel, 1);
      expect(member.duesStatus, DuesStatus.overdue);
      expect(member.transferState, MemberTransferState.nationalPending);
      // `Timestamp.toDate()` -> DateTime local : on compare l'instant.
      expect(
        member.birthDate!.isAtSameMomentAs(DateTime.utc(2010, 6, 1)),
        isTrue,
      );
      expect(member.guardianUserIds, ['g1']);
    });

    test('document minimal — replis appliqués', () {
      final member = Member.fromMap('mem2', const {});
      expect(member.firstName, '');
      expect(member.lastName, '');
      expect(member.status, MemberStatus.active);
      expect(member.roles, isEmpty);
      expect(member.officialLevel, isNull);
      expect(member.duesStatus, DuesStatus.na);
      // `active` absent doit être traité comme actif.
      expect(member.active, isTrue);
      expect(member.transferState, MemberTransferState.none);
    });

    test('ActiveLicenseRef — parsé quand licenseId+seasonId présents', () {
      final member = Member.fromMap('m', {
        'officialLicense': {'licenseId': 'L1', 'seasonId': 'S1', 'level': 4},
      });
      expect(member.officialLicense, isNotNull);
      expect(member.officialLicense!.licenseId, 'L1');
      expect(member.officialLicense!.level, 4);
      expect(member.isActiveOfficial, isTrue);
    });

    test('ActiveLicenseRef — null si champs requis manquants', () {
      final m1 = Member.fromMap('m', {
        'officialLicense': {'seasonId': 'S1'}, // pas de licenseId
      });
      expect(m1.officialLicense, isNull);
      expect(m1.isActiveOfficial, isFalse);

      final m2 = Member.fromMap('m', {'officialLicense': 'pas un objet'});
      expect(m2.officialLicense, isNull);
    });

    test('isQualifiedOfficial dérive de officialLevel', () {
      expect(Member.fromMap('m', {'officialLevel': 1}).isQualifiedOfficial,
          isTrue);
      expect(Member.fromMap('m', const {}).isQualifiedOfficial, isFalse);
    });

    test('isArchived dérive du status', () {
      expect(
        Member.fromMap('m', {'status': 'archived'}).isArchived,
        isTrue,
      );
    });
  });

  group('Match.fromMap', () {
    test('match away complet', () {
      final match = Match.fromMap('mt1', {
        'bookingId': null,
        'kind': 'away',
        'teamId': 't1',
        'matchTypeId': 'mtype1',
        'opponentName': 'BC Rivaux',
        'awayAddress': '12 rue du Sport',
        'date': Timestamp.fromDate(DateTime.utc(2026, 5, 20)),
        'startTime': '18:00',
        'endTime': '20:00',
        'status': 'scheduled',
        'createdBy': 'coach-1',
      });
      expect(match.kind, MatchKind.away);
      expect(match.isHome, isFalse);
      expect(match.opponentName, 'BC Rivaux');
      expect(
        match.date.isAtSameMomentAs(DateTime.utc(2026, 5, 20)),
        isTrue,
      );
      expect(match.status, MatchStatus.scheduled);
    });

    test('kind inconnu retombe sur home', () {
      final match = Match.fromMap('mt2', {'kind': '???'});
      expect(match.kind, MatchKind.home);
      expect(match.isHome, isTrue);
    });
  });

  group('Booking.fromMap', () {
    test('booking avec actionLog imbriqué', () {
      final booking = Booking.fromMap('bk1', {
        'seasonId': 's2026',
        'venueId': 'v1',
        'courtId': 'c1',
        'timeSlotId': 'ts1',
        'teamId': 't1',
        'slotType': 'match_home',
        'date': Timestamp.fromDate(DateTime.utc(2026, 5, 21)),
        'startTime': '19:00',
        'endTime': '21:00',
        'status': 'scheduled',
        'linkedBookingIds': ['bk2', 'bk3'],
        'isManual': true,
        'actionLog': [
          {
            'at': Timestamp.fromDate(DateTime.utc(2026, 1, 1)),
            'by': 'admin-1',
            'action': 'created',
            'note': 'init',
          },
        ],
      });
      expect(booking.slotType, SlotType.matchHome);
      expect(booking.linkedBookingIds, ['bk2', 'bk3']);
      expect(booking.isManual, isTrue);
      expect(booking.actionLog, hasLength(1));
      expect(booking.actionLog.first.by, 'admin-1');
      expect(booking.actionLog.first.action, 'created');
    });

    test('slotType inconnu retombe sur custom', () {
      expect(
        Booking.fromMap('bk', {'slotType': 'mystère'}).slotType,
        SlotType.custom,
      );
    });
  });

  group('OfficialAssignment.fromMap', () {
    test('assignation pending avec parent explicite', () {
      final assignment = OfficialAssignment.fromMap(
        'oa1',
        {
          'memberId': 'mem-9',
          'officialLevel': 2,
          'status': 'pending',
          'assignedAt': Timestamp.fromDate(DateTime.utc(2026, 5, 1)),
          'assignedBy': 'admin-3',
        },
        parentKind: OfficialAssignmentParent.booking,
        parentId: 'bk-77',
      );
      expect(assignment.memberId, 'mem-9');
      expect(assignment.officialLevel, 2);
      expect(assignment.status, OfficialAssignmentStatus.pending);
      expect(assignment.parentKind, OfficialAssignmentParent.booking);
      expect(assignment.parentId, 'bk-77');
      expect(assignment.respondedAt, isNull);
    });

    test('status inconnu retombe sur pending', () {
      final assignment = OfficialAssignment.fromMap(
        'oa2',
        {'status': 'weird'},
        parentKind: OfficialAssignmentParent.match,
        parentId: 'mt-1',
      );
      expect(assignment.status, OfficialAssignmentStatus.pending);
    });
  });

  group('AppNotification.fromMap', () {
    test('notification complète + isReadBy', () {
      final notif = AppNotification.fromMap('n1', {
        'type': 'officials_needed',
        'title': 'Officiels recherchés',
        'body': 'Match samedi',
        'sentBy': null,
        'targetAudience': 'all_officials',
        'relatedMatchId': 'mt-5',
        'createdAt': Timestamp.fromDate(DateTime.utc(2026, 5, 10)),
        'readBy': ['uid-a', 'uid-b'],
      });
      expect(notif.type, NotificationType.officialsNeeded);
      expect(notif.targetAudience, NotificationTargetAudience.allOfficials);
      expect(notif.relatedMatchId, 'mt-5');
      expect(notif.isReadBy('uid-a'), isTrue);
      expect(notif.isReadBy('uid-z'), isFalse);
    });

    test('type inconnu retombe sur newMatch', () {
      expect(
        AppNotification.fromMap('n2', {'type': 'spam'}).type,
        NotificationType.newMatch,
      );
    });

    test('readBy absent -> liste vide, tout non-lu', () {
      final notif = AppNotification.fromMap('n3', const {});
      expect(notif.readBy, isEmpty);
      expect(notif.isReadBy('quiconque'), isFalse);
    });
  });

  group('Team.fromMap', () {
    test('équipe avec tags imbriqués', () {
      final team = Team.fromMap('tm1', {
        'name': 'U16 Garçons',
        'categoryId': 'cat-u16',
        'gender': 'M',
        'coachIds': ['c1'],
        'playerIds': ['p1', 'p2', 'p3'],
        'cotisationId': 'cot-1',
        'registrationStatus': 'open',
        'tags': [
          {'tagId': 'tg1', 'display': true},
          {'tagId': 'tg2', 'display': false},
        ],
      });
      expect(team.name, 'U16 Garçons');
      expect(team.gender, TeamGender.male);
      expect(team.playerIds, hasLength(3));
      expect(team.registrationStatus, TeamRegistrationStatus.open);
      expect(team.tags, hasLength(2));
      expect(team.tags.first.tagId, 'tg1');
      expect(team.tags.first.display, isTrue);
    });

    test('document minimal — replis', () {
      final team = Team.fromMap('tm2', const {});
      expect(team.name, '');
      expect(team.gender, TeamGender.mixed);
      expect(team.playerIds, isEmpty);
      // `registrationStatus` absent -> closed (repli sûr).
      expect(team.registrationStatus, TeamRegistrationStatus.closed);
      // `active` absent -> traité actif.
      expect(team.active, isTrue);
    });
  });
}
