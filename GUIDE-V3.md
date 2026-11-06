# Version 3 — Pièces et vannes gérées depuis l’interface

L’intégration locale **Ma maison - Chauffage** conserve une seule liste de pièces, utilisée par l’affichage, les consignes et la commande chaudière. Ajouter, renommer ou retirer une vanne ne nécessite plus de YAML, d’assistants supplémentaires ni de redémarrage HA.

## Installation

1. Copier `custom_components/ma_maison_chauffage` dans `/config/custom_components/ma_maison_chauffage` sur HA.
2. Copier `www/ma-maison-chauffage-card.js` et `configuration/chauffage-planning-card.js` dans `/config/www/`.
3. Redémarrer HA. Ouvrir **Paramètres → Appareils et services → Ajouter une intégration → Ma maison - Chauffage**. Une seule maison est prise en charge ; le chauffage démarre désactivé.
4. Dans les ressources des tableaux de bord, ajouter les deux URL suivantes, type **Module JavaScript**, puis recharger le navigateur :
   - `/local/ma-maison-chauffage-card.js?v=3`
   - `/local/chauffage-planning-card.js?v=3`
5. Dans un tableau de bord, choisir **Ajouter une carte → Ma maison - Chauffage**. Elle trouve automatiquement le registre de l’intégration. `configuration/tableau-de-bord-dynamique.yaml` fournit aussi un exemple facultatif ; aucun YAML n’est obligatoire pour ajouter la carte.
6. Dans **Réglages** de la carte, choisir le relais chaudière et les assistants Planning. Enregistrer en laissant **Chauffage autorisé** décoché.
7. Dans **Pièces → Ajouter une vanne**, sélectionner une entité climate, saisir son nom et ses quatre températures, puis Enregistrer. Répéter pour le nombre de pièces souhaité.
8. Vérifier les horaires dans **Plannings**, choisir le programme actif sur l’accueil, puis activer le chauffage après les vérifications matérielles.

Button Card et les anciens packages YAML ne sont pas nécessaires à la version 3. Ne pas exécuter les anciens pilotes en parallèle. Les commandes de cette première version de l’intégration, y compris les changements de consigne, nécessitent un **compte administrateur HA**.

## Gérer les pièces

- **Ajouter une vanne** sélectionne une entité climate déjà présente dans HA. L’appairage reste une opération Zigbee2MQTT.
- **Modifier** change le nom, l’entité associée, les quatre températures ou le mode permanent.
- **Retirer** demande confirmation, puis exclut la pièce de l’affichage, des envois de consigne et des demandes chaudière.

**Retirer ne met pas la vanne sur OFF.** Elle conserve sa dernière consigne et peut encore chauffer avec le circuit. Mettez-la sur OFF dans sa fiche HA si vous souhaitez l’arrêter. Changer l’entité associée laisse également l’ancienne vanne sur sa dernière consigne.

Chaque fiche gère une vanne ; une vanne ne peut appartenir à deux pièces. Le radiateur de salle de bain toujours ouvert ne doit pas être ajouté. Le nombre de pièces n’est pas fixé dans les fichiers. Les tests du registre couvrent 0, 1, 8, 20 et 50 pièces ; le pilote est testé avec vingt vannes simulées puis leur retrait. Cela ne constitue pas une validation de capacité d’un réseau Zigbee réel.

## Les quatre profils

Chaque pièce possède **Confort, Éco, Nuit et Absent**, indépendants, entre 5 et 25 °C par pas de 0,5 °C. Les limites annoncées par la vanne sont contrôlées avant envoi.

- **Planning** suit le profil de la plage active, avec Éco en dehors des plages.
- Un mode **Confort / Éco / Nuit / Absent** fixe reste actif jusqu’au prochain choix. Une chambre peu occupée peut rester en Absent.
- **Consigne temporaire** : choisir une température et une durée de 0,5 à 12 h. Disponible lorsque le chauffage est autorisé, la maison présente et la pièce en mode Planning.
- **Reprendre le planning** annule la dérogation et remet la pièce en mode Planning.
- **Absent** sur l’accueil applique la température Absent de chaque pièce. Au retour, leurs modes permanents sont conservés ; les anciennes dérogations sont annulées.

Priorité : arrêt général → Absent maison → profil permanent de pièce → dérogation temporaire → planning.

Les échéances sont conservées après redémarrage. Changer le planning actif ou l’absence maison annule toutes les dérogations. Changer le mode ou la vanne d’une pièce annule sa dérogation. Renommer une pièce préserve son identité, ses températures et sa dérogation.

Les changements directs sur la TRV ou dans son dialogue climate natif sont remplacés par le pilote. Pour une dérogation conservée, utiliser la fiche de pièce.

## Plannings

