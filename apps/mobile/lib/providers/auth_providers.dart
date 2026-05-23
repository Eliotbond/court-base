import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/app_user.dart';
import '../models/enums.dart';
import '../repositories/auth_repository.dart';
import '../repositories/user_repository.dart';
import 'firebase_providers.dart';

/// État de session de haut niveau, consommé par le router et le shell.
///
/// Trois cas (cf. plan B4) :
/// - [SessionSignedOut] : aucun user Firebase → écran de connexion.
/// - [SessionValid]     : user Firebase + doc `/users/{uid}` → app.
/// - [SessionOrphan]    : user Firebase mais pas de doc → écran orphelin.
sealed class SessionState {
  const SessionState();
}

/// Pas de session — l'utilisateur doit se connecter.
final class SessionSignedOut extends SessionState {
  const SessionSignedOut();
}

/// Session valide.
final class SessionValid extends SessionState {
  const SessionValid(this.user);

  final AppUser user;
}

/// Compte orphelin (signed-in sans `/users/{uid}`).
final class SessionOrphan extends SessionState {
  const SessionOrphan(this.uid);

  final String uid;
}

/// Stream de l'uid authentifié. `null` = déconnecté.
///
/// Le type `User` du SDK Firebase ne remonte pas jusqu'ici : le repository
/// d'auth n'expose que l'uid (couches `screens → providers → repositories`).
final authStateChangesProvider = StreamProvider<String?>((ref) {
  return ref.watch(authRepositoryProvider).authUidChanges();
});

/// Stream du document `/users/{uid}` pour le user authentifié courant.
///
/// Si aucun user Firebase n'est connecté, émet directement [AppUserState] =
/// pas applicable → on renvoie un stream qui n'émet rien (le router se base
/// alors sur [authStateChangesProvider]).
final appUserStateProvider = StreamProvider<AppUserState?>((ref) {
  final authState = ref.watch(authStateChangesProvider);

  final uid = authState.value;
  if (uid == null) {
    return Stream<AppUserState?>.value(null);
  }

  final userRepo = ref.watch(userRepositoryProvider);
  return userRepo.watchUser(uid);
});

/// État de session dérivé — combine l'état Firebase Auth et le doc `/users`.
///
/// C'est LA source de vérité pour le redirect du router.
final sessionStateProvider = Provider<AsyncValue<SessionState>>((ref) {
  final authAsync = ref.watch(authStateChangesProvider);

  return authAsync.when(
    loading: () => const AsyncValue<SessionState>.loading(),
    error: (error, stack) => AsyncValue<SessionState>.error(error, stack),
    data: (uid) {
      if (uid == null) {
        return const AsyncValue<SessionState>.data(SessionSignedOut());
      }

      final userAsync = ref.watch(appUserStateProvider);
      return userAsync.when(
        loading: () => const AsyncValue<SessionState>.loading(),
        error: (error, stack) => AsyncValue<SessionState>.error(error, stack),
        data: (userState) {
          return switch (userState) {
            null => const AsyncValue<SessionState>.loading(),
            AppUserResolved(:final user) =>
              AsyncValue<SessionState>.data(SessionValid(user)),
            AppUserOrphan(:final uid) =>
              AsyncValue<SessionState>.data(SessionOrphan(uid)),
            AppUserError(:final failure) =>
              AsyncValue<SessionState>.error(failure, StackTrace.current),
          };
        },
      );
    },
  );
});

/// [AppUser] courant si la session est valide, `null` sinon.
final appUserProvider = Provider<AppUser?>((ref) {
  final session = ref.watch(sessionStateProvider).value;
  return session is SessionValid ? session.user : null;
});

/// Snapshot des infos du compte Firebase Auth courant (email, displayName,
/// photo…). `null` si déconnecté.
///
/// Rebuilt à chaque changement d'uid pour rester en phase avec la session ;
/// on dépend volontairement de [authStateChangesProvider] pour invalider le
/// cache sur sign-in / sign-out.
final currentAccountInfoProvider = Provider<AuthAccountInfo?>((ref) {
  ref.watch(authStateChangesProvider);
  return ref.watch(authRepositoryProvider).currentAccountInfo;
});

/// Ensemble des rôles applicatifs reconnus du user courant (vide si pas de
/// session valide).
final currentRolesProvider = Provider<Set<UserRole>>((ref) {
  return ref.watch(appUserProvider)?.knownRoles ?? const <UserRole>{};
});

/// `true` si le user courant est coach.
final isCoachProvider = Provider<bool>((ref) {
  return ref.watch(currentRolesProvider).contains(UserRole.coach);
});

/// `true` si le user courant est officiel.
final isOfficialProvider = Provider<bool>((ref) {
  return ref.watch(currentRolesProvider).contains(UserRole.official);
});
