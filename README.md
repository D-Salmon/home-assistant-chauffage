# Ma maison — Chauffage Home Assistant

**Version 3 : ajouter, renommer et retirer les vannes depuis l’interface, sans modifier le YAML.**

Une intégration locale conserve une seule liste de pièces pour l’affichage, les consignes et la coordination chaudière. Le nombre de vannes n’est plus fixé à huit. Interface mobile inspirée de Home + Control pour des TRV Zigbee2MQTT et un relais chaudière à contact sec.

## Fonctionnalités

- Quatre températures indépendantes par pièce : **Confort, Éco, Nuit et Absent**.
- **Pièces → Ajouter une vanne** : choisir une entité climate et le nom de la pièce. Ajout/retrait pris en compte sans redémarrage.
- Mode **Planning** ou profil permanent pour chaque pièce, notamment Absent pour une chambre peu occupée.
- Consigne manuelle temporaire avec durée réglable et retour au planning ; échéance conservée après redémarrage.
- Liste de plannings sélectionnée dans les réglages, avec les noms d’entités de votre choix.
- Éditeur graphique des plages : choix du jour, début, fin, profil, copie vers d’autres jours, validation avant enregistrement.
- Bouton **Absent** pour toute la maison, avec la température Absent de chaque pièce.
- Coordination chaudière : une demande valide suffit ; temporisations, contrôle périodique, exclusions des vannes indisponibles et notifications.

Un radiateur de salle de bain reste ouvert et chauffe avec le circuit. Il ne nécessite pas d’entité de commande supplémentaire.

## Installation

Suivre le [guide V3](GUIDE-V3.md), y compris la migration depuis les anciens fichiers. Les [configurations V2](GUIDE-CHAUFFAGE.md) sont conservées pour référence, mais ne doivent pas commander le relais en parallèle.

Installer le dossier d’intégration et les deux ressources JavaScript, puis ajouter l’intégration et la carte depuis l’interface HA. Button Card et les anciens packages ne sont pas nécessaires à V3. Les commandes nécessitent un compte administrateur HA dans cette version.

| Fichier | Fonction |
|---|---|
| [Intégration](custom_components/ma_maison_chauffage/) | Registre persistant et coordination dynamique |
| [Carte dynamique](www/ma-maison-chauffage-card.js) | Accueil, gestion des pièces, profils et réglages |
| [Tableau de bord minimal](configuration/tableau-de-bord-dynamique.yaml) | Exemple facultatif ; ajout de carte possible depuis l’interface |
| [Éditeur de planning](configuration/chauffage-planning-card.js) | Carte personnalisée pour modifier les plages |

## État de validation et limites

La version 3 est testée localement : profils, temporisations, ajouts/retraits, doublons, redémarrage, stockage, droits et formulaires. Le registre est testé de zéro à cinquante pièces, et le pilote simulé avec vingt vannes. Elle reste à valider sur une installation HA réelle et une chaudière. Le stockage, les services HA et le DOM des formulaires sont simulés.

Retirer une pièce arrête sa gestion sans changer sa dernière consigne physique. Mettre la vanne sur OFF dans HA pour arrêter ce radiateur. Les associations et températures V2 doivent être reportées via l’interface ; l’import n’est pas automatique.

Les horaires sont communs aux pièces en mode Planning ; les températures sont propres à chaque pièce. Les profils permanents restent prioritaires. Les modifications physiques directement sur une TRV ne créent pas de dérogation dans ce pilote.

HA doit fonctionner pour envoyer les ordres. Ce projet ne fournit pas d’arrêt autonome du relais en cas de panne de HA, du réseau Zigbee ou de Zigbee2MQTT. Les détails des temporisations, des défauts et des essais matériels sont dans le guide.

Le projet ne reproduit pas l’anticipation thermique Netatmo, ses statistiques énergétiques ni son application complète. Il n’est affilié ni à Legrand, ni à Netatmo, ni à Sonoff.

## Développement et tests

Prérequis : Python 3.11+ et une version Node.js compatible avec la dépendance de test happy-dom. Depuis la racine du dépôt :

```sh
python -m pip install -r requirements-dev.txt
npm ci --ignore-scripts
python tests/test_dynamic.py
npm test
```

Tests de compatibilité des anciens fichiers V2 :

```sh
python tests/test_chauffage.py
node tests/test_dashboard.cjs
node tests/test_planning_card.cjs
```

Les tests vérifient notamment les priorités des quatre profils, les dérogations expirées après redémarrage, les temporisations chaudière, les références d’entités et les routes du tableau de bord. L’éditeur est testé pour les chevauchements, les conflits d’édition et les plages se terminant à 24:00.

Pour régénérer les anciens fichiers **V2 uniquement** :

```sh
python scripts/build_chauffage.py
```

Cette commande réécrit les anciens fichiers avec huit entités d’exemple. Elle ne configure pas la version 3. Les dépendances npm ne servent qu’aux tests ; elles ne sont pas nécessaires sur HA.

## Sources

- [Home Assistant — Schedule](https://www.home-assistant.io/integrations/schedule/)
- [Zigbee2MQTT — TRV-ZBT](https://www.zigbee2mqtt.io/devices/TRV-ZBT.html)
- [Zigbee2MQTT — MINI-ZBD](https://www.zigbee2mqtt.io/devices/MINI-ZBD.html)
- [Button Card](https://custom-cards.github.io/button-card/)

Les fichiers ne contiennent que des noms d’entités d’exemple. Ne pas y ajouter de jetons d’accès, mots de passe ou exports privés de Home Assistant.
