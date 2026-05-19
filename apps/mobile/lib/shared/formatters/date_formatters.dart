import 'package:intl/intl.dart';

import '../../core/constants.dart';

/// Formateurs de dates / heures localisés (français).
///
/// `intl` exige un appel d'initialisation des données de locale au boot —
/// fait dans `main.dart` via `initializeDateFormatting`.
class DateFormatters {
  const DateFormatters._();

  /// "lun. 18 mai" — date courte avec jour de semaine.
  static String shortDate(DateTime date) =>
      DateFormat('EEE d MMM', kAppLocale).format(date);

  /// "lundi 18 mai 2026" — date longue.
  static String longDate(DateTime date) =>
      DateFormat('EEEE d MMMM y', kAppLocale).format(date);

  /// "18/05/2026" — date numérique.
  static String numericDate(DateTime date) =>
      DateFormat('dd/MM/y', kAppLocale).format(date);

  /// "14:30" — heure.
  static String time(DateTime date) =>
      DateFormat('HH:mm', kAppLocale).format(date);

  /// "lun. 18 mai · 14:30" — date + heure.
  static String dateTime(DateTime date) =>
      '${shortDate(date)} · ${time(date)}';

  /// Plage horaire "14:30 – 16:00" depuis deux chaînes "HH:MM".
  static String timeRange(String start, String end) => '$start – $end';
}
