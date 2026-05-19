import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../repositories/auth_repository.dart';
import '../repositories/member_repository.dart';
import '../repositories/user_repository.dart';

/// Providers d'infrastructure — exposent les repositories aux couches
/// supérieures (providers métier, widgets). Les widgets n'instancient JAMAIS
/// un repository directement : ils passent par ces providers.
///
/// Cette couche ne touche PAS le SDK Firebase : seuls les `repositories/`
/// (et `firebase/`) importent `cloud_firestore` / `firebase_auth` / etc.

/// Repository d'authentification (singleton applicatif).
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository();
});

/// Repository d'accès au document `/users/{uid}`.
final userRepositoryProvider = Provider<UserRepository>((ref) {
  return UserRepository();
});

/// Repository d'accès aux membres (`/members`) — partagé entre les slices
/// coach et officiel. Exposé ici (couche infrastructure) plutôt que dans une
/// slice métier pour éviter un import croisé entre `coach_providers` et
/// `official_providers`.
final memberRepositoryProvider = Provider<MemberRepository>((ref) {
  return MemberRepository();
});