Créer les assistants **Planning** dans les paramètres HA, puis sélectionner ceux à utiliser dans **Réglages** de la carte. Le nombre et les noms ne sont plus imposés.

Dans **Plannings**, choisir le programme à éditer et le jour, ajouter des plages début/fin/profil, copier la journée vers les jours cochés si nécessaire, puis **Enregistrer**. Les chevauchements sont refusés. Couper une plage traversant minuit en deux : 22:00–24:00 et 00:00–06:30, par exemple.

L’édition ne change pas le programme **actif** sélectionné sur l’accueil. L’éditeur modifie les assistants créés dans l’interface HA, pas les plannings définis en YAML. Les programmes V2 sont réutilisables : les plages utilisent `profil`, et une plage sans cette donnée signifie Confort. L’éditeur renseigne cette donnée pour vous.

Les horaires du programme actif sont communs aux pièces en mode Planning ; chacune utilise sa propre température pour le profil choisi.

## Coordination chaudière et défauts

Les TRV régulent localement ; le pilote choisit le mode **heat** et la consigne. Activer le contrôle intelligent/PID dans Zigbee2MQTT si souhaité. Une seule demande valide `hvac_action: heating` suffit pour demander la chaudière.

Valeurs initiales : confirmation 30 s, arrêt après disparition de la demande 30 s, repos minimal du relais 180 s. La réévaluation est périodique toutes les 15 s et réagit aux changements d’état. Adapter ces valeurs à la chaudière. Au redémarrage avec relais OFF, le repos minimal est recompté prudemment.

Les consignes sont envoyées en arrière-plan, avec quatre envois simultanés au maximum. Une vanne n’est relancée qu’après 30 s si sa consigne n’est pas confirmée. L’arrêt général du relais n’attend pas cette file. Un ordre Zigbee déjà transmis ne peut pas être rappelé.

Une vanne indisponible, sans état de chauffe exploitable, avec cible invalide ou envoi en échec est exclue du calcul. Les autres pièces continuent. Sans demande valide, un défaut entraîne une demande OFF sans délai d’arrêt. Une liste vide demande aussi OFF.

Le capteur facultatif **Dernier contact** doit contenir une date ISO 8601. L’âge maximal est réglable. Sans ce capteur, le pilote utilise la disponibilité et les attributs remontés par HA. Un message récent ne garantit pas que chaque attribut est récent.

Le relais reçoit au maximum trois tentatives espacées d’au moins 15 s. Après correction, cliquer **Réessayer les commandes du relais**. Les erreurs apparaissent dans la carte et les notifications persistantes HA. Un état rapporté du relais n’est pas une mesure de flamme.

Si le planning est absent ou invalide, les pièces en mode Planning sans dérogation sont exclues des demandes chaudière. Leur dernière consigne physique reste en place. Les profils permanents et dérogations valides peuvent continuer.

Cette intégration ne fournit pas d’arrêt autonome du relais si HA, Zigbee2MQTT ou le coordinateur est hors service. Les TRV et le relais peuvent conserver leur dernier réglage. Une demande OFF est tentée au déchargement normal de l’intégration ; cela ne garantit rien lors d’une panne brutale.

## Migration V2 → V3

1. Sauvegarder HA et noter les associations de vannes, températures et modes. Ils ne sont pas importés automatiquement.
2. Désactiver l’ancien **Chauffage autorisé** et vérifier que le relais est OFF.
3. Désactiver les anciennes automatisations de coordination chaudière, d’application du planning et de dérogations. Retirer les anciens packages de la configuration si inutilisés. Conserver les assistants Planning à réutiliser.
4. Installer V3 et garder le chauffage désactivé. Sélectionner le relais et les plannings existants ; ajouter les pièces et reporter leurs températures et modes dans l’interface.
5. Vérifier qu’aucun autre pilote (ancien package, thermostat connecté encore actif, autre intégration) ne commande le même relais. Activer le nouveau pilote et effectuer les essais.

Pour revenir à V2, désactiver puis décharger V3 avant de réactiver l’ancien pilote.

## Sauvegarde et essais

Le registre et les échéances sont conservés dans le stockage HA `.storage`, sous la clé `ma_maison_chauffage.<identifiant de configuration>`. Inclure ce stockage dans les sauvegardes ; ne pas le modifier à la main. Renommer ou supprimer une entité climate dans HA nécessite de corriger son association depuis Pièces.

Validation locale : tests de logique, pilote avec services et stockage HA simulés, formulaires dans un DOM simulé. Cette version n’a pas été exécutée sur votre installation HA ni votre chaudière.

Vérifier sur le matériel : une pièce seule, plusieurs pièces, retour au repos, Absent maison, Absent permanent d’une chambre, expiration d’une dérogation, redémarrage, vanne indisponible et retrait de la dernière pièce. Les simulations ne remplacent pas ces essais.
