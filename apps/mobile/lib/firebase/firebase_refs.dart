import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../core/constants.dart';

/// Accès typé et centralisé aux singletons Firebase.
///
/// SEULES les couches `firebase/` et `repositories/` importent ce fichier —
/// les widgets / providers passent par les repositories (cf. CLAUDE.md).
class FirebaseRefs {
  const FirebaseRefs._();

  static FirebaseAuth get auth => FirebaseAuth.instance;

  static FirebaseFirestore get firestore => FirebaseFirestore.instance;

  static FirebaseMessaging get messaging => FirebaseMessaging.instance;

  /// Les Cloud Functions du projet sont déployées en `europe-west6` (Zurich).
  static FirebaseFunctions get functions =>
      FirebaseFunctions.instanceFor(region: kFunctionsRegion);

  // --- Collections racine -------------------------------------------------

  static CollectionReference<Map<String, dynamic>> get users =>
      firestore.collection(FsCollections.users);

  static CollectionReference<Map<String, dynamic>> get members =>
      firestore.collection(FsCollections.members);

  static CollectionReference<Map<String, dynamic>> get teams =>
      firestore.collection(FsCollections.teams);

  static CollectionReference<Map<String, dynamic>> get categories =>
      firestore.collection(FsCollections.categories);

  static CollectionReference<Map<String, dynamic>> get matches =>
      firestore.collection(FsCollections.matches);

  static CollectionReference<Map<String, dynamic>> get matchTypes =>
      firestore.collection(FsCollections.matchTypes);

  static CollectionReference<Map<String, dynamic>> get bookings =>
      firestore.collection(FsCollections.bookings);

  static CollectionReference<Map<String, dynamic>> get notifications =>
      firestore.collection(FsCollections.notifications);

  static CollectionReference<Map<String, dynamic>> get matchRequests =>
      firestore.collection(FsCollections.matchRequests);

  static CollectionReference<Map<String, dynamic>> get licenseRequests =>
      firestore.collection(FsCollections.licenseRequests);

  static CollectionReference<Map<String, dynamic>> get registrations =>
      firestore.collection(FsCollections.registrations);

  // --- Documents / sous-collections --------------------------------------

  static DocumentReference<Map<String, dynamic>> userDoc(String uid) =>
      users.doc(uid);

  static DocumentReference<Map<String, dynamic>> clubConfigDoc() =>
      firestore.collection(FsCollections.config).doc(FsDocs.clubConfig);

  static CollectionReference<Map<String, dynamic>> fcmTokens(String uid) =>
      userDoc(uid).collection(FsCollections.fcmTokens);

  static DocumentReference<Map<String, dynamic>> memberContactDoc(
    String memberId,
  ) =>
      members.doc(memberId).collection(FsCollections.private).doc(
            FsDocs.memberContact,
          );

  /// `collectionGroup` sur les assignations d'officiels — couvre les
  /// sous-collections `officialAssignments` des bookings ET des matches.
  static Query<Map<String, dynamic>> officialAssignmentsGroup() =>
      firestore.collectionGroup(FsCollections.officialAssignments);
}
