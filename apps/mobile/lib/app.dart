import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router/app_router.dart';
import 'shared/theme/app_theme.dart';

/// Widget racine de l'application.
///
/// `MaterialApp.router` câblé sur le `GoRouter` fourni par
/// [goRouterProvider]. Le routing (splash / sign-in / orphan / shell) est
/// entièrement piloté par le redirect du router.
class CourtbaseApp extends ConsumerWidget {
  const CourtbaseApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(goRouterProvider);

    return MaterialApp.router(
      title: 'Courtbase',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      routerConfig: router,
    );
  }
}
