import 'package:flutter/material.dart';

import '../../shared/theme/app_colors.dart';

/// Écran de démarrage affiché tant que l'état de session n'est pas résolu
/// (`sessionStateProvider` en `loading`).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.sports_basketball, size: 64, color: AppColors.brand),
            SizedBox(height: 20),
            SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
          ],
        ),
      ),
    );
  }
}
