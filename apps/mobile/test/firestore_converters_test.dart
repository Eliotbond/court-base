// Tests unitaires de `FsConvert` — conversion Timestamp/DateTime, parsing
// d'enums tolérant, accès Map null-safe. Logique pure, aucun Firebase requis.
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:courtbase_mobile/core/firestore_converters.dart';
import 'package:flutter_test/flutter_test.dart';

/// Enum jouet pour exercer `parseEnum` / `parseEnumOrNull`.
enum _Color { red, green, blue }

void main() {
  group('FsConvert.toDateTime', () {
    test('Timestamp -> DateTime (même instant)', () {
      // `Timestamp.toDate()` renvoie un DateTime local : on compare l'instant,
      // pas le drapeau UTC.
      final instant = DateTime.utc(2026, 5, 18, 12);
      final ts = Timestamp.fromDate(instant);
      expect(FsConvert.toDateTime(ts)!.isAtSameMomentAs(instant), isTrue);
    });

    test('int epoch-millis -> DateTime', () {
      final result = FsConvert.toDateTime(0);
      expect(result, DateTime.fromMillisecondsSinceEpoch(0));
    });

    test('DateTime déjà converti est renvoyé tel quel', () {
      final dt = DateTime(2026, 1, 1);
      expect(FsConvert.toDateTime(dt), dt);
    });

    test('null -> null', () {
      expect(FsConvert.toDateTime(null), isNull);
    });

    test('type inattendu -> null (sans exception)', () {
      expect(FsConvert.toDateTime('pas une date'), isNull);
    });

    test('toDateTimeOr applique le fallback fourni', () {
      final fallback = DateTime(2000, 1, 1);
      expect(FsConvert.toDateTimeOr(null, fallback), fallback);
    });

    test('toDateTimeOr sans fallback retombe sur epoch 0', () {
      expect(
        FsConvert.toDateTimeOr(null),
        DateTime.fromMillisecondsSinceEpoch(0),
      );
    });

    test('fromDateTime round-trip via Timestamp (même instant)', () {
      final dt = DateTime.utc(2026, 3, 4, 5, 6);
      final ts = FsConvert.fromDateTime(dt);
      expect(FsConvert.toDateTime(ts)!.isAtSameMomentAs(dt), isTrue);
    });
  });

  group('FsConvert.parseEnum', () {
    test('valeur connue', () {
      expect(
        FsConvert.parseEnum('green', _Color.values, (e) => e.name, _Color.red),
        _Color.green,
      );
    });

    test('valeur inconnue -> fallback (jamais d\'exception)', () {
      expect(
        FsConvert.parseEnum('violet', _Color.values, (e) => e.name, _Color.red),
        _Color.red,
      );
    });

    test('valeur non-string -> fallback', () {
      expect(
        FsConvert.parseEnum(42, _Color.values, (e) => e.name, _Color.blue),
        _Color.blue,
      );
    });

    test('null -> fallback', () {
      expect(
        FsConvert.parseEnum(null, _Color.values, (e) => e.name, _Color.blue),
        _Color.blue,
      );
    });
  });

  group('FsConvert.parseEnumOrNull', () {
    test('null -> null sans warning', () {
      expect(
        FsConvert.parseEnumOrNull(null, _Color.values, (e) => e.name),
        isNull,
      );
    });

    test('valeur connue', () {
      expect(
        FsConvert.parseEnumOrNull('blue', _Color.values, (e) => e.name),
        _Color.blue,
      );
    });

    test('valeur inconnue -> null', () {
      expect(
        FsConvert.parseEnumOrNull('cyan', _Color.values, (e) => e.name),
        isNull,
      );
    });
  });

  group('FsConvert — accès Map null-safe', () {
    test('str / strOrNull', () {
      expect(FsConvert.str('hello'), 'hello');
      expect(FsConvert.str(null), '');
      expect(FsConvert.str(123, 'repli'), 'repli');
      expect(FsConvert.strOrNull('x'), 'x');
      expect(FsConvert.strOrNull(null), isNull);
      expect(FsConvert.strOrNull(123), isNull);
    });

    test('boolean', () {
      expect(FsConvert.boolean(true), isTrue);
      expect(FsConvert.boolean(null), isFalse);
      expect(FsConvert.boolean(null, true), isTrue);
      expect(FsConvert.boolean('true'), isFalse); // string non tolérée
    });

    test('integer / intOrNull tolèrent num', () {
      expect(FsConvert.integer(7), 7);
      expect(FsConvert.integer(7.9), 7);
      expect(FsConvert.integer(null, -1), -1);
      expect(FsConvert.intOrNull(null), isNull);
      expect(FsConvert.intOrNull(3.0), 3);
    });

    test('number tolère num, repli sinon', () {
      expect(FsConvert.number(2), 2.0);
      expect(FsConvert.number(2.5), 2.5);
      expect(FsConvert.number(null, 9.9), 9.9);
    });

    test('stringList filtre les non-string', () {
      expect(FsConvert.stringList(['a', 1, 'b', null]), ['a', 'b']);
      expect(FsConvert.stringList(null), isEmpty);
      expect(FsConvert.stringList('pas une liste'), isEmpty);
    });

    test('mapList normalise en Map<String,dynamic>', () {
      final result = FsConvert.mapList([
        {'k': 1},
        'ignored',
        {'k': 2},
      ]);
      expect(result, hasLength(2));
      expect(result.first['k'], 1);
    });

    test('mapOrNull', () {
      expect(FsConvert.mapOrNull({'a': 1}), {'a': 1});
      expect(FsConvert.mapOrNull(null), isNull);
      expect(FsConvert.mapOrNull('x'), isNull);
    });
  });
}
