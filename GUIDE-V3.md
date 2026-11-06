# Version 3 — Pièces et vannes gérées depuis l’interface

L’intégration locale **Ma maison - Chauffage** conserve une seule liste de pièces, utilisée par l’affichage, les consignes et la commande chaudière. Ajouter, renommer ou retirer une vanne ne nécessite plus de YAML, d’assistants supplémentaires ni de redémarrage HA.

## Installation avec HACS — version 3.2.2

Prérequis : Home Assistant **2025.7 ou ultérieur**, HACS installé et configuré, compte administrateur HA. Sur Home Assistant OS, si HACS n’est pas encore présent, suivre son [installation officielle, onglet OS/Supervised](https://www.hacs.dev/docs/use/download/download/), puis sa [configuration initiale](https://www.hacs.dev/docs/use/configuration/basic/).

1. [Ouvrir ce dépôt dans HACS](https://my.home-assistant.io/redirect/hacs_repository/?owner=D-Salmon&repository=home-assistant-chauffage&category=integration). Si nécessaire, renseigner l’adresse de votre Home Assistant. Autre chemin : **HACS → ⋮ → Dépôts personnalisés**, URL `https://github.com/D-Salmon/home-assistant-chauffage`, type **Intégration**, puis Ajouter.
2. Ouvrir **Ma maison - Chauffage** dans HACS et télécharger la version **3.2.2** ou une version ultérieure. Le dépôt est ajouté comme dépôt personnalisé ; il n’est pas dans le catalogue par défaut.
3. **Redémarrer Home Assistant**. Ouvrir **Paramètres → Appareils et services → Ajouter une intégration → Ma maison - Chauffage**. Une seule maison est prise en charge ; le chauffage démarre désactivé.
4. Ajouter la ressource JavaScript : aller dans **Paramètres → Tableaux de bord → ⋮ → Ressources**, cliquer sur **Ajouter une ressource**, entrer `/ma-maison-chauffage-assets/bootstrap.js` et sélectionner **Module JavaScript**. Garder cette URL sans paramètre de version ; elle restera identique aux prochaines mises à jour.
5. Recharger complètement le navigateur. Modifier un tableau de bord, choisir **Ajouter une carte → Manuel**, puis saisir `type: custom:ma-maison-chauffage-card`. La carte peut aussi apparaître dans la liste après l’ajout de la ressource.
6. Créer les assistants **Planning** souhaités dans **Paramètres → Appareils et services → Entrées → Créer une entrée → Planning** (le libellé peut être « Assistants » selon la traduction). Par exemple : Habituel et Vacances. Un programme contient une semaine complète, avec des horaires différentes en semaine et le week-end.
7. Dans **Réglages** de la carte, choisir le relais chaudière et ces assistants Planning. Enregistrer en laissant **Chauffage autorisé** décoché.
8. Dans **Pièces → Ajouter une vanne**, sélectionner une entité climate déjà appairée dans Zigbee2MQTT, saisir son nom et ses quatre températures, puis Enregistrer. Répéter pour le nombre de pièces souhaité.
9. Définir les horaires dans **Plannings**, choisir le programme actif sur l’accueil, puis activer le chauffage après les vérifications matérielles.

HACS installe les fichiers et propose les mises à jour. L’appairage Zigbee, le choix du relais, la création des assistants Planning et l’ajout d’une ressource du tableau de bord restent des étapes dans l’interface. Aucun YAML n’est nécessaire pour l’installation. Aucun jeton personnel GitHub propre à ce dépôt n’est requis ; HACS conserve son processus habituel de connexion GitHub.

Button Card et les anciens packages YAML ne sont pas nécessaires à la version 3. Ne pas exécuter les anciens pilotes en parallèle. Les commandes de cette première version de l’intégration, y compris les changements de consigne, nécessitent un **compte administrateur HA**.

### Installation manuelle facultative

Sans HACS, télécharger la version publiée et copier uniquement son dossier `custom_components/ma_maison_chauffage` complet, **avec le sous-dossier `assets`**, dans `/config/custom_components/ma_maison_chauffage`. Reprendre à l’étape 3. `configuration/tableau-de-bord-dynamique.yaml` reste un exemple facultatif de carte.

### Mises à jour

Télécharger la mise à jour dans HACS, redémarrer HA, puis recharger le navigateur ou l’application compagnon. Les pièces, températures et réglages restent dans le stockage HA. Conserver la ressource déjà ajoutée ; ne pas en créer de doublon. Si elle contient encore `?v=3.1.2` ou `?v=3.2.0`, la remplacer une dernière fois par `/ma-maison-chauffage-assets/bootstrap.js`. Les prochaines mises à jour ne nécessiteront plus de modifier cette URL.

À partir de Home Assistant 2026.3, l’intégration fournit également sa propre icône de marque dans la fiche **Appareils et services**. L’aperçu du Marketplace pour un dépôt personnalisé hors catalogue peut continuer à afficher l’icône générique ; cet aperçu est géré par le catalogue de marques, séparément des fichiers installés localement.

Pour une ancienne installation **3.0 uniquement**, retirer les deux anciennes ressources `/local/ma-maison-chauffage-card.js` et `/local/chauffage-planning-card.js` des ressources du tableau de bord et les remplacer par l’URL bootstrap ci-dessus. **Pour une première installation, aucune migration n’est nécessaire.**

Références : [dépôts personnalisés HACS](https://www.hacs.dev/docs/faq/custom_repositories/) et [liens directs HACS](https://www.hacs.dev/docs/use/my/).

## Gérer les pièces

- **Ajouter une vanne** sélectionne une entité climate déjà présente dans HA. L’appairage reste une opération Zigbee2MQTT.
- **Modifier** change le nom, l’entité associée, les quatre températures ou le mode permanent.
- **Retirer** demande confirmation, puis exclut la pièce de l’affichage, des envois de consigne et des demandes chaudière.

**Retirer ne met pas la vanne sur OFF.** Elle conserve sa dernière consigne et peut encore chauffer avec le circuit. Mettez-la sur OFF dans sa fiche HA si vous souhaitez l’arrêter. Changer l’entité associée laisse également l’ancienne vanne sur sa dernière consigne.

Chaque fiche gère une vanne ; une vanne ne peut appartenir à deux pièces. Le radiateur de salle de bain toujours ouvert ne doit pas être ajouté. Le nombre de pièces n’est pas fixé dans les fichiers. Les tests du registre couvrent 0, 1, 8, 20 et 50 pièces ; le pilote est testé avec vingt vannes simulées puis leur retrait. Cela ne constitue pas une validation de capacité d’un réseau Zigbee réel.

Dans la modification d’une pièce, **Déclencheur de pause** permet de choisir un `binary_sensor`, un `input_boolean` ou un `switch`. Quand l’entité est active (`on`), la vanne de cette pièce est mise sur OFF et elle ne demande pas la chaudière. Quand elle redevient inactive, le chauffage reprend selon le mode et le planning courants. Une entité indisponible suspend également la pièce par sécurité. Cela convient notamment à un capteur de fenêtre ou à un interrupteur maintenu ; il n’y a pas de durée temporisée.

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

### Anticipation adaptative

Dans **Réglages**, activer **Anticipation adaptative chauffe et arrêt** et choisir une fenêtre d’apprentissage de 7 ou 14 jours. Chaque vanne apprend séparément les vitesses de montée et de baisse de température ; le profil de la prochaine plage est appliqué en avance selon l’estimation. Une transition vers un profil plus frais (y compris la fin d’une plage vers Éco) peut donc couper la chauffe avant l’heure, en fonction de l’inertie observée. Sans historique exploitable, l’estimation démarre avec une marge prudente de 30 minutes.

Les mesures sont ajoutées environ toutes les cinq minutes tant que **Chauffage autorisé** est activé, y compris pendant les phases où le relais est momentanément arrêté afin d’apprendre le refroidissement. Désactiver le chauffage suspend l’apprentissage, mais conserve les données. Les échantillons expirent au fil de la fenêtre glissante. Une nouvelle pièce commence sans historique ; remplacer sa vanne efface l’ancien apprentissage. Le capteur extérieur est facultatif : lorsqu’il est choisi, les observations faites à une température extérieure proche sont privilégiées quand il y en a suffisamment. Cette fonction est une estimation locale, pas l’apprentissage propriétaire de Netatmo ; le résultat doit être ajusté à l’usage réel.

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
