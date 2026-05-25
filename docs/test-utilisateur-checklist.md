# Checklist de tests utilisateurs — court-base

> Document destiné à des testeurs non-techniques. Chaque action est une case à cocher : on la fait, on observe le résultat, on coche si tout est conforme, on note l'écart sinon.

## Comment utiliser ce document

1. **Lis d'abord les pré-requis** de chaque section : ils listent les comptes et données nécessaires.
2. **Va dans l'ordre** des sections — certaines (workflow licence, comptabilité) dépendent de l'état créé par les précédentes (inscription, paiement…).
3. **Une case = une action ou une vérification.** Si tu ne sais pas où cliquer, demande — c'est probablement que le libellé du bouton a changé.
4. **Quand quelque chose ne marche pas comme décrit**, note précisément :
   - Le numéro de l'item (ex. `B.3 — bullet 4`)
   - L'URL / écran où tu étais
   - Le rôle / compte utilisé
   - Une capture d'écran si possible (Cmd+Shift+4 sur Mac, captures natives sur smartphone)
   - Le comportement attendu vs observé

## Périmètre des 3 apps

- **`apps/web`** — Console admin desktop (Vue). Utilisée par : rootAdmin, admin, trésorier, secrétaire. C'est l'app "centre de contrôle" du club.
- **`apps/courtbase-register`** — App parents (Vue). Utilisée par : parents pour inscrire leurs enfants, gérer leur compte, compléter les dossiers de licence, payer.
- **`apps/courtbase-app`** — PWA companion mobile-first (Vue + PrimeVue). Utilisée par : coachs, officiels, et admins en déplacement. **À installer sur smartphone** (ajout à l'écran d'accueil).

## Légende des rôles

Les rôles sont **cumulables** (un même user peut être coach + officiel + trésorier). Le test des permissions est crucial — beaucoup d'items vérifient "tel rôle ne doit PAS pouvoir faire X".

- **rootAdmin** : super-administrateur, peut tout faire
- **admin** : administration du club (membres, équipes, inscriptions…)
- **treasurer** (trésorier) : compta + paiements partiels + workflow licence final
- **secretary** : lecture étendue, peu de droits d'écriture
- **coach** : ses équipes uniquement
- **official** : opérations officielles (assignations, remplacements)
- **parent** : créé via OAuth depuis `apps/courtbase-register`

---

## Onboarding & Authentification

### Pré-requis
- Un compte **rootAdmin** déjà actif sur l'env de test (`court-base-44878`)
- 3 adresses email Google de test disponibles (idéalement non encore utilisées sur le club), par exemple :
  - `testeur.admin@gmail.com` (sera invité comme admin)
  - `testeur.coach@gmail.com` (sera invité comme coach + official)
  - `testeur.parent@gmail.com` (créera un compte parent depuis register)
- Accès aux 3 apps :
  - `apps/web` (admin desktop)
  - `apps/courtbase-register` (parents)
  - `apps/courtbase-app` (PWA mobile, à ouvrir idéalement sur smartphone ou en mode responsive)
- Au moins une équipe existante avec un membre lié à un parent (pour les tests de la page /account)

---

### 1. Invitation d'un administrateur (apps/web)

- [ ] Connecte-toi à **apps/web** avec le compte rootAdmin
- [ ] Va dans **Paramètres → Invitations** (ou **Settings → Invitations**)
- [ ] Clique sur **"Inviter une personne"** (ou bouton équivalent "+ Nouvelle invitation")
- [ ] Saisis l'email `testeur.admin@gmail.com` et coche le rôle **Administrateur**
- [ ] Valide l'envoi
- [ ] Vérification : un toast/confirmation indique que l'invitation a été créée
- [ ] Vérification : la nouvelle invitation apparaît dans la liste avec statut **"En attente"**, l'email et le rôle "Administrateur"
- [ ] Récupère le lien d'invitation (copie depuis l'UI, ou ouvre l'email reçu)
- [ ] Ouvre le lien dans une **fenêtre privée** (pour ne pas conflicter avec ta session rootAdmin)
- [ ] Clique sur **"Se connecter avec Google"** et utilise `testeur.admin@gmail.com`
- [ ] Vérification attendue : tu es redirigé vers le dashboard admin, le bandeau/profil affiche bien le nom du nouveau compte
- [ ] Vérification : le rôle **Administrateur** est visible dans le profil ou dans la liste **Paramètres → Utilisateurs**
- [ ] Vérification : l'invitation correspondante passe au statut **"Acceptée"** dans la liste des invitations

### 2. Invitation d'un coach (apps/web)

- [ ] Toujours connecté en rootAdmin, retourne dans **Paramètres → Invitations**
- [ ] Crée une nouvelle invitation pour `testeur.coach@gmail.com` avec uniquement le rôle **Coach**
- [ ] Valide l'envoi
- [ ] Vérification : l'invitation apparaît avec le bon rôle
- [ ] Ouvre le lien d'invitation dans une fenêtre privée
- [ ] Connecte-toi avec Google (`testeur.coach@gmail.com`)
- [ ] Vérification : tu accèdes à l'app sans erreur
- [ ] Vérification dans **Paramètres → Utilisateurs** (depuis le compte rootAdmin) : `testeur.coach@gmail.com` apparaît avec le rôle Coach uniquement (pas Admin)

### 3. Invitation multi-rôles (cumul coach + officiel)

- [ ] Depuis rootAdmin, va dans **Paramètres → Utilisateurs**
- [ ] Trouve `testeur.coach@gmail.com` et ouvre son profil
- [ ] Ajoute le rôle **Officiel** (en plus de Coach)
- [ ] Sauvegarde
- [ ] Vérification : le profil affiche maintenant **Coach + Officiel**
- [ ] Edge case : tente d'ajouter un rôle déjà attribué (re-coche Coach) → l'UI doit l'ignorer ou afficher l'état inchangé, sans doublon ni erreur

### 4. Invitation d'un trésorier et d'un secrétaire

- [ ] Depuis rootAdmin, crée une invitation pour une 3e adresse email avec le rôle **Trésorier**
- [ ] Vérification : invitation créée, rôle correct dans la liste
- [ ] (Optionnel) Crée une autre invitation avec le rôle **Secrétaire**
- [ ] Vérification : les rôles s'affichent distinctement dans la liste des utilisateurs après acceptation

### 5. Edge cases sur l'invitation (apps/web)

- [ ] Tente d'inviter avec un email mal formé (`pasun.email`, `toto@`, vide)
  - Vérification : l'UI bloque l'envoi et affiche un message d'erreur clair
- [ ] Tente d'inviter une adresse **déjà invitée** (re-saisis `testeur.admin@gmail.com`)
  - Vérification attendue : soit l'UI bloque avec un message "déjà invité", soit l'invitation existante est réutilisée (pas de doublon dans la liste)
- [ ] Tente d'inviter une adresse correspondant à un **utilisateur déjà actif** du club
  - Vérification : message d'erreur explicite "cet utilisateur existe déjà"
- [ ] Crée une invitation sans cocher de rôle
  - Vérification : l'envoi est bloqué, message "au moins un rôle requis"
- [ ] Crée une invitation avec **plusieurs rôles cochés** d'un coup (ex. Coach + Officiel + Secrétaire)
  - Vérification : à l'acceptation, tous les rôles sont bien présents sur le user

### 6. Comportement deny-orphan (apps/web)

- [ ] Ouvre **apps/web** dans une fenêtre privée
- [ ] Clique sur "Se connecter avec Google" et utilise une adresse **qui n'a jamais été invitée** (ex. ton email perso non encore enrôlé)
- [ ] Vérification attendue : l'app affiche une erreur claire ("Aucun compte trouvé", "Contactez l'administrateur" ou équivalent)
- [ ] Vérification : tu es automatiquement déconnecté (pas de session active "fantôme") — un re-rafraîchissement doit te ramener à la page de login
- [ ] Vérification : tu n'as accès à **aucune** donnée du club (pas de dashboard, pas de liste de membres)

### 7. Invitation expirée

- [ ] Depuis rootAdmin, crée une invitation pour une 4e adresse de test
- [ ] Note le lien d'invitation
- [ ] Demande à un administrateur (ou via rootAdmin) de **révoquer** ou **supprimer** l'invitation depuis la liste
- [ ] Ouvre le lien dans une fenêtre privée et tente de te connecter
- [ ] Vérification : un message d'erreur explicite indique que l'invitation est invalide / expirée / révoquée
- [ ] Vérification : aucun compte n'est créé, pas d'accès à l'app
- [ ] (Si possible) Refais le test avec une invitation **acceptée précédemment** : le même lien ré-utilisé doit aussi refuser l'accès

### 8. Sign-up parent depuis l'accueil register (apps/courtbase-register)

- [ ] Ouvre **apps/courtbase-register** dans une fenêtre privée
- [ ] Sur la page d'accueil, repère le bouton **"Se connecter / Créer un compte"** (ou équivalent "Sign in with Google")
- [ ] Clique et utilise `testeur.parent@gmail.com` (compte Google **jamais utilisé** sur ce club)
- [ ] Vérification : tu es redirigé vers la page d'accueil parent, connecté
- [ ] Vérification : ton prénom/nom Google apparaît dans le header ou le menu
- [ ] Va sur la page **/account** (Mon compte)
- [ ] Vérification : la page s'affiche sans erreur
- [ ] Vérification : la section **"Mes enfants"** (ou "Membres liés") est **vide** avec un message du type "Aucun enfant inscrit pour le moment"
- [ ] Vérification : aucune facture / aucune cotisation n'apparaît

### 9. Édition du profil parent (apps/courtbase-register)

- [ ] Connecté en tant que `testeur.parent@gmail.com`, va sur **/account**
- [ ] Modifie ton **prénom** (ex. ajoute " Test" à la fin)
- [ ] Modifie ton **nom**
- [ ] Modifie ton **numéro de téléphone** (format valide, ex. `+41 79 123 45 67`)
- [ ] Sauvegarde
- [ ] Vérification : un toast/confirmation indique la sauvegarde
- [ ] Rafraîchis la page (F5) → les nouvelles valeurs sont bien persistées
- [ ] Edge case : saisis un téléphone clairement invalide (`abc`, vide, caractères spéciaux)
  - Vérification : l'UI bloque ou affiche un message d'erreur
- [ ] Edge case : vide le prénom **et** le nom puis sauvegarde
  - Vérification : l'UI demande au moins un champ requis

### 10. Visualisation et édition d'un enfant lié (apps/courtbase-register)

