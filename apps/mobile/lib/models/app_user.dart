import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/firestore_converters.dart';
import 'enums.dart';

/// Adresse postale d'un user (`/users.address`).
class UserAddress {
  const UserAddress({
    required this.street,
    required this.zip,
    required this.city,
    required this.country,
  });

  final String street;
  final String zip;
  final String city;

  /// ISO 3166-1 alpha-2.
  final String country;

  factory UserAddress.fromMap(Map<String, dynamic> map) => UserAddress(
        street: FsConvert.str(map['street']),
        zip: FsConvert.str(map['zip']),
        city: FsConvert.str(map['city']),
        country: FsConvert.str(map['country']),
      );
}

/// Document `/users/{uid}` — mirror du compte Firebase Auth.
///
/// Modélise un compte applicatif **valide** (le doc Firestore existe). Un
/// compte signé-in sans doc `/users/{uid}` est traité comme « orphelin » et
/// ne produit jamais d'[AppUser] (cf. `user_repository.dart`).
class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.displayName,
    required this.photoURL,
    required this.roles,
    required this.memberId,
    required this.teamIds,
    required this.phone,
    required this.address,
    required this.profileCompletedAt,
    required this.createdAt,
  });

  /// uid Auth (= ID du document).
  final String id;
  final String email;
  final String displayName;
  final String photoURL;

  /// Rôles applicatifs additifs. Conserve les valeurs wire brutes pour
  /// tolérer les rôles custom non couverts par [UserRole].
  final List<String> roles;

  /// Lien vers `/members/{id}` si le user est un membre du club.
  final String? memberId;

  /// Scope coach — IDs des équipes coachées.
  final List<String> teamIds;

  final String? phone;
  final UserAddress? address;
  final DateTime? profileCompletedAt;
  final DateTime createdAt;

  // --- Helpers de rôle ----------------------------------------------------

  /// `true` si le user porte le rôle [role].
  bool hasRole(UserRole role) => roles.contains(role.wire);

  /// `true` si coach.
  bool get isCoach => hasRole(UserRole.coach);

  /// `true` si official.
  bool get isOfficial => hasRole(UserRole.official);

  /// `true` si admin.
  bool get isAdmin => hasRole(UserRole.admin);

  /// `true` si le user cumule coach ET official (-> 3 onglets dans le shell).
  bool get hasBothRoles => isCoach && isOfficial;

  /// Ensemble des rôles applicatifs reconnus (rôles custom exclus).
  Set<UserRole> get knownRoles {
    final result = <UserRole>{};
    for (final raw in roles) {
      final parsed = UserRole.fromWire(raw);
      if (parsed != null) result.add(parsed);
    }
    return result;
  }

  // --- Désérialisation ----------------------------------------------------

  factory AppUser.fromMap(String id, Map<String, dynamic> map) => AppUser(
        id: id,
        email: FsConvert.str(map['email']),
        displayName: FsConvert.str(map['displayName']),
        photoURL: FsConvert.str(map['photoURL']),
        roles: FsConvert.stringList(map['roles']),
        memberId: FsConvert.strOrNull(map['memberId']),
        teamIds: FsConvert.stringList(map['teamIds']),
        phone: FsConvert.strOrNull(map['phone']),
        address: () {
          final raw = FsConvert.mapOrNull(map['address']);
          return raw == null ? null : UserAddress.fromMap(raw);
        }(),
        profileCompletedAt: FsConvert.toDateTime(map['profileCompletedAt']),
        createdAt: FsConvert.toDateTimeOr(map['createdAt']),
      );

  factory AppUser.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) =>
      AppUser.fromMap(snapshot.id, FsConvert.requireData(snapshot));

  AppUser copyWith({
    String? email,
    String? displayName,
    String? photoURL,
    List<String>? roles,
    String? memberId,
    List<String>? teamIds,
    String? phone,
    UserAddress? address,
    DateTime? profileCompletedAt,
    DateTime? createdAt,
  }) =>
      AppUser(
        id: id,
        email: email ?? this.email,
        displayName: displayName ?? this.displayName,
        photoURL: photoURL ?? this.photoURL,
        roles: roles ?? this.roles,
        memberId: memberId ?? this.memberId,
        teamIds: teamIds ?? this.teamIds,
        phone: phone ?? this.phone,
        address: address ?? this.address,
        profileCompletedAt: profileCompletedAt ?? this.profileCompletedAt,
        createdAt: createdAt ?? this.createdAt,
      );
}
