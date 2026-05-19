import 'package:flutter/material.dart';

/// Palette de couleurs de l'app. Centralise les seeds Material 3 et les
/// accents sémantiques (statuts d'assignation, badges).
class AppColors {
  const AppColors._();

  /// Couleur de marque — seed du `ColorScheme`.
  static const Color brand = Color(0xFFE05A2B); // orange basket

  /// Surface sombre pour l'AppBar / héros.
  static const Color ink = Color(0xFF1A1C1E);

  // --- Accents sémantiques (statuts) -------------------------------------

  /// Confirmé / OK.
  static const Color success = Color(0xFF2E7D32);

  /// En attente / à traiter.
  static const Color warning = Color(0xFFE6A100);

  /// Refusé / erreur.
  static const Color danger = Color(0xFFC62828);

  /// Information neutre.
  static const Color info = Color(0xFF1565C0);
}