> Pré-requis : un enfant doit avoir été inscrit et lié à ce compte parent (à faire via un wizard d'inscription préalable, ou demande à rootAdmin de lier manuellement un membre existant).

- [ ] Va sur **/account**
- [ ] Vérification : la section "Mes enfants" affiche au moins une carte enfant avec son prénom, nom, équipe (si assignée)
- [ ] Clique sur l'enfant pour ouvrir le détail / l'édition du contact privé
- [ ] Modifie une donnée **autorisée parent** : adresse, téléphone privé de l'enfant, contact d'urgence
- [ ] Sauvegarde
- [ ] Vérification : la modification est persistée après rafraîchissement
- [ ] Vérification attendue : tu ne dois **PAS** pouvoir modifier des données métier (cotisation, licence, équipe) — ces champs doivent être **en lecture seule** ou absents

### 11. Délier un enfant (apps/courtbase-register)

- [ ] Toujours sur **/account**, sur la carte d'un enfant lié, cherche l'action **"Délier"** (ou "Retirer cet enfant de mon compte")
- [ ] Clique → un dialog de confirmation doit apparaître
- [ ] Annule une première fois → vérification : l'enfant est toujours lié
- [ ] Relance et confirme cette fois
- [ ] Vérification : l'enfant disparaît de la liste
- [ ] Rafraîchis la page → la dissociation est persistante
- [ ] Vérification croisée (depuis apps/web en rootAdmin) : sur la fiche membre de l'enfant, le tuteur `testeur.parent@gmail.com` n'apparaît plus dans la liste des tuteurs

### 12. Suppression du compte parent (apps/courtbase-register)

- [ ] Sur **/account**, descends jusqu'à la section "Zone dangereuse" ou "Supprimer mon compte"
- [ ] Clique sur **"Supprimer mon compte"**
- [ ] Vérification : un dialog **type-to-confirm** apparaît, te demandant de taper un mot précis (ex. "SUPPRIMER" ou ton email)
- [ ] Tape un mot **incorrect** → le bouton de confirmation doit rester désactivé
- [ ] Tape le mot **exact** demandé → le bouton s'active
- [ ] Confirme la suppression
- [ ] Vérification : tu es automatiquement déconnecté et redirigé vers la page d'accueil
- [ ] Tente de te reconnecter avec `testeur.parent@gmail.com` via Google OAuth
- [ ] Vérification attendue : soit la page /account est de nouveau vide (compte recréé "neuf"), soit un message indique qu'aucun compte n'existe — confirme avec rootAdmin que les anciennes données parent ont bien été supprimées
- [ ] Edge case : avant suppression, le compte parent avait-il des enfants liés ? Vérifie depuis apps/web qu'aucun membre n'est resté "orphelin" sans tuteur de manière incohérente

### 13. Première connexion coach dans la PWA (apps/courtbase-app)

- [ ] Ouvre **apps/courtbase-app** sur smartphone (ou en mode mobile responsive du navigateur)
- [ ] Sur la page de login, clique sur **"Se connecter avec Google"**
- [ ] Utilise `testeur.coach@gmail.com` (coach + officiel cumulés depuis l'étape 3)
- [ ] Vérification : tu arrives sur la **Home** sans erreur
- [ ] Vérification : la home affiche la section **Coach** (équipes, prochains matchs, etc.)
- [ ] Vérification : la home affiche **aussi** la section **Officiel** (assignations, opportunités) car les deux rôles sont cumulés
- [ ] Vérification : la barre de navigation/onglets reflète bien les deux rôles

### 14. Coach sans licence active (apps/courtbase-app)

> Pré-requis : depuis apps/web en rootAdmin, vérifie que `testeur.coach@gmail.com` a bien le rôle Officiel mais **pas de licence officielle active** (ou bien retire-la temporairement).

- [ ] Reconnecte-toi dans **apps/courtbase-app** avec `testeur.coach@gmail.com`
- [ ] Vérification attendue : la section Coach est toujours visible (rôle suffit)
- [ ] Vérification : la section Officiel reste visible (le rôle suffit aussi côté UI), mais les **fonctionnalités d'assignation match** doivent indiquer un état "licence requise" ou être limitées
- [ ] Demande à rootAdmin de **réactiver une licence officielle** sur ce compte
- [ ] Rafraîchis l'app → vérification : les écrans Officiel sont maintenant pleinement fonctionnels

### 15. Première connexion d'un nouvel officiel pur (apps/courtbase-app)

- [ ] Depuis rootAdmin (apps/web), invite une nouvelle adresse email avec **uniquement** le rôle Officiel
- [ ] Accepte l'invitation dans une fenêtre privée
- [ ] Ouvre **apps/courtbase-app** et connecte-toi avec ce compte
- [ ] Vérification : la home affiche **uniquement** la section Officiel (pas de section Coach, pas de section Admin)
- [ ] Vérification : aucun écran d'équipe / de coaching n'est accessible via la navigation

### 16. Première connexion admin dans la PWA (apps/courtbase-app)

- [ ] Connecte-toi dans **apps/courtbase-app** avec `testeur.admin@gmail.com`
- [ ] Vérification : la home affiche la section **Admin** (raccourcis vers gestion club)
- [ ] Vérification : l'admin n'a **pas** automatiquement de section Coach/Officiel (sauf si rôles ajoutés explicitement)

### 17. Cohérence multi-app après changement de rôles

- [ ] Depuis rootAdmin (apps/web), ajoute le rôle **Trésorier** à `testeur.admin@gmail.com`
- [ ] Demande à `testeur.admin@gmail.com` de se déconnecter / reconnecter sur apps/web
- [ ] Vérification : les écrans de comptabilité / trésorerie sont maintenant accessibles
- [ ] Retire le rôle Trésorier depuis rootAdmin
- [ ] Vérification après reconnexion : les écrans de trésorerie ne sont plus accessibles, sans erreur "crash"

---

## Référentiels admin (apps/web)

### Pré-requis
- Compte admin ou rootAdmin connecté à `apps/web` (desktop, Chrome ou Firefox récent).
- Projet Firebase du club déjà initialisé (au moins un membre admin présent).
- Avoir sous la main : un fichier image PNG < 2 Mo, un fichier JPG > 2 Mo, un fichier PDF (pour test refus), un faux numéro AVS valide format `756.XXXX.XXXX.XX`, une date de naissance d'un mineur (< 18 ans) et d'un majeur.
- Avoir un deuxième compte de test (coach) déjà créé pour vérifier les propagations de rôle.
- Avoir un accès à la PWA companion (`courtbase-app`) sur un téléphone ou en mode responsive du navigateur pour vérifier les propagations côté coach.

---

### 1. Club info (Settings → Club info)

#### 1.1 Premier accès (projet vierge ou existant)
- [ ] Va dans le menu `Settings` puis ouvre l'onglet `Club info`.
- [ ] Vérifie que le formulaire s'affiche sans erreur même si aucun club n'a encore été configuré (champs vides ou valeurs par défaut).
- [ ] Vérifie qu'aucun message d'erreur `No document to update` n'apparaît dans l'interface.

#### 1.2 Édition des informations textuelles
- [ ] Remplis le nom du club (ex: `BBC Test`).
- [ ] Remplis l'adresse complète (rue, NPA, ville).
- [ ] Remplis un IBAN valide (format suisse `CH00 0000 0000 0000 0000 0`).
- [ ] Remplis les infos compta (nom du trésorier, email contact).
- [ ] Clique sur `Enregistrer` (ou équivalent).
- [ ] Vérifie qu'un toast de succès apparaît.
- [ ] Rafraîchis la page (F5) et vérifie que toutes les valeurs sont bien persistées.

#### 1.3 Validation IBAN mal formé
- [ ] Saisis un IBAN invalide (ex: `1234`).
- [ ] Tente d'enregistrer.
- [ ] Vérifie qu'un message d'erreur de validation s'affiche OU que la sauvegarde est refusée.

#### 1.4 Upload du logo — formats et tailles
- [ ] Upload un logo PNG < 1 Mo : vérifie qu'il s'affiche en preview puis dans le header de l'app après save.
- [ ] Upload un logo JPG d'environ 500 Ko : vérifie qu'il remplace le précédent.
- [ ] Upload un fichier JPG > 2 Mo : vérifie le comportement (refus avec message clair OU upload accepté avec compression).
- [ ] Upload un fichier PDF : vérifie que l'app refuse le fichier avec un message d'erreur explicite.
- [ ] Upload un fichier image très petit (ex: 50x50 px) : vérifie qu'il s'affiche correctement ou qu'un avertissement de dimension apparaît.
- [ ] Après upload réussi, vérifie que le logo apparaît dans la sidebar de l'app web.
- [ ] Vérifie que le logo apparaît également dans la PWA `courtbase-app` (côté coach/officiel).

#### 1.5 Remplacement et suppression du logo
- [ ] Upload un nouveau logo et vérifie que l'ancien est bien remplacé visuellement.
- [ ] Si une action `Supprimer le logo` existe, clique dessus et vérifie qu'on revient à un placeholder ou logo par défaut.

---

### 2. Catégories (Settings → Catégories)

#### 2.1 Création
- [ ] Ouvre `Settings` → `Catégories`.
- [ ] Clique sur `+ Nouvelle catégorie`.
- [ ] Crée une catégorie `U13 mixte`, enregistre.
- [ ] Vérifie qu'elle apparaît dans la liste.
- [ ] Crée une seconde catégorie `U15 filles`.
- [ ] Crée une troisième catégorie `Seniors hommes`.

#### 2.2 Doublons et validations
- [ ] Tente de créer une catégorie avec le même nom qu'une existante (ex: `U13 mixte` à nouveau).
- [ ] Vérifie qu'un message d'erreur ou avertissement apparaît OU que la doublure est créée (note le comportement).
- [ ] Tente de créer une catégorie avec un nom vide : vérifie le refus.

#### 2.3 Renommage
- [ ] Renomme `U13 mixte` en `U13 mixte 2026`.
- [ ] Vérifie que le nouveau nom apparaît immédiatement dans la liste.
- [ ] Va dans le module `Équipes` et vérifie que les équipes utilisant cette catégorie affichent bien le nouveau nom.

#### 2.4 Suppression simple
- [ ] Supprime la catégorie `Seniors hommes` (non utilisée).
- [ ] Vérifie qu'un dialog de confirmation apparaît.
- [ ] Confirme et vérifie que la catégorie disparaît.

#### 2.5 Suppression bloquée (référence existante)
- [ ] Crée une équipe rattachée à `U15 filles` (voir section 4).
- [ ] Reviens dans `Settings` → `Catégories` et tente de supprimer `U15 filles`.
- [ ] Vérifie que la suppression est bloquée avec un message clair (ex: `Cette catégorie est utilisée par X équipe(s)`).
- [ ] Supprime l'équipe puis retente la suppression : vérifie qu'elle réussit.

---

### 3. Types de licence (Settings → Types de licence)

#### 3.1 Création — joueur
- [ ] Ouvre `Settings` → `Types de licence`.
- [ ] Clique sur `+ Nouveau type`.
- [ ] Crée `Joueur senior` : prix 250 CHF, fédération `Swiss Basketball`.
- [ ] Vérifie qu'il apparaît dans la liste avec le prix correct formaté.

#### 3.2 Création — coach avec niveau
- [ ] Crée un type `Coach J+S 1` : prix 50 CHF, niveau coach = 1.
- [ ] Vérifie que le niveau coach apparaît dans la fiche du type.

#### 3.3 Création — officiel avec niveau
- [ ] Crée un type `Officiel level 2` : prix 0 CHF, niveau officiel = 2.
- [ ] Vérifie que le niveau officiel est bien enregistré.

#### 3.4 Validations
- [ ] Tente de créer un type sans nom : vérifie le refus.
- [ ] Tente de saisir un prix négatif : vérifie le refus ou la conversion en 0.
- [ ] Tente de saisir un prix avec lettres : vérifie le rejet.
- [ ] Crée deux types avec le même nom : note le comportement (refus ou autorisé).

#### 3.5 Édition
- [ ] Édite le type `Joueur senior`, passe le prix à 280 CHF.
- [ ] Enregistre et vérifie l'affichage.
- [ ] Édite le niveau d'un coach (passe niveau 1 → niveau 2) et vérifie la persistance.

#### 3.6 Suppression
- [ ] Supprime un type non utilisé : confirme et vérifie qu'il disparaît.
- [ ] Crée une licence ou demande de licence rattachée à un type (via parcours coach/parent), puis tente de supprimer ce type : vérifie que la suppression est refusée ou avertie.

---

### 4. Équipes

#### 4.1 Création
- [ ] Va dans le menu `Équipes`.
- [ ] Clique sur `+ Nouvelle équipe`.
- [ ] Saisis le nom `U13M-1`.
- [ ] Sélectionne la catégorie `U13 mixte 2026` via le Select.
- [ ] Vérifie que seules les catégories existantes apparaissent dans le Select.
- [ ] Enregistre et vérifie l'apparition dans la liste.

#### 4.2 Assignation de coaches
- [ ] Ouvre la fiche de l'équipe `U13M-1`.
- [ ] Assigne un premier coach via le champ dédié.
- [ ] Vérifie qu'il apparaît dans la liste des coaches de l'équipe.
- [ ] Assigne un second coach.
- [ ] Vérifie que les deux coaches sont listés.
- [ ] Retire un coach et vérifie qu'il disparaît immédiatement.

#### 4.3 Propagation côté PWA coach
- [ ] Avec le compte coach assigné, ouvre `courtbase-app` (PWA).
- [ ] Vérifie que l'équipe `U13M-1` apparaît dans son périmètre.
- [ ] Vérifie qu'il peut accéder aux membres/inscriptions de l'équipe.
- [ ] Retire l'assignation côté admin et vérifie côté coach qu'il ne voit plus l'équipe après reconnexion.

#### 4.4 Suppression d'une équipe vide
- [ ] Crée une équipe `Test-Delete` sans membre.
- [ ] Supprime-la : confirme et vérifie sa disparition.

#### 4.5 Suppression d'une équipe avec membres
- [ ] Crée une équipe `Test-WithMembers` et rattache au moins un membre via inscription.
- [ ] Tente de supprimer l'équipe.
- [ ] Vérifie le comportement (refus avec message, ou suppression avec avertissement clair).
- [ ] Note précisément le message affiché.

#### 4.6 Drawer Basketplan — liaison cascade
- [ ] Ouvre la fiche d'une équipe et clique sur `Lier à Basketplan` (drawer latéral).
- [ ] Étape 1 : sélectionne une fédération (ex: `Swiss Basketball`).
- [ ] Étape 2 : sélectionne une saison (ex: `2025-2026`).
- [ ] Étape 3 : sélectionne une ligue (ex: `Championnat U13`).
- [ ] Étape 4 : sélectionne le team Basketplan correspondant.
- [ ] Valide et vérifie qu'un badge ou indicateur de liaison apparaît sur la fiche équipe.
- [ ] Vérifie qu'on peut ajouter un deuxième lien (autre fédération / coupe).
- [ ] Vérifie qu'on peut délier une liaison existante.
- [ ] Tente de lier deux fois le même team : vérifie le refus.

---

### 5. Membres

#### 5.1 Création manuelle — membre majeur
- [ ] Va dans `Membres` et clique sur `+ Nouveau membre`.
- [ ] Saisis prénom `Jean`, nom `Test`.
- [ ] Saisis une AVS valide `756.1234.5678.90`.
- [ ] Saisis une date de naissance majeure (ex: `1990-01-15`).
- [ ] Saisis email et téléphone.
- [ ] Enregistre et vérifie l'apparition dans la liste.
- [ ] Vérifie qu'aucune section tuteur n'est demandée.

#### 5.2 Création manuelle — membre mineur
- [ ] Crée un membre `Lucas Mineur`, AVS valide, date de naissance dans les dernières 10 années (ex: `2018-06-01`).
- [ ] Vérifie qu'une section `Tuteur(s)` devient obligatoire.
- [ ] Tente d'enregistrer sans tuteur : vérifie le refus avec message clair.
- [ ] Ajoute un tuteur (prénom, nom, téléphone, email).
- [ ] Enregistre et vérifie que le tuteur est rattaché.

#### 5.3 Validation AVS
- [ ] Tente de créer un membre avec AVS mal formé (ex: `123456`) : vérifie le refus.
- [ ] Tente avec un AVS vide : vérifie le refus (AVS obligatoire).
- [ ] Tente de créer un second membre avec exactement la même AVS : vérifie que l'app détecte le doublon et propose de lier OU refuse.

#### 5.4 Validation date de naissance
- [ ] Tente une date dans le futur : vérifie le refus.
- [ ] Tente une date manifestement absurde (ex: 1900) : vérifie qu'au minimum un avertissement s'affiche.

#### 5.5 Transition mineur → majeur
- [ ] Crée un membre dont la date de naissance correspond à un 18ème anniversaire dans 1 jour.
- [ ] Vérifie qu'il est considéré comme mineur (section tuteur active).
- [ ] (Si possible) Avance la date système ou crée un membre déjà majeur à 1 jour près.
- [ ] Vérifie qu'à la bascule de la date, le membre passe en majeur (section tuteur devient optionnelle / archivée, accès propre éventuel).

#### 5.6 Liaison à un compte user (LinkUserDialog)
- [ ] Ouvre la fiche d'un membre non lié.
- [ ] Clique sur `Lier à un compte` (ou équivalent).
- [ ] Recherche un user existant par email.
- [ ] Sélectionne-le et confirme la liaison.
- [ ] Vérifie qu'un badge `Compte lié` apparaît sur le membre.
- [ ] Vérifie qu'on ne peut pas lier le même user à deux membres différents (refus avec message).
- [ ] Délie le user via la fiche : vérifie que le badge disparaît.

#### 5.7 Désactivation / réactivation
- [ ] Sur la fiche d'un membre lié à un user, désactive le membre (`active: false`).
- [ ] Avec le compte du user lié, ouvre la PWA `courtbase-app` et vérifie qu'il n'accède plus au contenu (page d'erreur ou redirection).
- [ ] Vérifie côté admin que le membre apparaît avec un statut `inactif`.
- [ ] Tente de réinscrire le membre via le parcours d'inscription (register).
- [ ] Vérifie qu'après réinscription validée, le membre repasse en `actif` et l'accès est rétabli.

#### 5.8 Édition photo de licence
- [ ] Ouvre la fiche d'un membre et clique sur `Photo de licence`.
- [ ] Upload une photo conforme (portrait, fond clair, < 2 Mo).
- [ ] Vérifie l'aperçu et la persistance après refresh.
- [ ] Remplace la photo par une autre.
- [ ] Supprime la photo et vérifie le retour au placeholder.
- [ ] Tente d'uploader un fichier non-image : vérifie le refus.

#### 5.9 Édition infos de contact privées
- [ ] Édite l'adresse, le téléphone, l'email d'un membre majeur.
- [ ] Sauvegarde et vérifie la persistance après refresh.
- [ ] Pour un mineur : édite les infos de contact du tuteur.
- [ ] Vérifie que ces modifications sont visibles dans le détail du membre.

---

### 6. Détail membre (MemberDetail)

#### 6.1 Historique inscriptions
- [ ] Ouvre la fiche détaillée d'un membre ayant déjà été inscrit au moins une fois.
- [ ] Vérifie qu'une section `Inscriptions` liste toutes les inscriptions (saisons passées et présente).
- [ ] Vérifie que chaque ligne montre la saison, l'équipe et le statut.

#### 6.2 Licences actives
- [ ] Vérifie qu'une section `Licences` liste les licences actives du membre.
- [ ] Pour un membre avec plusieurs licences (joueur + coach), vérifie qu'elles sont toutes affichées avec leur type et statut.
- [ ] Pour un membre sans licence, vérifie qu'un message clair `Aucune licence` s'affiche.

#### 6.3 Cotisations
- [ ] Vérifie qu'une section `Cotisations` liste les dues du membre avec montant et statut (payée / impayée / partielle).
- [ ] Vérifie que la somme totale ou un récap visuel est cohérent.

#### 6.4 Gestion guardian
- [ ] Sur un membre mineur, vérifie que le ou les tuteurs sont affichés avec leurs infos.
- [ ] Ajoute un second tuteur depuis la fiche : vérifie qu'il apparaît.
- [ ] Délie un tuteur depuis la fiche : confirme et vérifie sa disparition.
- [ ] Tente de délier tous les tuteurs d'un mineur : vérifie qu'un avertissement ou refus apparaît (mineur sans tuteur = état incohérent).
- [ ] Pour un membre majeur, vérifie qu'aucune section tuteur active n'est exigée mais que l'historique éventuel reste consultable.

---

## Inscriptions & Demandes de licence (workflow complet)

### Pré-requis
- 1 compte rootAdmin (accès complet sur `apps/web`)
- 1 compte trésorier (accès `apps/web` + workflow licences)
- 1 compte coach existant, lié à au moins une équipe
- 2 comptes parent de test (parent A et parent B), chacun avec un email vérifié
- 1 équipe existante avec une catégorie + un type de licence configurés
- 1 type de cotisation (price + cible saison) configuré dans Réglages
- Infos du club renseignées dans Réglages → Club (nom, adresse, IBAN, logo)
- 3 navigateurs/onglets différents prêts pour basculer entre les apps (admin / parent / coach)
- 1 fichier PDF de test < 5 Mo et 1 photo JPG/PNG de test prêts pour les uploads de documents
- Numéros AVS de test valides (format à 13 chiffres) — préparer 4 numéros distincts

---

### A. Inscription d'un enfant (parent, sur `apps/courtbase-register`)

#### A.1 Premier enfant — totalement nouveau (mineur)
- [ ] Connecte-toi avec le compte parent A sur `apps/courtbase-register`
- [ ] Vérifie qu'aucun enfant n'apparaît dans "Mes enfants" sur la page d'accueil
- [ ] Clique sur le bouton "Inscrire un enfant"
- [ ] Vérifie que le wizard d'inscription s'ouvre avec une barre de progression visible
- [ ] **Étape Identité** : saisis le prénom, le nom, le genre de l'enfant
- [ ] **Étape AVS** : vérifie qu'il n'y a PAS de case "AVS non disponible" (AVS obligatoire)
- [ ] Tente de continuer sans saisir l'AVS → vérifie qu'un message d'erreur bloque la progression
- [ ] Saisis un AVS valide (13 chiffres)
- [ ] Tente de saisir un AVS au mauvais format (lettres, trop court) → vérifie qu'un message d'erreur s'affiche
- [ ] **Étape Date de naissance** : saisis une date qui donne un âge de moins de 18 ans
- [ ] Vérifie que le champ "Tuteur légal" apparaît automatiquement (mineur)
- [ ] Vérifie que tes infos de parent sont pré-remplies comme tuteur par défaut
- [ ] **Étape Équipe** : sélectionne une équipe proposée (filtrée par catégorie/âge)
- [ ] Vérifie que la catégorie de l'équipe est affichée
- [ ] **Étape Tarif** : vérifie que le montant de la cotisation correspond au type de cotisation configuré
- [ ] Vérifie que le tarif est calculé selon la catégorie/saison sélectionnée
- [ ] **Étape Récapitulatif** : relis toutes les informations
- [ ] Clique sur "Soumettre la demande"
- [ ] Vérifie qu'un message de confirmation s'affiche
- [ ] Reviens sur la page d'accueil parent → vérifie que l'enfant apparaît dans "Mes enfants"
- [ ] Vérifie que le statut affiché est "Demande envoyée" (ou équivalent)

#### A.2 Enfant déjà membre (match AVS strict) — réutilisation
- [ ] Reste connecté avec le parent A sur `apps/courtbase-register`
- [ ] Lance l'inscription d'un deuxième enfant
- [ ] Saisis le prénom et nom (qui peut être DIFFÉRENT du membre existant)
- [ ] Saisis un AVS qui correspond exactement à un membre déjà existant en base
- [ ] Saisis une DOB
- [ ] Sélectionne une équipe + complète le wizard
- [ ] Soumets la demande
- [ ] Bascule sur `apps/web` avec le compte rootAdmin
- [ ] Va dans Inscriptions → ouvre la nouvelle demande
- [ ] Confirme la demande
- [ ] Vérifie qu'AUCUN nouveau membre n'est créé (compte le nombre de membres avant/après)
- [ ] Vérifie que le membre existant est réutilisé (même identifiant)
- [ ] Vérifie que le membre est lié au parent A via tuteur

#### A.3 AVS déjà utilisé par un autre user (conflit guardian)
- [ ] Connecte-toi avec le parent B sur `apps/courtbase-register`
- [ ] Lance l'inscription d'un enfant
- [ ] Saisis un AVS déjà utilisé pour un enfant du parent A (cas A.1 ou A.2)
- [ ] Complète le reste du wizard et soumets
- [ ] Bascule sur `apps/web` (rootAdmin) → ouvre la demande
- [ ] Vérifie que le système signale visuellement le conflit (AVS existant chez un autre tuteur)
- [ ] Confirme l'inscription
- [ ] Vérifie que le membre existant est réutilisé (pas de doublon créé)
- [ ] Vérifie que le parent B est ajouté comme tuteur supplémentaire (sans écraser le parent A)
- [ ] Reviens sur le compte parent B → vérifie que l'enfant apparaît bien dans ses enfants
- [ ] Bascule sur le compte parent A → vérifie que l'enfant apparaît TOUJOURS chez le parent A

#### A.4 Enfant désactivé précédemment → réactivation
- [ ] Sur `apps/web` (rootAdmin) → trouve un membre marqué inactif (ou désactive-en un volontairement via la fiche membre)
- [ ] Note son AVS
- [ ] Déconnecte-toi et connecte-toi avec un parent test
- [ ] Lance le wizard d'inscription
- [ ] Saisis l'AVS du membre désactivé
- [ ] Soumets la demande
- [ ] Bascule sur `apps/web` (rootAdmin) → ouvre la demande
- [ ] Confirme l'inscription
- [ ] Vérifie que le membre est réactivé (`active=true`)
- [ ] Vérifie que l'accès aux apps club est rétabli pour ce membre
- [ ] Vérifie qu'aucun doublon n'a été créé

#### A.5 Enfant majeur (pas de tuteur affiché)
- [ ] Sur `apps/courtbase-register`, lance l'inscription d'un enfant
- [ ] Saisis une DOB qui donne un âge de 18 ans ou plus
- [ ] Vérifie que le champ "Tuteur légal" NE s'affiche PAS (ou est désactivé)
- [ ] Complète le reste et soumets
- [ ] Bascule admin → confirme
- [ ] Vérifie sur la fiche membre que c'est marqué "majeur" et qu'il n'a pas de guardianRef

#### A.6 Erreurs et validations bloquantes
- [ ] Tente de soumettre le wizard sans avoir choisi d'équipe → vérifie le blocage
- [ ] Tente de soumettre avec une DOB vide → vérifie le blocage
- [ ] Quitte le wizard en plein milieu et reviens → vérifie le comportement (perte ou conservation des données saisies)

---

### B. Côté admin (`apps/web`)

#### B.1 Voir la nouvelle inscription
- [ ] Connecte-toi avec le compte rootAdmin sur `apps/web`
- [ ] Va dans le menu Inscriptions (ou "Demandes")
- [ ] Vérifie qu'un onglet ou filtre "Demandes" / "À traiter" est visible
- [ ] Vérifie qu'une inscription récente soumise par un parent apparaît dans la file
- [ ] Vérifie que le nom de l'enfant, l'équipe demandée, le nom du parent sont visibles
- [ ] Vérifie que le statut affiché est bien "en attente" / "demande envoyée"
- [ ] Clique sur l'inscription pour ouvrir le détail
- [ ] Vérifie que toutes les infos du wizard sont reportées (AVS, DOB, équipe, tuteur)

#### B.2 Marquer en "essai" (markTrial)
- [ ] Sur la fiche d'une inscription en statut demande
- [ ] Clique sur "Marquer en essai" (ou bouton équivalent)
- [ ] Vérifie qu'un message de confirmation s'affiche
- [ ] Vérifie que le statut passe à "essai"
- [ ] Va sur la fiche de l'équipe demandée
- [ ] Vérifie qu'une réservation (booking) gratuit pour entraînement a été créée pour cet enfant
- [ ] Vérifie que ce booking n'est pas facturé (montant = 0)
- [ ] Vérifie que l'enfant apparaît dans le roster "essai" de l'équipe

#### B.3 Confirmer l'inscription (confirmRegistration)
- [ ] Sur une inscription en statut "demande" ou "essai"
- [ ] Clique sur "Confirmer l'inscription"
- [ ] Vérifie qu'un dialog récapitulatif s'affiche (membre, équipe, cotisation)
- [ ] Valide
- [ ] Vérifie qu'un message de succès s'affiche
- [ ] Vérifie que le statut de l'inscription passe à "confirmée"
- [ ] Va dans Membres → vérifie qu'un nouveau membre existe (ou que l'existant a été réutilisé)
- [ ] Vérifie que le membre est marqué actif (active=true)
- [ ] Va dans Cotisations (Dues) → vérifie qu'une nouvelle cotisation a été créée
- [ ] Vérifie que la cotisation a le bon montant (selon catégorie/saison)
- [ ] Vérifie que la cotisation a le bon membre cible et la bonne saison
- [ ] Vérifie que le statut de la cotisation est "pending" (impayée)
- [ ] Ouvre la fiche du membre → vérifie le champ `linkedUserId` (binding vers le parent ou l'enfant si majeur)
- [ ] Ouvre la fiche du user parent → vérifie le champ `memberId` (binding bidirectionnel)
- [ ] Bascule sur le compte parent → vérifie que l'enfant apparaît en statut "confirmé"

#### B.4 Refuser une inscription (avec motif)
- [ ] Soumets une nouvelle inscription depuis un compte parent test
- [ ] Bascule admin → ouvre la demande
- [ ] Clique sur "Refuser"
- [ ] Vérifie qu'un champ "Motif" obligatoire apparaît
- [ ] Tente de refuser sans motif → vérifie le blocage
- [ ] Saisis un motif (ex : "équipe complète") et valide
- [ ] Vérifie que le statut passe à "refusée"
- [ ] Vérifie qu'aucun membre n'a été créé
- [ ] Vérifie qu'aucune cotisation n'a été créée
- [ ] Bascule sur le compte parent → vérifie que la demande apparaît en "refusée" avec le motif lisible

#### B.5 Supprimer une inscription (type-to-confirm)
- [ ] Ouvre une inscription (n'importe quel statut : demande, essai, confirmée, refusée)
- [ ] Cherche l'action "Supprimer" (bouton danger)
- [ ] Vérifie qu'un dialog "type-to-confirm" demande de taper un mot précis (ex : nom de l'enfant ou "SUPPRIMER")
- [ ] Tente de valider sans taper le mot → vérifie le blocage
- [ ] Tape un mot incorrect → vérifie le blocage
- [ ] Tape le bon mot et confirme
- [ ] Vérifie que l'inscription disparaît de la liste
- [ ] Vérifie qu'un compte non-admin (coach ou parent) n'a PAS accès à ce bouton (test depuis un autre compte)
- [ ] Teste la suppression sur les 4 statuts (demande / essai / confirmée / refusée) → vérifie qu'il n'y a pas de garde-fou

---

### C. Workflow demande de licence (coach → parent → coach → trésorier)

#### C.1 Coach déclenche la demande (sur `apps/courtbase-app` PWA)
- [ ] Connecte-toi avec le compte coach sur `apps/courtbase-app`
- [ ] Va sur la vue de son équipe
- [ ] Vérifie que le membre confirmé (cas B.3) apparaît dans le roster
- [ ] Ouvre le menu kebab (3 points) sur la ligne du membre
- [ ] Clique sur "Demander une licence"
- [ ] Vérifie qu'un dialog de confirmation s'affiche
- [ ] Valide
- [ ] Vérifie qu'un message de succès s'affiche
- [ ] Vérifie que le membre apparaît maintenant dans l'onglet "Licence en cours" (ou équivalent)
- [ ] Vérifie que le statut affiché est "Docs parent attendus" (parent_docs_needed)
- [ ] Bascule sur le compte parent (apps/courtbase-register OU apps/courtbase-app si parent connecté)
- [ ] Vérifie qu'une notification in-app est apparue ("Votre enfant X a besoin de documents pour sa licence")
- [ ] Vérifie qu'un lien depuis la notif amène au formulaire de complétion

#### C.2 Parent complète les 7 sections (sur `apps/courtbase-register`)
- [ ] Connecte-toi avec le parent sur `apps/courtbase-register`
- [ ] Vérifie qu'un encart "Licence à compléter" est visible sur la fiche de l'enfant
- [ ] Clique sur "Compléter la demande de licence"
- [ ] Vérifie que le formulaire s'ouvre avec 7 sections numérotées
- [ ] **Section 1 — Identité** : vérifie le pré-remplissage avec les infos déjà connues
- [ ] **Section 2 — Photo de l'enfant** : upload une photo (JPG/PNG)
- [ ] Vérifie qu'un aperçu de la photo s'affiche après upload
- [ ] Tente d'uploader un fichier trop lourd ou mauvais format → vérifie le blocage avec message d'erreur
- [ ] **Section 3 — AVS confirmé** : vérifie que l'AVS est pré-rempli et demande confirmation
- [ ] Modifie l'AVS si possible → vérifie que la valeur est mise à jour
- [ ] **Section 4 — Joueur étranger (FIBA)** : coche "Joueur étranger" si pertinent
- [ ] Vérifie qu'un bandeau FIBA (banner d'avertissement) s'affiche avec les règles
- [ ] Vérifie que des champs additionnels apparaissent (nationalité, transfert international, etc.)
- [ ] Décoche → vérifie que le bandeau et les champs disparaissent
- [ ] **Section 5 — Documents** : upload un PDF de pièce d'identité
- [ ] Upload un PDF d'autorisation parentale
- [ ] Vérifie que chaque document a un statut "uploadé" visible
- [ ] Vérifie que tu peux supprimer/remplacer un document avant soumission
- [ ] **Section 6 — Tuteurs / contact** : vérifie le pré-remplissage du tuteur principal
- [ ] **Section 7 — Récapitulatif** : vérifie que toutes les sections sont marquées complétées
- [ ] Tente de soumettre avec une section incomplète → vérifie le blocage
- [ ] Soumets la demande complète
- [ ] Vérifie qu'un message de succès s'affiche
- [ ] Vérifie que le statut affiché passe à "Soumis — en attente de validation coach"
- [ ] Recharge la page → vérifie que les documents sont bien persistés (visibles en lecture seule)

#### C.3 Coach valide les documents (sur `apps/courtbase-app` ou `apps/web`)
- [ ] Connecte-toi avec le compte coach sur `apps/courtbase-app`
- [ ] Va sur la vue de son équipe → onglet "Licences en cours"
- [ ] Vérifie qu'un badge ou indicateur signale les demandes prêtes à valider
- [ ] Ouvre la fiche de la demande passée en `parent_docs_submitted`
- [ ] Vérifie que les 7 sections complétées par le parent sont visibles en lecture
- [ ] Ouvre chaque document uploadé (photo, PDFs) → vérifie l'aperçu/téléchargement
- [ ] **Cas Reject** : clique sur "Refuser les documents"
- [ ] Saisis un commentaire (ex : "photo floue, à refaire")
- [ ] Vérifie qu'un commentaire est obligatoire
- [ ] Valide
- [ ] Vérifie que le statut revient à `parent_docs_needed` côté admin
- [ ] Bascule sur le compte parent → vérifie qu'une notif "Documents refusés" arrive avec le commentaire
- [ ] Parent corrige et re-soumet (refaire C.2 partiellement)
- [ ] **Cas Approve** (après re-soumission) : depuis le compte coach, ouvre la demande
- [ ] Clique sur "Valider les documents"
- [ ] Vérifie qu'un dialog de confirmation s'affiche
- [ ] Valide
- [ ] Vérifie que le statut passe à `coach_validated`
- [ ] Vérifie qu'une notif est envoyée au trésorier

#### C.4 Trésorier traite — Approve strict
- [ ] Connecte-toi avec le compte trésorier sur `apps/web`
- [ ] Va dans le menu Licences (ou Demandes de licence)
- [ ] Vérifie qu'un onglet "À traiter" liste les demandes en `coach_validated`
- [ ] Ouvre une demande validée par le coach
- [ ] Vérifie que tous les docs uploadés par le parent sont visibles
- [ ] Vérifie que le commentaire coach (si présent) est lisible
- [ ] Clique sur "Approuver"
- [ ] Vérifie qu'un dialog de confirmation s'affiche
- [ ] Valide
- [ ] Vérifie que le statut passe à `approved`

#### C.5 Trésorier traite — Reject inclusif (shortcut)
- [ ] Soumets une nouvelle demande qui arrive en `parent_docs_submitted` (sans passer par coach_validated)
- [ ] Connecte-toi en trésorier sur `apps/web` → Licences
- [ ] Vérifie qu'une demande en `parent_docs_submitted` est visible pour le trésorier (reject possible, approve impossible)
- [ ] Tente d'approuver depuis `parent_docs_submitted` → vérifie que le bouton est désactivé ou bloqué (approve strict = coach_validated only)
- [ ] Clique sur "Refuser"
- [ ] Saisis un motif
- [ ] Valide
- [ ] Vérifie que la demande est refusée (statut final) sans avoir attendu la validation coach
- [ ] Refais le test depuis une demande en `coach_validated` → vérifie que le reject fonctionne aussi (inclusif)

#### C.6 Trésorier marque envoyée + payée (`sent_paid`)
- [ ] Ouvre une demande en statut `approved`
- [ ] Clique sur "Marquer envoyée + payée" (ou bouton équivalent)
- [ ] Vérifie qu'un dialog demande une confirmation (date envoi, montant payé)
- [ ] Renseigne les champs requis et valide
- [ ] Vérifie que le statut passe à `sent_paid`
- [ ] Vérifie qu'une licence apparaît dans `/licenses` pour ce membre
- [ ] Vérifie que la licence a le statut "pending" (utilisable en match malgré l'attente officielle)
- [ ] Va sur la fiche membre → vérifie que `member.licensed` reflète l'état (la licence est utilisable)
- [ ] Tente d'utiliser ce membre dans un match (depuis la page Matches admin) → vérifie qu'il est éligible

#### C.7 Cas spécial — Licence avec photo
- [ ] Reprends une demande où le parent a uploadé une photo (cf C.2 section 2)
- [ ] Connecte-toi en coach sur `apps/courtbase-app`
- [ ] Va sur la fiche du membre → vérifie que la photo apparaît dans la fiche
- [ ] Vérifie qu'un coach peut consulter la photo (gate coach)
- [ ] Va sur `apps/web` admin → fiche membre
- [ ] Vérifie que la photo est visible
- [ ] Teste l'action "Supprimer la photo" (callable remove)
- [ ] Vérifie que la photo disparaît partout (apps/web + apps/courtbase-app)
- [ ] Teste l'action "Remplacer la photo" (callable set) avec un nouveau fichier
- [ ] Vérifie que la nouvelle photo s'affiche partout

---

### D. Facture parent (`apps/courtbase-register`)

#### D.1 Affichage de la facture après confirmation
- [ ] Connecte-toi avec le parent dont l'enfant a une cotisation confirmée (cas B.3)
- [ ] Va sur la fiche de l'enfant
- [ ] Clique sur "Voir ma facture" (ou onglet Facture)
- [ ] Vérifie que la page Facture s'affiche
- [ ] Vérifie que le nom du club est affiché
- [ ] Vérifie que le logo du club est affiché
- [ ] Vérifie que l'adresse du club est affichée
- [ ] Vérifie que l'IBAN est visible
- [ ] Vérifie que le numéro BVR (si configuré) est visible
- [ ] Vérifie que les infos de paiement (référence, libellé) sont correctes
- [ ] Vérifie que le montant à payer correspond à la cotisation créée
- [ ] Vérifie que le nom de l'enfant et la saison apparaissent sur la facture
- [ ] Vérifie que le statut "Impayée" est visible

#### D.2 Édition du montant par l'admin (updateDue)
- [ ] Bascule sur `apps/web` avec rootAdmin
- [ ] Va dans Cotisations → ouvre la cotisation du cas D.1
- [ ] Clique sur "Modifier" (ou icône édition)
- [ ] Vérifie que le dialog d'édition s'ouvre avec montant + libellé modifiables
- [ ] Change le montant (ex : passe de 400 à 350 CHF, arrangement)
- [ ] Saisis un motif (si demandé)
- [ ] Valide
- [ ] Vérifie qu'un message de succès s'affiche
- [ ] Vérifie que le nouveau montant apparaît dans la liste des dues
- [ ] Bascule sur le compte parent → recharge la page Facture
- [ ] Vérifie que le montant affiché sur la facture est mis à jour (350 CHF)
- [ ] Vérifie que toutes les autres infos (IBAN, club, enfant) restent inchangées

#### D.3 Paiement partiel par le comité (rootAdmin/treasurer)
- [ ] Sur `apps/web`, ouvre la cotisation en cours
- [ ] Connecte-toi en rootAdmin ou trésorier
- [ ] Marque un paiement partiel (paidAmount < amount)
- [ ] Vérifie qu'un admin "simple" (non rootAdmin/treasurer) ne peut PAS faire cette action (test depuis un autre compte si possible)
- [ ] Vérifie que la cotisation passe en statut "partiellement payée" ou équivalent
- [ ] Bascule sur le compte parent → vérifie que la facture reflète le solde restant
- [ ] Marque le solde restant comme payé
- [ ] Vérifie que le statut passe à "Payée"
- [ ] Bascule sur le compte parent → vérifie que la facture indique "Payée"

#### D.4 Cohérence des données affichées
- [ ] Modifie le logo du club dans Réglages → Club (apps/web)
- [ ] Bascule sur le compte parent → recharge la facture
- [ ] Vérifie que le nouveau logo apparaît
- [ ] Modifie l'IBAN du club
- [ ] Vérifie que le nouvel IBAN apparaît sur la facture parent (un seul source : /config/club)

---

### E. Vérifications de bout en bout (sanity end-to-end)
- [ ] Refais un cycle complet : inscription enfant → confirm admin → demande licence coach → docs parent → validation coach → approve trésorier → sent_paid → utilisation en match
- [ ] Vérifie qu'aucun double n'a été créé en base (1 user parent, 1 member enfant, 1 due, 1 licence)
- [ ] Vérifie que toutes les notifs in-app sont arrivées au bon destinataire à chaque étape
- [ ] Vérifie que le rootAdmin peut tout faire, le trésorier les actions licence/paiement, le coach les actions équipe/validation docs, le parent les actions inscription/docs
- [ ] Vérifie qu'un coach NE peut PAS confirmer une inscription (action admin seulement)
- [ ] Vérifie qu'un parent NE peut PAS approuver/refuser des docs (actions coach/trésorier seulement)
- [ ] Vérifie qu'un parent NE peut PAS voir les infos d'enfants qui ne sont pas les siens
- [ ] Vérifie qu'un coach NE peut voir QUE les membres/inscriptions de ses équipes
- [ ] Déconnecte-toi de tous les comptes et reconnecte-toi → vérifie que les statuts/données sont persistés correctement

---

## Matchs, Officiels, Réservations & Salles

### Pré-requis
- 1 compte admin connecté sur `apps/web`
- 1 compte officiel avec un niveau configuré (1 à 4)
- 1 second compte officiel (pour tester remplacements et notifications croisées)
- 2 équipes existantes dans le club (avec catégorie et coach assignés)
- 1 entraînement récurrent posé pour au moins une équipe (pour tester l'auto-libération sur match HOME)
- 1 saison active configurée dans Settings
- Accès à `apps/courtbase-app` (PWA) installable sur smartphone pour les 2 officiels
- Identifiants Basketplan valides (pour la partie F) — fédération + saison existantes
- Au moins 1 inscription en cours d'essai (pour vérifier la réservation gratuite auto)

---

### A. Salles & Terrains (apps/web)

#### A.1 Créer une nouvelle salle (Venue)
- [ ] Aller dans le menu "Salles" sur `apps/web`
- [ ] Cliquer sur "Ajouter une salle"
- [ ] Renseigner le nom (ex. "Salle de Marly")
- [ ] Renseigner l'adresse complète (rue, code postal, ville)
- [ ] Valider et vérifier que la salle apparaît dans la liste
- [ ] Ouvrir la salle créée : vérifier que le détail s'ouvre dans la même page (vue master/detail)

#### A.2 Ajouter un terrain (Court) à une salle
- [ ] Depuis le détail d'une salle, cliquer sur "Ajouter un terrain"
- [ ] Saisir le nom du terrain (ex. "Terrain A")
- [ ] Choisir le type de terrain
- [ ] Valider et vérifier que le terrain apparaît sous la salle
- [ ] Ajouter un second terrain (ex. "Terrain B") pour pouvoir tester les combined courts

#### A.3 Créer un terrain combiné — cas Marly (2 smalls → 1 large)
- [ ] Dans une salle disposant déjà de 2 small courts, cliquer sur "Créer terrain combiné"
- [ ] Sélectionner les 2 small courts existants comme enfants
- [ ] Renseigner le nom du large court (ex. "Grand terrain Marly")
- [ ] Valider et vérifier que le large court apparaît bien dans la liste
- [ ] Vérifier que les 2 small courts sont marqués comme "enfants" du large

#### A.4 Créer un terrain combiné — cas small-combo
- [ ] Tester le cas où 2 small courts existants sont regroupés à la volée en un large lors d'une réservation
- [ ] Vérifier que la combinaison reste cohérente après validation

#### A.5 Créer un terrain combiné — cas standalone large
- [ ] Créer un terrain large sans children (cas standalone)
- [ ] Vérifier qu'il apparaît sans relation parent/enfant

#### A.6 Validation des combined courts
- [ ] Essayer de créer un combined court en sélectionnant des terrains d'une AUTRE salle : l'interface doit refuser (same-venue only)
- [ ] Essayer d'utiliser un large court comme enfant d'un autre large court : l'interface doit refuser (pas de chaîne)
- [ ] Vérifier que le message d'erreur est compréhensible

#### A.7 Renommer une salle ou un terrain
- [ ] Ouvrir le menu d'édition d'une salle, modifier son nom, valider
- [ ] Vérifier que le nouveau nom apparaît partout (calendrier, matchs, réservations)
- [ ] Faire de même pour un terrain

#### A.8 Supprimer une salle ou un terrain vide
- [ ] Supprimer un terrain qui n'a aucune réservation ni match associé : doit fonctionner
- [ ] Supprimer une salle vide (sans terrain) : doit fonctionner

#### A.9 Empêcher la suppression d'un terrain occupé
- [ ] Créer une réservation sur un terrain
- [ ] Tenter de supprimer ce terrain : l'opération doit être bloquée ou refusée
- [ ] Vérifier que le message d'erreur indique la cause (terrain utilisé)

---

### B. Réservations (apps/web)

#### B.1 Vue calendrier hebdomadaire
- [ ] Ouvrir la page "Réservations" sur `apps/web`
- [ ] Vérifier que le calendrier affiche la semaine courante par défaut
- [ ] Vérifier que les courts apparaissent en colonnes
- [ ] Basculer entre vue "1 jour" et vue "semaine entière"
- [ ] Naviguer à la semaine suivante via les flèches
- [ ] Naviguer à la semaine précédente
- [ ] Vérifier que la navigation est instantanée (pas de chargement visible — toute la saison est pré-chargée)

#### B.2 Créer une réservation one-shot manuelle
- [ ] Cliquer sur un créneau libre dans le calendrier
- [ ] Renseigner la date, l'heure de début, la durée
- [ ] Choisir le court
- [ ] Choisir le type : "entraînement", "match" ou "autre"
- [ ] (Optionnel) Lier à une équipe existante
- [ ] (Optionnel) Lier à un membre existant
- [ ] Valider et vérifier que la réservation apparaît dans le calendrier

#### B.3 Conflit de réservation existante
- [ ] Tenter de créer une réservation sur un créneau déjà occupé du même court
- [ ] Vérifier qu'une erreur claire s'affiche
- [ ] Vérifier que la réservation existante n'est pas écrasée

#### B.4 Réservation récurrente — hebdomadaire simple
- [ ] Créer une réservation récurrente "tous les lundis de 18h à 20h" sur toute la saison
- [ ] Choisir une équipe à associer
- [ ] Valider et vérifier que toutes les occurrences apparaissent dans le calendrier
- [ ] Naviguer sur plusieurs semaines pour confirmer la récurrence

#### B.5 Réservation récurrente — récurrence custom
- [ ] Créer une réservation récurrente "toutes les 2 semaines"
- [ ] Vérifier que seules les semaines paires (ou impaires) sont remplies
- [ ] Vérifier qu'il n'y a aucune occurrence sur les semaines intermédiaires

#### B.6 Modifier une occurrence vs toute la série
- [ ] Sur une série existante, cliquer sur une occurrence isolée et modifier son horaire
- [ ] Choisir "modifier cette occurrence uniquement" : vérifier que les autres ne changent pas
- [ ] Sur une autre occurrence, modifier l'horaire et choisir "modifier toute la série" : vérifier que toutes les occurrences futures changent

#### B.7 Supprimer une occurrence vs toute la série
- [ ] Supprimer une occurrence isolée d'une série : vérifier que seule cette date disparaît
- [ ] Supprimer toute la série : vérifier que toutes les occurrences futures disparaissent
- [ ] Vérifier que les occurrences passées restent ou disparaissent selon le comportement attendu

#### B.8 Conflits combined court — large → smalls
- [ ] Réserver le large court (parent) sur un créneau
- [ ] Tenter de réserver un des small courts enfants sur le même créneau
- [ ] Vérifier que l'opération est bloquée avec un message explicite

#### B.9 Conflits combined court — small → large
- [ ] Réserver un small court enfant sur un créneau
- [ ] Tenter de réserver le large court parent sur le même créneau
- [ ] Vérifier que l'opération est bloquée

#### B.10 Réservation "essai" auto-créée
- [ ] Repérer une inscription en cours d'essai
- [ ] Ouvrir le calendrier
- [ ] Vérifier que l'occurrence de l'entraînement de l'équipe concernée affiche bien la personne en essai (réservation gratuite)
- [ ] Vérifier qu'aucune cotisation n'est attendue pour ce passage

---

### C. Matchs (apps/web → page /matches)

#### C.1 Créer un match HOME
- [ ] Aller sur "Matchs" dans `apps/web`
- [ ] Cliquer sur "Créer un match"
- [ ] Choisir "à domicile" (HOME)
- [ ] Renseigner la date et l'heure
- [ ] Vérifier que la durée par défaut est de 3 heures
- [ ] Choisir un court depuis la liste des terrains du club
- [ ] Choisir l'équipe domicile (notre équipe)
- [ ] Saisir l'équipe adverse en texte libre OU la choisir depuis Basketplan
- [ ] Choisir le niveau officiel requis (1 à 4)
- [ ] Valider et vérifier que le match apparaît dans la liste et dans le calendrier

#### C.2 Créer un match AWAY
- [ ] Cliquer sur "Créer un match"
- [ ] Choisir "à l'extérieur" (AWAY)
- [ ] Renseigner la date et l'heure
- [ ] Saisir l'adresse libre (pas de sélection de court interne)
- [ ] Choisir l'équipe adverse
- [ ] Choisir notre équipe
- [ ] Valider et vérifier que le match apparaît dans la liste
- [ ] Vérifier qu'aucun court n'est occupé côté calendrier club

#### C.3 Auto-libération de l'entraînement chevauchant
- [ ] S'assurer que l'équipe a un entraînement récurrent (ex. mardi 18h-20h)
- [ ] Créer un match HOME pour cette équipe le mardi 18h
- [ ] Ouvrir le calendrier
- [ ] Vérifier que l'occurrence d'entraînement du mardi en question est auto-libérée (et non plus visible comme entraînement)
- [ ] Vérifier que les autres mardis (sans match) sont intacts

#### C.4 Pas d'édition de match en MVP
- [ ] Ouvrir le détail d'un match créé
- [ ] Vérifier qu'aucun bouton "Modifier" n'est présent ou actif (sauf annulation)
- [ ] Vérifier que le bouton "Annuler le match" est bien disponible
- [ ] Annuler un match : vérifier qu'il disparaît du calendrier (ou est marqué comme annulé)

---

### D. Officiels — Admin (apps/web → page /officials)

#### D.1 Onglet "Assignations" — voir les matchs à staffer
- [ ] Ouvrir la page "Officiels" et l'onglet "Assignations"
- [ ] Vérifier que la liste des matchs à venir s'affiche
- [ ] Vérifier que les matchs avec officiels manquants sont mis en évidence
- [ ] Vérifier que le niveau requis pour chaque match est lisible

#### D.2 Assigner un officiel à un match
- [ ] Choisir un match avec officiel manquant
- [ ] Ouvrir l'action "Assigner un officiel"
- [ ] Vérifier que la liste propose uniquement les officiels du niveau requis (ou supérieur)
- [ ] Choisir un officiel et valider
- [ ] Vérifier que l'officiel apparaît bien sur le match

#### D.3 Override admin (forcer un assign sous-niveau)
- [ ] Sur un match nécessitant un niveau 3, tenter d'assigner un officiel niveau 2
- [ ] Vérifier que l'interface demande une confirmation ("override admin")
- [ ] Confirmer et vérifier que l'assignation est posée malgré le niveau insuffisant
- [ ] Vérifier qu'un marqueur visuel signale l'override

#### D.4 Notification in-app de l'officiel assigné
- [ ] Se connecter en tant qu'officiel assigné sur `apps/courtbase-app`
- [ ] Vérifier qu'une notification in-app apparaît (badge ou cloche)
- [ ] Ouvrir la notif : elle doit pointer vers le match concerné

#### D.5 Désassigner un officiel
- [ ] Depuis l'onglet "Assignations", ouvrir un match avec officiel assigné
- [ ] Désassigner l'officiel
- [ ] Vérifier que le match retombe en "manquant"
- [ ] Vérifier que l'officiel concerné voit la mise à jour côté PWA

#### D.6 Onglet "Officiels" — métriques
- [ ] Basculer sur l'onglet "Officiels"
- [ ] Vérifier la présence des stat cards (nombre total, par niveau)
- [ ] Vérifier que les chiffres correspondent à la réalité de la base

#### D.7 Filtre par périmètre
- [ ] Tester le filtre "toute la saison"
- [ ] Tester le filtre "mois en cours"
- [ ] Vérifier que les chiffres et la liste se mettent à jour cohéremment

#### D.8 Indicateurs last-minute
- [ ] Créer un match dans les prochains jours sans officiel assigné
- [ ] Vérifier qu'un indicateur "last-minute" apparaît sur la page
- [ ] Cliquer dessus : doit ramener au match concerné

#### D.9 Export CSV
- [ ] Cliquer sur le bouton d'export CSV
- [ ] Vérifier que le téléchargement démarre
- [ ] Ouvrir le fichier : vérifier qu'il contient bien la liste des officiels avec leurs métriques

#### D.10 Visibilité complète de la liste des officiels
- [ ] Vérifier que TOUS les officiels du club apparaissent (y compris ceux dont le nom de famille n'est pas renseigné)
- [ ] Si un officiel est invisible, signaler le cas en notant son identifiant

---

### E. Officiel — côté PWA (apps/courtbase-app)

#### E.1 Inbox de matchs ouverts
- [ ] Se connecter en officiel sur `apps/courtbase-app`
- [ ] Aller sur la section "Officiel" → matchs ouverts
- [ ] Vérifier que la liste contient uniquement les matchs compatibles avec son niveau (égal ou supérieur)
- [ ] Vérifier qu'aucun match avec adversaire non confirmé (TBD) n'apparaît
- [ ] Vérifier que les matchs au passé n'apparaissent pas

#### E.2 Postuler à un match
- [ ] Ouvrir un match disponible
- [ ] Cliquer sur "Postuler"
- [ ] Vérifier que la demande est enregistrée
- [ ] Vérifier que l'admin la voit côté `apps/web` (onglet Assignations)

#### E.3 Refuser un match proposé
- [ ] Recevoir une proposition d'assignation
- [ ] Cliquer sur "Refuser"
- [ ] Vérifier que le match repasse en "manquant" côté admin

#### E.4 Acceptation d'assignation via notification
- [ ] Recevoir une notif d'assignation sur le smartphone (PWA)
- [ ] Ouvrir la notif → la vue match doit s'ouvrir
- [ ] Cliquer sur "Accepter"
- [ ] Vérifier que le match passe dans "Mes matchs acceptés"

#### E.5 Demande de remplacement
- [ ] Ouvrir un match déjà accepté
- [ ] Cliquer sur "Demander un remplacement"
- [ ] Confirmer la demande
- [ ] Vérifier que la demande apparaît dans l'inbox de remplacements des autres officiels du club

#### E.6 Acceptation d'un remplacement par un autre officiel
- [ ] Se connecter avec un second compte officiel
- [ ] Aller dans l'inbox des remplacements
- [ ] Choisir une demande et cliquer sur "Accepter le remplacement"
- [ ] Vérifier que le swap est automatique (le nouvel officiel apparaît assigné, l'ancien est désassigné)
- [ ] Vérifier que le demandeur reçoit une confirmation

#### E.7 Détection de conflit sur remplacement
- [ ] S'assurer que le second officiel a déjà un match accepté qui chevauche horairement
- [ ] Tenter d'accepter le remplacement
- [ ] Vérifier qu'un message de conflit s'affiche
- [ ] Vérifier que le swap est bloqué

---

### F. Basketplan (apps/web → Settings + Teams)

#### F.1 Mapping cascade fédération → saison → ligue → team
- [ ] Aller dans Settings → Basketplan sur `apps/web`
- [ ] Choisir une fédération dans la cascade
- [ ] Choisir la saison
- [ ] Choisir la ligue
- [ ] Vérifier que la liste des teams Basketplan disponibles apparaît bien

#### F.2 Lier une équipe court-base à une team Basketplan
- [ ] Ouvrir une équipe court-base
- [ ] Lancer le dialogue de mapping Basketplan
- [ ] Sélectionner une team Basketplan
- [ ] Valider et vérifier que le lien est enregistré

#### F.3 Lier plusieurs teams Basketplan à la même équipe (coupes + championnats)
- [ ] Sur la même équipe, ajouter un second lien Basketplan (ex. coupe régionale)
- [ ] Vérifier que les deux liens coexistent
- [ ] Vérifier qu'aucun lien existant n'est écrasé

#### F.4 Sync manuelle d'une équipe (CTA admin)
- [ ] Depuis Settings, lancer la sync Basketplan pour une équipe liée
- [ ] Attendre la fin de l'opération
- [ ] Aller sur la page "Matchs" : vérifier que les matchs AWAY sont apparus
- [ ] Vérifier que les informations (date, heure, adresse, adversaire) sont cohérentes avec Basketplan

#### F.5 Backfill historique de la saison
- [ ] Sur une équipe liée pour la première fois, lancer la sync
- [ ] Vérifier que TOUS les matchs de la saison (passés et à venir) apparaissent
- [ ] Vérifier qu'aucun doublon n'est créé si la sync est relancée

#### F.6 Cron automatique 03:00 (heure suisse)
- [ ] La veille, créer ou laisser une équipe liée à Basketplan avec sync activée
- [ ] Le lendemain matin, ouvrir la page "Matchs"
- [ ] Vérifier que les nouveaux matchs Basketplan publiés depuis la veille sont apparus
- [ ] Vérifier qu'aucune action manuelle n'a été nécessaire

#### F.7 Cohérence visuelle des matchs Basketplan
- [ ] Repérer un match issu de Basketplan dans la liste
- [ ] Vérifier qu'un marqueur visuel le distingue d'un match créé manuellement
- [ ] Ouvrir son détail : vérifier que les champs externes (référence match, ligue, etc.) sont lisibles

---

## Comptabilité, Cotisations & Factures

### Pré-requis

- 1 compte **rootAdmin** (super-administrateur du club)
- 1 compte **trésorier**
- 1 compte **secretary** (secrétaire)
- 1 compte **admin standard** (administrateur sans privilège trésorier)
- 1 compte **coach** (entraîneur)
- 1 compte **officiel** (arbitre/marqueur)
- 1 compte **parent** ayant au moins 1 enfant inscrit avec une cotisation due
- Avoir configuré dans Paramètres → Club : IBAN, BVR, nom du club, adresse
- Avoir au moins 1 inscription confirmée récente (qui a généré une due automatiquement)
- Avoir au moins 1 licence au statut "envoyée et payée" pour tester les écritures auto
- Navigateur de test avec console ouverte (F12) pour vérifier l'absence d'erreurs rouges
- Idéalement : un second navigateur (ou fenêtre privée) pour tester en parallèle deux rôles différents

---

### A. Cotisations (apps/web)

#### A.1 Rappel — création automatique
- [ ] (Rappel, déjà testé dans la section Inscription) Confirmer une inscription depuis `/registrations` et vérifier qu'une cotisation apparaît bien dans `/dues` au statut "à régler"
- [ ] Vérifier que la cotisation créée affiche le bon montant (celui défini dans la catégorie/cotisation de l'équipe)
- [ ] Vérifier que la cotisation est bien rattachée au bon membre (nom + prénom corrects)

#### A.2 Édition d'une cotisation depuis la liste `/dues`
- [ ] Se connecter en tant qu'**admin standard** sur `apps/web`
- [ ] Aller sur `/dues`
- [ ] Cliquer sur le menu (ou bouton "Éditer") d'une cotisation
- [ ] Vérifier que le dialogue d'édition s'ouvre
- [ ] Modifier le **montant** (par ex. 350 → 380)
- [ ] Modifier la **date d'échéance**
- [ ] Ajouter une **note** (ex : "Sœur réduction 10%")
- [ ] Enregistrer
- [ ] Vérifier que la liste affiche immédiatement le nouveau montant et la nouvelle date
- [ ] Rouvrir le dialogue : tous les champs modifiés sont bien persistés
- [ ] Vérifier qu'aucune erreur rouge n'apparaît dans la console

#### A.3 Édition d'une cotisation depuis le profil membre
- [ ] Aller sur la fiche d'un membre via `/members/<id>`
- [ ] Repérer la section "Cotisations" du profil
- [ ] Cliquer sur "Éditer" sur une cotisation
- [ ] Modifier le montant, enregistrer
- [ ] Retourner sur `/dues` : le changement est visible
- [ ] Vérifier la cohérence entre les deux écrans (même montant partout)

#### A.4 Marquer une cotisation payée — paiement total (admin standard)
- [ ] Se connecter en tant qu'**admin standard**
- [ ] Aller sur `/dues`, choisir une cotisation "à régler"
- [ ] Cliquer sur "Marquer payée" / "Encaisser"
- [ ] Indiquer un montant **égal** au montant dû
- [ ] Valider
- [ ] La cotisation passe dans le bucket "payé"
- [ ] La date de paiement est renseignée

#### A.5 Paiement partiel — admin standard NE DOIT PAS pouvoir
- [ ] Toujours en **admin standard**
- [ ] Ouvrir le dialogue d'encaissement d'une cotisation
- [ ] Tenter de saisir un montant **inférieur** au dû (ex : due de 300 CHF → saisir 150 CHF)
- [ ] Vérifier qu'un des comportements suivants se produit :
  - Le bouton "Valider" est désactivé, OU
  - Un message d'erreur explicite indique que seul le trésorier peut enregistrer un paiement partiel, OU
  - Le champ se réinitialise au montant total
- [ ] Si la validation passe quand même : **C'EST UN BUG CRITIQUE à signaler**
- [ ] Vérifier qu'il n'y a pas non plus de bouton "Marquer en attente / pending_grace" visible pour l'admin standard

#### A.6 Paiement partiel — trésorier OUI
- [ ] Se déconnecter, se reconnecter en **trésorier**
- [ ] Reprendre la même cotisation
- [ ] Saisir un montant partiel (ex : 150 CHF sur 300 CHF)
- [ ] Valider
- [ ] Vérifier que l'opération est acceptée
- [ ] La cotisation passe au statut "partiellement payée" / "en cours"
- [ ] Vérifier que le reste à payer est correctement affiché (150 CHF)
- [ ] Encaisser le solde restant
- [ ] La cotisation passe à "payé"

#### A.7 Paiement partiel — rootAdmin OUI
- [ ] Se connecter en **rootAdmin**
- [ ] Refaire le test du paiement partiel sur une autre cotisation
- [ ] Vérifier que l'opération est acceptée

#### A.8 Marquer en "pending_grace" — trésorier / rootAdmin only
- [ ] En **trésorier**, sur une cotisation "à régler"
- [ ] Utiliser l'action "Marquer en attente / délai accordé"
- [ ] Valider, vérifier le changement de statut
- [ ] Se reconnecter en **admin standard** : l'action ne doit PAS être proposée

#### A.9 Annulation d'une cotisation ("Excluded")
- [ ] En **admin standard**, ouvrir une cotisation "à régler"
- [ ] Utiliser l'action "Annuler" / "Exclure"
- [ ] Confirmer (s'il y a un dialogue de confirmation)
- [ ] La cotisation disparaît du bucket "à régler" et apparaît dans le bucket "annulé"
- [ ] Vérifier qu'aucun montant n'apparaît plus comme "dû" pour ce membre
- [ ] Vérifier qu'on peut éventuellement réactiver la cotisation (ou non, selon le produit)

#### A.10 Vue à 4 buckets dans `/dues`
- [ ] Sur `/dues`, vérifier la présence des 4 buckets / onglets :
  - **À régler** (impayées, non échues ou échues)
  - **En cours** (paiement partiel en cours)
  - **Payé** (soldé totalement)
  - **Annulé** ("Excluded")
- [ ] Cliquer sur chaque bucket et vérifier que les cotisations affichées correspondent au statut
- [ ] Vérifier les compteurs (nombre par bucket) cohérents avec le contenu

#### A.11 Permissions secretary
- [ ] Se connecter en **secretary**
- [ ] Aller sur `/dues`
- [ ] Vérifier que la liste est visible (lecture OK)
- [ ] Tenter d'éditer une cotisation : action refusée OU bouton absent
- [ ] Tenter d'encaisser : action refusée OU bouton absent

---

### B. Facture parent (apps/courtbase-register)

#### B.1 Le parent voit sa facture
- [ ] Ouvrir `apps/courtbase-register` (URL parent du club)
- [ ] Se connecter en tant que **parent** ayant un enfant inscrit
- [ ] Aller sur `/account` (ou la page Facture dédiée si présente dans le menu)
- [ ] Vérifier qu'au moins une facture / cotisation s'affiche
- [ ] Détails affichés à vérifier :
  - Nom de l'enfant concerné
  - Montant dû
  - Date d'échéance
  - **IBAN** (celui défini dans `/config/club`)
  - **BVR** ou référence de paiement
  - Statut (à régler / partiellement / payé / annulé)

#### B.2 Cohérence avec `apps/web`
- [ ] Côté **admin**, modifier le montant d'une cotisation (ex : 300 → 280 CHF)
- [ ] Côté **parent**, rafraîchir la page facture
- [ ] Le nouveau montant (280 CHF) s'affiche
- [ ] Côté **admin**, encaisser cette cotisation
- [ ] Côté **parent**, vérifier que le statut passe à "payé" et que le montant restant à payer est de 0

#### B.3 Cas "registeredByUid" — enfant majeur
- [ ] Identifier un cas où un parent a inscrit son enfant **majeur** (donc l'enfant a son propre compte utilisateur)
- [ ] Se connecter avec le compte du **parent qui a fait l'inscription** : la facture doit apparaître
- [ ] Se déconnecter, se connecter avec le compte de l'**enfant majeur lui-même** : la facture **NE DOIT PAS** lui apparaître (sauf si elle est aussi rattachée à lui)
- [ ] Cas inverse : un enfant majeur s'inscrit lui-même → seul son compte voit la facture, pas le compte du parent (si distinct)

#### B.4 Annulation côté admin → côté parent
- [ ] Admin annule une cotisation
- [ ] Parent rafraîchit `/account` : la facture annulée n'apparaît plus dans les factures actives (ou apparaît marquée "annulée")
- [ ] Vérifier qu'aucun appel à paiement n'est plus présenté

#### B.5 Parent — pas d'accès édition
- [ ] Le parent ne doit voir aucun bouton "éditer", "annuler" ou "marquer payé" sur sa facture
- [ ] Vue **strictement en lecture**

---

### C. Module Comptabilité (apps/web → /compta)

#### C.1 Accès au menu — qui voit quoi
- [ ] Se connecter en **rootAdmin** : le menu "Comptabilité" / `/compta` est visible dans la navigation
- [ ] Se connecter en **trésorier** : le menu "Comptabilité" est visible
- [ ] Se connecter en **admin standard** : le menu "Comptabilité" **NE DOIT PAS** être visible
- [ ] Tenter d'accéder en tapant directement l'URL `/compta` en **admin standard** : redirection ou message "accès refusé"
- [ ] Se connecter en **secretary** : vérifier le comportement (lecture seule attendue, voir C.8)
- [ ] Se connecter en **coach** : pas de menu, URL refusée
- [ ] Se connecter en **officiel** : pas de menu, URL refusée
- [ ] Se connecter en **parent** (depuis apps/web si possible) : pas de menu, URL refusée

#### C.2 Plan comptable — consultation
- [ ] En **trésorier**, aller sur `/compta` → "Plan comptable"
- [ ] Vérifier que la liste des comptes s'affiche
- [ ] Vérifier qu'on retrouve au moins des comptes :
  - Compte cotisations
  - Compte licences
  - Compte banque / caisse
  - Compte fédération

#### C.3 Plan comptable — création d'un nouveau compte
- [ ] Cliquer sur "Nouveau compte"
- [ ] Renseigner numéro, libellé, type (actif/passif/produit/charge)
- [ ] Enregistrer
- [ ] Le nouveau compte apparaît dans la liste
- [ ] Recharger la page : le compte est toujours là (persistance OK)

#### C.4 Écriture manuelle — création
- [ ] Aller sur "Écritures" / "Saisie"
- [ ] Créer une écriture manuelle :
  - Date
  - Libellé (ex : "Remboursement matériel")
  - Compte au **débit**
  - Compte au **crédit**
  - Montant
- [ ] Vérifier qu'une écriture sans débit OU sans crédit est **refusée**
- [ ] Vérifier qu'une écriture déséquilibrée (montant débit ≠ montant crédit) est **refusée** (si le formulaire propose ce cas)
- [ ] Enregistrer une écriture valide
- [ ] Elle apparaît dans le grand livre

#### C.5 Génération automatique — cotisation payée
- [ ] Côté `/dues`, encaisser totalement une cotisation
- [ ] Aller dans `/compta` → grand livre
- [ ] Vérifier qu'une écriture a été générée automatiquement :
  - Débit : compte banque / caisse
  - Crédit : compte cotisations
  - Montant : celui de la cotisation
  - Libellé contenant un identifiant lisible (nom du membre ou référence)

#### C.6 Génération automatique — licence sent_paid
- [ ] Faire passer une licence au statut "envoyée et payée" (sent_paid) via le workflow trésorier
- [ ] Vérifier qu'une écriture est générée :
  - Débit : compte licences
  - Crédit : compte fédération (ou banque selon paramétrage)
  - Montant correct

#### C.7 Grand livre — filtres
- [ ] Aller sur le grand livre
- [ ] Filtrer par **compte** (ex : compte cotisations) → seules les écritures touchant ce compte apparaissent
- [ ] Filtrer par **période** (ex : mois en cours) → seules les écritures de cette période apparaissent
- [ ] Combiner les deux filtres : résultat cohérent
- [ ] Vérifier l'affichage du **solde** du compte filtré (somme des débits − somme des crédits)
- [ ] Réinitialiser les filtres : tout le grand livre revient

#### C.8 Permissions secretary sur `/compta`
- [ ] Se connecter en **secretary**
- [ ] Si l'accès est ouvert : tenter de créer une écriture → action refusée OU bouton absent
- [ ] Tenter de créer un compte → action refusée OU bouton absent
- [ ] Lecture du grand livre : autorisée
- [ ] Si l'accès est entièrement bloqué : noter le comportement réel

#### C.9 Export CSV / Excel
- [ ] En **trésorier**, depuis le grand livre, cliquer sur "Exporter"
- [ ] Choisir CSV : le fichier se télécharge
- [ ] Ouvrir le fichier : les colonnes (date, libellé, débit, crédit, montant, compte) sont présentes et lisibles
- [ ] Choisir Excel (si proposé) : même test
- [ ] Vérifier que l'export respecte les filtres en cours (compte / période)
- [ ] Vérifier que les montants sont au bon format (point ou virgule selon convention)

#### C.10 OCR pièces justificatives — NON testable
- [ ] Vérifier la présence (ou l'absence) d'un bouton "Importer une pièce" / "OCR"
- [ ] Si le bouton existe : il doit indiquer "à venir" / "indisponible"
- [ ] Si le bouton n'existe pas encore : noter "fonction différée" comme attendu
- [ ] **Ne pas chercher à tester l'OCR en lui-même** (différé MVP)

---

### D. Cohérence cross-modules

#### D.1 Modification d'une cotisation déjà payée
- [ ] En **trésorier**, sur une cotisation totalement **payée**, tenter de modifier le montant
- [ ] Si autorisé : vérifier qu'une écriture **corrective** (ou recalculée) apparaît dans le grand livre
- [ ] Si refusé : noter le message d'erreur (comportement attendu pour préserver la cohérence comptable)

#### D.2 Annulation d'une cotisation déjà payée
- [ ] Annuler une cotisation qui avait été payée
- [ ] Vérifier qu'une écriture de **storno / extourne** apparaît dans le grand livre (débit et crédit inversés)
- [ ] Le solde des comptes concernés revient à l'état initial

#### D.3 Membre désactivé avec cotisation impayée
- [ ] Désactiver un membre (set `member.active = false`)
- [ ] Aller sur `/dues` : que devient la cotisation impayée ?
  - Reste visible dans "à régler" ?
  - Passe automatiquement en "annulé" ?
- [ ] Noter le comportement observé
- [ ] Côté parent dans `apps/courtbase-register` : la facture est-elle encore visible ?

#### D.4 Réinscription d'un membre désactivé
- [ ] Réinscrire le membre via le wizard (le membre passe à `active = true`)
- [ ] Confirmer l'inscription
- [ ] Vérifier qu'une **nouvelle** cotisation est créée pour la nouvelle saison
- [ ] Vérifier que l'ancienne cotisation (impayée ou annulée) n'est pas réutilisée par erreur
- [ ] Pas de doublon de cotisation pour la nouvelle saison

#### D.5 Cohérence somme dues / somme écritures
- [ ] Noter le total des cotisations "payées" sur `/dues`
- [ ] Noter le solde crédit du compte cotisations dans le grand livre
- [ ] Les deux montants doivent **correspondre** (à 1 CHF près en cas d'arrondi)
- [ ] Si écart : signaler comme bug

---

### E. Permissions — tableau récapitulatif à valider

Pour chaque rôle, se connecter et cocher ce qui correspond au comportement réellement observé.

#### E.1 rootAdmin
- [ ] Voit le menu `/compta`
- [ ] Peut éditer toute cotisation
- [ ] Peut encaisser totalement
- [ ] **Peut** encaisser partiellement
- [ ] **Peut** marquer en pending_grace
- [ ] Peut annuler une cotisation
- [ ] Peut créer un compte au plan comptable
- [ ] Peut saisir une écriture manuelle
- [ ] Peut exporter

#### E.2 treasurer (trésorier)
- [ ] Voit le menu `/compta`
- [ ] Peut éditer toute cotisation
- [ ] Peut encaisser totalement
- [ ] **Peut** encaisser partiellement
- [ ] **Peut** marquer en pending_grace
- [ ] Peut annuler une cotisation
- [ ] Peut créer un compte au plan comptable
- [ ] Peut saisir une écriture manuelle
- [ ] Peut exporter

#### E.3 secretary
- [ ] Lecture seule sur `/dues`
- [ ] Pas d'édition de cotisation
- [ ] Pas d'encaissement
- [ ] Lecture seule sur `/compta` (si accès accordé) OU pas d'accès du tout
- [ ] Pas de création d'écriture
- [ ] Pas de création de compte

#### E.4 admin standard
- [ ] Voit `/dues`
- [ ] Peut éditer une cotisation (montant, date, notes)
- [ ] Peut encaisser **totalement**
- [ ] **NE PEUT PAS** encaisser partiellement
- [ ] **NE PEUT PAS** marquer en pending_grace
- [ ] Peut annuler une cotisation
- [ ] **NE VOIT PAS** le menu `/compta`
- [ ] URL `/compta` directe → refusée

#### E.5 coach
- [ ] Pas de menu `/dues` (ou lecture très restreinte selon produit)
- [ ] Pas de menu `/compta`
- [ ] URL `/compta` directe → refusée

#### E.6 officiel
- [ ] Pas de menu `/dues`
- [ ] Pas de menu `/compta`
- [ ] URL `/compta` directe → refusée

#### E.7 parent (apps/courtbase-register)
- [ ] Voit uniquement ses propres factures dans `/account`
- [ ] Aucune visibilité sur les cotisations des autres familles
- [ ] Aucun accès à `/compta` (cette route n'existe pas dans `apps/courtbase-register`)
- [ ] Aucune édition possible de sa propre facture

---

### F. Notes compta

- [ ] Aucune erreur rouge bloquante dans la console pendant toute la session de tests
- [ ] Aucune fuite d'information entre clubs (rappel : un projet Firebase = un club)
- [ ] Tous les montants affichés en CHF, formatés correctement
- [ ] Les dates affichées au format suisse (jj.mm.aaaa) ou format cohérent dans toute l'app
- [ ] En cas de comportement ambigu sur les permissions partielles : noter la capture d'écran + le rôle utilisé + l'action tentée

---

## PWA companion (apps/courtbase-app)

### Pré-requis
- 1 smartphone iOS récent (Safari) ET 1 smartphone Android récent (Chrome) pour couvrir les 2 plateformes
- L'URL de la PWA companion fournie par l'admin (différente de l'app web admin et de l'app inscriptions parents)
- 1 compte coach lié à au moins 1 équipe avec 5+ joueurs dans cette équipe
- 1 compte officiel avec une licence active de niveau 2 ou plus
- 1 compte multi-rôle (coach ET officiel actifs) sur le même club
- 1 compte admin (pour assigner les matchs aux officiels et pour les tests admin en mobilité)
- 1 compte joueur (membre lié à un user) pour vérifier la section joueur
- 1 compte sans aucun rôle (ni coach, ni officiel, ni admin, ni membre)
- Au moins 3 matchs futurs dans le club : 1 avec adversaire confirmé, 1 avec adversaire TBD (placeholder), 1 dans le passé
- Au moins 1 inscription dans chacun des 4 buckets (demande, essai, confirmé, terminé) sur l'équipe du coach test
- Connexion Wi-Fi ET capacité à couper le réseau (mode avion) pour tester le hors-ligne
- Permission d'accès à la caméra/galerie sur le smartphone (pour les uploads de photos de licence)

### A. Installation & accès PWA

#### A.1 — Ouverture sur Safari iOS
- [ ] Ouvrir l'URL de la PWA companion dans Safari sur iPhone
- [ ] Vérifier que la page se charge sans erreur visible
- [ ] Vérifier que les polices, couleurs et logos s'affichent correctement (pas de Times New Roman à la place de la police custom)
- [ ] Vérifier que l'écran est bien mobile-first (pas de scroll horizontal, boutons assez gros pour le pouce)
- [ ] Tester la rotation portrait / paysage : vérifier que la mise en page reste lisible

#### A.2 — Ouverture sur Chrome Android
- [ ] Ouvrir l'URL de la PWA companion dans Chrome sur Android
- [ ] Vérifier que la page se charge sans erreur visible
- [ ] Vérifier que les polices, couleurs et logos s'affichent correctement
- [ ] Vérifier l'absence de scroll horizontal
- [ ] Comparer visuellement avec iOS : l'apparence doit être cohérente

#### A.3 — Ajout à l'écran d'accueil (mode standalone)
- [ ] iOS : ouvrir le menu Partager dans Safari et choisir "Sur l'écran d'accueil"
- [ ] iOS : confirmer l'ajout et vérifier que l'icône apparaît sur l'écran d'accueil avec le bon logo
- [ ] iOS : lancer l'app depuis l'icône et vérifier qu'elle s'ouvre en plein écran (sans la barre d'URL Safari)
- [ ] Android : ouvrir le menu Chrome (3 points) et choisir "Ajouter à l'écran d'accueil" ou "Installer l'application"
- [ ] Android : confirmer l'installation et vérifier l'icône sur l'écran d'accueil / le drawer d'apps
- [ ] Android : lancer l'app et vérifier qu'elle s'ouvre en mode standalone (sans la barre Chrome)
- [ ] Sur les 2 plateformes : vérifier que l'icône a un visuel net (pas pixelisé)

#### A.4 — Mode hors-ligne basique
- [ ] Lancer l'app une première fois en ligne pour mettre en cache les ressources
- [ ] Activer le mode avion sur le smartphone
- [ ] Relancer l'app depuis l'icône d'accueil
- [ ] Vérifier que l'app affiche au minimum une coquille (logo, structure) plutôt qu'une page blanche ou un message d'erreur réseau brutal
- [ ] Vérifier qu'un message explicite indique que la connexion est requise pour charger les données
- [ ] Désactiver le mode avion et vérifier que les données se rechargent

#### A.5 — Login Google OAuth
- [ ] Sur l'écran de connexion, taper sur "Se connecter avec Google"
- [ ] Vérifier qu'une popup ou un onglet Google s'ouvre pour choisir le compte
- [ ] Choisir un compte Google valide (déjà invité dans le club)
- [ ] Vérifier la redirection automatique vers la home après authentification réussie
- [ ] Vérifier que le nom et l'email de l'utilisateur apparaissent quelque part visiblement (en haut, dans un menu, etc.)

#### A.6 — Refus d'un compte non rattaché
- [ ] Se déconnecter
- [ ] Tenter de se connecter avec un compte Google jamais invité dans le club
- [ ] Vérifier un message d'erreur clair (compte non reconnu) et un retour à l'écran de connexion
- [ ] Vérifier que la session Google a bien été terminée (pas de boucle infinie de re-login)

### B. Home single-page (rôles cumulés)

#### B.1 — Affichage selon les rôles
- [ ] Se connecter avec un compte **coach uniquement** (avec licence coach active)
- [ ] Vérifier que la section "Coach" est visible sur la home
- [ ] Vérifier qu'aucune section "Officiel" ou "Admin" n'apparaît
- [ ] Se déconnecter et se reconnecter avec un compte **officiel uniquement** (niveau 2+ actif)
- [ ] Vérifier que la section "Officiel" est visible
- [ ] Vérifier qu'aucune section "Coach" ou "Admin" n'apparaît
- [ ] Se reconnecter avec un compte **admin**
- [ ] Vérifier que la section "Admin" est visible
- [ ] Se reconnecter avec un compte **joueur** (membre lié, sans rôle staff)
- [ ] Vérifier qu'une section "Joueur" est visible avec des infos pertinentes (équipe, prochains matchs, etc.)

#### B.2 — Pas de role switcher
- [ ] Sur un compte multi-rôle, vérifier l'absence de tout bouton ou menu permettant de "basculer" entre rôles
- [ ] Confirmer que les sections de chaque rôle s'empilent simplement les unes au-dessus des autres sur la même page

#### B.3 — Badge "rôle principal"
- [ ] Sur un compte coach uniquement : vérifier qu'un badge ou label indique "Coach" comme rôle principal
- [ ] Sur un compte officiel uniquement : vérifier le badge "Officiel"
- [ ] Sur un compte multi-rôle : vérifier qu'un seul rôle est désigné comme principal (selon une logique cohérente)

#### B.4 — Tab bar avec détection auto
- [ ] Vérifier la présence d'une tab bar fixe en bas d'écran
- [ ] Vérifier que les onglets affichés dépendent des rôles (coach / officiel / admin / joueur)
- [ ] Naviguer vers une vue secondaire (ex. détail d'équipe) et vérifier que l'onglet correspondant de la tab bar s'illumine automatiquement
- [ ] Aucun comportement bizarre : pas 2 onglets actifs en même temps, pas d'onglet désynchronisé avec la page affichée

### C. Vues Coach

#### C.1 — Liste de mes équipes
- [ ] Naviguer vers la section / l'onglet "Mes équipes"
- [ ] Vérifier que toutes les équipes où le compte est coach apparaissent
- [ ] Vérifier qu'aucune équipe étrangère (où je ne suis pas coach) n'apparaît
- [ ] Taper sur une équipe pour ouvrir son détail

#### C.2 — Détail d'une équipe (onglets + filtres + search)
- [ ] Vérifier la présence de 3 onglets ou chips de filtre (selon le design)
- [ ] Tester chaque onglet : la liste affichée doit changer
- [ ] Utiliser la barre de recherche pour filtrer par nom de joueur
- [ ] Vérifier que la recherche est insensible à la casse et aux accents
- [ ] Vider la recherche : la liste complète revient

#### C.3 — Kebab menu sur un joueur
- [ ] Sur un joueur de l'équipe, taper sur le menu kebab (3 points)
- [ ] Vérifier la présence de l'action "Voir profil"
- [ ] Taper sur "Voir profil" et vérifier que le profil détaillé s'ouvre
- [ ] Revenir et rouvrir le kebab : vérifier l'action "Lancer une demande de licence"
- [ ] Tester l'action "Demander photo de licence" (voir section C.7)

#### C.4 — Lancer une demande de licence (étape 1)
- [ ] Sur un membre sans demande de licence en cours, taper "Lancer une demande de licence"
- [ ] Confirmer dans le dialog
- [ ] Vérifier qu'une notification confirme l'envoi au parent
- [ ] Vérifier que le statut du joueur dans la liste de l'équipe reflète "demande de licence en cours"
- [ ] Tenter de relancer une demande sur le même joueur : vérifier que l'action est désactivée ou produit un message clair (déjà en cours)

#### C.5 — Liste des inscriptions de mon équipe (4 buckets)
- [ ] Ouvrir la vue inscriptions de l'équipe
- [ ] Vérifier la présence visuelle des 4 buckets : Demande / Essai / Confirmé / Terminé
- [ ] Vérifier que chaque bucket a une bordure ou un code couleur distinct
- [ ] Vérifier qu'au moins 1 inscription apparaît dans chaque bucket (pré-requis du test)
- [ ] Taper sur une inscription pour ouvrir son détail
- [ ] Vérifier les actions disponibles côté coach (consultation principalement, peu d'actions destructives)

#### C.6 — Workflow licence — vue coach (validation des docs parents)
- [ ] Sur un membre dont le parent a soumis ses documents, ouvrir la vue de validation
- [ ] Vérifier que tous les fichiers uploadés par le parent sont visibles et téléchargeables / prévisualisables
- [ ] Vérifier qu'on peut zoomer sur les photos / PDF
- [ ] Taper "Approuver" et vérifier que le statut passe à `coach_validated`
- [ ] Sur un autre membre avec docs : tester "Refuser / Renvoyer au parent"
- [ ] Vérifier qu'un champ commentaire est obligatoire pour le refus
- [ ] Soumettre le refus et vérifier que le parent reçoit une notif (à recouper côté register)

#### C.7 — Photo de licence
- [ ] Sur la liste d'équipe, vérifier qu'un indicateur visuel marque les membres sans photo de licence
- [ ] Sur un membre sans photo, taper "Demander la photo"
- [ ] Vérifier la confirmation et la notif côté parent
- [ ] Une fois la photo uploadée par le parent (test croisé), revenir sur la vue coach
- [ ] Vérifier que la photo apparaît et qu'un bouton "Valider" est disponible
- [ ] Valider la photo et vérifier que le membre n'apparaît plus dans la liste des photos manquantes

### D. Vues Officiel

#### D.1 — Inbox des matchs ouverts
- [ ] Se connecter avec un compte officiel niveau 2+
- [ ] Ouvrir la section / l'onglet "Matchs ouverts"
- [ ] Vérifier que seuls les matchs **avec adversaire confirmé** apparaissent (les matchs TBD doivent être absents)
- [ ] Vérifier que les matchs proposés sont compatibles avec mon niveau d'officiel (pas de matchs d'un niveau trop élevé)
- [ ] Taper sur un match pour voir le détail (équipes, date, lieu, court, niveau requis)
- [ ] Postuler / accepter un match disponible
- [ ] Vérifier que le match disparaît de l'inbox et apparaît dans "Mes matchs assignés"

#### D.2 — Mes matchs assignés
- [ ] Ouvrir la liste de mes matchs futurs
- [ ] Vérifier que les matchs sont triés du plus proche au plus éloigné
- [ ] Taper sur un match pour voir le détail
- [ ] Vérifier les informations affichées : équipes, date, heure, lieu, salle / court, liste des autres officiels assignés
- [ ] Vérifier la présence du bouton "Demander un remplacement" sur un match futur

#### D.3 — Demander un remplacement
- [ ] Sur un match futur accepté, taper "Demander un remplacement"
- [ ] Vérifier l'ouverture d'un dialog
- [ ] Sélectionner ou saisir une raison / commentaire
- [ ] Soumettre la demande
- [ ] Vérifier la confirmation visuelle
- [ ] Vérifier que le match reste affiché chez moi mais marqué "remplacement en cours"

#### D.4 — Inbox des remplacements (côté autre officiel)
- [ ] Se connecter avec un autre compte officiel compatible niveau
- [ ] Ouvrir l'inbox des remplacements
- [ ] Vérifier que la demande émise en D.3 est visible avec : match concerné, demandeur, raison, date
- [ ] Vérifier la **détection de conflits** : si j'ai déjà un autre match assigné en parallèle, un avertissement visuel apparaît
- [ ] Sur une demande sans conflit, taper "Accepter"
- [ ] Vérifier que l'assignation a basculé : le match apparaît maintenant dans **mes** matchs assignés et plus chez le demandeur
- [ ] Vérifier que le demandeur reçoit une notif "remplacement accepté"

#### D.5 — Historique des matchs joués
- [ ] Ouvrir l'onglet / la section "Historique"
- [ ] Vérifier que les matchs passés où j'étais officiel sont listés
- [ ] Vérifier le tri (du plus récent au plus ancien typiquement)
- [ ] Taper sur un match passé pour voir son détail (résultat, autres officiels)

### E. Vues Admin en mobilité

#### E.1 — Settings rapides
- [ ] Se connecter avec un compte admin
- [ ] Naviguer vers les settings depuis la PWA
- [ ] Vérifier que les paramètres essentiels (profil, club basique) sont consultables
- [ ] Vérifier que les paramètres lourds (gestion membres, compta) renvoient vers l'app web ou affichent un message "à utiliser depuis l'app web"

#### E.2 — Demandes en attente
- [ ] Ouvrir la vue "Demandes en attente"
- [ ] Vérifier la présence des demandes en cours (inscriptions, licences, remplacements) avec un compteur global
- [ ] Taper sur une demande pour voir son détail

#### E.3 — Notifications temps réel
- [ ] Garder l'app ouverte côté admin
- [ ] Depuis un autre compte (parent ou coach), déclencher une action notifiante (soumission de docs licence, demande de remplacement…)
- [ ] Vérifier que la cloche / le badge de notif s'incrémente sans rafraîchir
- [ ] Ouvrir la notif et vérifier qu'elle pointe vers la bonne ressource

### F. Notifications in-app

#### F.1 — Notif coach assigné à une équipe
- [ ] Depuis l'app web admin, assigner un coach à une équipe
- [ ] Côté PWA companion (compte coach), vérifier l'apparition d'une notif "vous avez été ajouté à l'équipe X"

#### F.2 — Notif officiel assigné à un match
- [ ] Depuis l'app web admin, assigner un officiel à un match
- [ ] Côté PWA companion (compte officiel), vérifier l'apparition d'une notif "vous avez été assigné au match X"

#### F.3 — Notif remplacement accepté
- [ ] Demander un remplacement (cf. D.3)
- [ ] Faire accepter par un autre officiel (cf. D.4)
- [ ] Vérifier que le demandeur reçoit une notif "votre remplacement a été accepté par Y"

#### F.4 — Notif coach lance une demande de licence
- [ ] Côté coach, lancer la demande de licence (cf. C.4)
- [ ] Vérifier côté app inscriptions parents (en miroir) qu'une notif / mail prévient le parent
- [ ] Le parent doit pouvoir compléter la demande depuis son app register

#### F.5 — Centre de notifs (cloche)
- [ ] Taper sur l'icône cloche dans la PWA
- [ ] Vérifier la liste des notifs récentes (lues et non lues distinguées visuellement)
- [ ] Taper sur une notif non lue : vérifier qu'elle se marque lue et que le badge se décrémente
- [ ] Tester le bouton "Tout marquer comme lu"
- [ ] Vérifier que le badge tombe à zéro et que toutes les notifs apparaissent comme lues

### G. Cas multi-rôle (coach + officiel)

- [ ] Se connecter avec le compte multi-rôle (coach + officiel actifs)
- [ ] Vérifier que la home affiche **les 2 sections** empilées : section Coach **et** section Officiel
- [ ] Vérifier que la tab bar contient les onglets des 2 rôles (sans doublon ni onglet manquant)
- [ ] Naviguer vers "Mes équipes" et vérifier l'accès complet aux fonctionnalités coach
- [ ] Naviguer vers "Matchs ouverts" et vérifier l'accès complet aux fonctionnalités officiel
- [ ] Postuler à un match en tant qu'officiel puis revenir sur la section coach : vérifier l'absence de plantage / désynchronisation
- [ ] Vérifier qu'un seul rôle principal est marqué (badge "primaryRoleLabel" cohérent)
- [ ] Vérifier l'absence totale d'un switcher ou de tout mécanisme de bascule entre rôles

### H. Cas dégradés

#### H.1 — Coach sans licence active
- [ ] Sur un compte avec rôle coach mais **sans licence coach active** : vérifier que la section Coach apparaît quand même sur la home (flag inclusif côté UI)
- [ ] Vérifier que les fonctionnalités coach sont accessibles depuis la PWA
- [ ] Sur l'app web admin (router strict côté admin), vérifier que ce même utilisateur n'aurait pas tous les droits coach (à recouper avec la section admin)

#### H.2 — Officiel sans licence active
- [ ] Sur un compte avec rôle officiel mais sans licence active : vérifier que la section Officiel apparaît sur la home
- [ ] Vérifier que l'utilisateur peut consulter ses matchs mais constater que les matchs proposés correspondent bien à son niveau attendu (ou indication claire si bloqué)

#### H.3 — User sans aucun rôle
- [ ] Se connecter avec un compte sans rôle, sans membre lié
- [ ] Vérifier que la home affiche un message explicite (ex. "Aucune section disponible") plutôt qu'une page vide ou un crash
- [ ] Vérifier qu'aucune tab bar avec actions sensibles n'apparaît
- [ ] Vérifier que seul un accès "mon compte / déconnexion" reste possible

#### H.4 — Joueur avec membre lié
- [ ] Se connecter avec un compte joueur (lié à un membre, sans rôle staff)
- [ ] Vérifier que la section Joueur affiche : équipe(s) d'appartenance, prochains matchs ou entraînements, infos de licence
- [ ] Vérifier l'absence des sections Coach / Officiel / Admin
- [ ] Vérifier que la tab bar n'expose aucune action staff

#### H.5 — Perte de connexion en cours d'usage
- [ ] Pendant qu'une vue est chargée (ex. liste d'équipe), couper le Wi-Fi / activer le mode avion
- [ ] Tenter une action (postuler à un match, valider des docs) : vérifier un message d'erreur clair "connexion perdue" sans crash
- [ ] Restaurer la connexion et retenter l'action : vérifier que tout repart normalement
- [ ] Vérifier qu'aucune écriture fantôme n'a eu lieu (pas de double soumission après reconnexion)

#### H.6 — Session expirée
- [ ] Laisser l'app ouverte en arrière-plan pendant plusieurs heures (ou simuler une expiration de session)
- [ ] Revenir sur l'app et tenter une action
- [ ] Vérifier qu'un re-login automatique ou un écran de reconnexion clair apparaît, sans perte de la navigation en cours
- [ ] Vérifier qu'après reconnexion l'utilisateur retrouve l'état attendu

---

## Que signaler en fin de campagne ?

Pour chaque bug ou écart observé :

1. **Le numéro précis** de l'item de la checklist (ex. `C.5 — bullet 4`)
2. **L'app et l'URL** où c'est arrivé (ex. `apps/web` `/dues/abc123`)
3. **Le rôle et le compte de test** utilisé
4. **Le navigateur ou OS smartphone** + version
5. **Une capture d'écran** (mieux : une courte vidéo)
6. **Comportement attendu vs observé** en 1-2 phrases
7. **Reproductible ?** (toujours / parfois / une seule fois)

Pour les sujets de **permissions** (qui peut faire quoi), la moindre faille = signaler en priorité — ce sont les bugs les plus critiques.

Pour les sujets **multi-tenant** : si jamais tu vois des données d'un autre club apparaître chez toi, c'est une faille critique de sécurité, à signaler immédiatement.

Bonne campagne de tests !
