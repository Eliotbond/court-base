import 'package:add_2_calendar/add_2_calendar.dart';

import '../core/logger.dart';

/// Service d'ajout d'événement au calendrier de l'appareil.
///
/// Wrappe `add_2_calendar` : construit un [Event] et ouvre l'éditeur de
/// calendrier natif. Proposé à l'officiel après une auto-inscription et depuis
/// l'écran de détail d'un match.
class CalendarService {
  CalendarService();

  final AppLogger _log = const AppLogger('CalendarService');

  /// Ajoute un événement de match au calendrier. Renvoie `true` si l'OS a
  /// confirmé l'ouverture de l'éditeur.
  Future<bool> addMatchEvent({
    required String title,
    required DateTime start,
    required DateTime end,
    String? location,
    String? description,
  }) async {
    try {
      final event = Event(
        title: title,
        location: location,
        description: description,
        startDate: start,
        endDate: end,
      );
      return await Add2Calendar.addEvent2Cal(event);
    } catch (error, stack) {
      _log.warn('addMatchEvent failed', error, stack);
      return false;
    }
  }
}
