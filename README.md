# Ma maison — Chauffage Home Assistant

**Version 3.2.6 : horaires simples dans l’éditeur de plannings, anticipation adaptative, pause par pièce et URL permanente pour la carte Lovelace.**

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
- Anticipation de chauffe et d’arrêt selon l’inertie apprise séparément pour chaque pièce, sur 7 ou 14 jours glissants. Les données sont conservées à l’arrêt et un capteur extérieur peut affiner les comparaisons.
- Pause par pièce avec un capteur d’ouverture, un interrupteur d’aide ou un switch : la pièce est suspendue tant que l’entité est active.

Un radiateur de salle de bain reste ouvert et chauffe avec le circuit. Il ne nécessite pas d’entité de commande supplémentaire.

## Installation

Sur Home Assistant **2025.7 ou ultérieur**, avec HACS installé :

1. [Ouvrir le dépôt dans HACS](https://my.home-assistant.io/redirect/hacs_repository/?owner=D-Salmon&repository=home-assistant-chauffage&category=integration), puis télécharger **Ma maison - Chauffage**. Autre chemin : HACS → Dépôts personnalisés → URL de ce dépôt → type Intégration.
2. Redémarrer HA, puis ajouter l’intégration **Ma maison - Chauffage** dans Appareils et services.
3. Dans **Paramètres → Tableaux de bord → ⋮ → Ressources**, ajouter `/ma-maison-chauffage-assets/bootstrap.js` comme **Module JavaScript**. Cette URL ne change plus lors des mises à jour.
4. Recharger la page et ajouter la carte. Si elle n’est pas listée, choisir **Manuel** et saisir `type: custom:ma-maison-chauffage-card`. Choisir ensuite le relais, les plannings et les vannes.

Les deux cartes sont téléchargées avec l’intégration. La ressource JavaScript doit être déclarée une fois dans le tableau de bord ; aucun fichier n’est à copier. Button Card et les anciens packages ne sont pas nécessaires. Les commandes nécessitent un compte administrateur HA dans cette version.

Le [guide d’installation détaillé](GUIDE-V3.md) couvre aussi l’installation de HACS sur HAOS, la création des plannings et l’installation manuelle. **Première installation : aucune migration à faire.** Les [configurations V2](GUIDE-CHAUFFAGE.md) sont conservées pour référence, mais ne doivent pas commander le relais en parallèle.

| Fichier | Fonction |
|---|---|
| [Intégration](custom_components/ma_maison_chauffage/) | Registre persistant et coordination dynamique |
| [Cartes embarquées](custom_components/ma_maison_chauffage/assets/) | Fichiers installés et chargés automatiquement avec l’intégration |
| [Carte dynamique](www/ma-maison-chauffage-card.js) | Accueil, gestion des pièces, profils et réglages |
| [Tableau de bord minimal](configuration/tableau-de-bord-dynamique.yaml) | Exemple facultatif ; ajout de carte possible depuis l’interface |
| [Éditeur de planning](configuration/chauffage-planning-card.js) | Carte personnalisée pour modifier les plages |

## État de validation et limites

Les versions 3.0 à 3.1 ont été testées localement pour les profils, temporisations, ajouts/retraits, stockage, droits et formulaires. La version 3.2 ajoute l’apprentissage, l’anticipation et la pause par pièce ; ces nouvelles fonctions nécessitent une validation sur une installation HA réelle avant usage avec la chaudière. Le stockage, les services HA et le DOM des formulaires sont simulés dans les tests locaux.

Retirer une pièce arrête sa gestion sans changer sa dernière consigne physique. Mettre la vanne sur OFF dans HA pour arrêter ce radiateur. Les associations et températures V2 doivent être reportées via l’interface ; l’import n’est pas automatique.

Les horaires sont communs aux pièces en mode Planning ; les températures sont propres à chaque pièce. Les profils permanents restent prioritaires. Les modifications physiques directement sur une TRV ne créent pas de dérogation dans ce pilote.

HA doit fonctionner pour envoyer les ordres. Ce projet ne fournit pas d’arrêt autonome du relais en cas de panne de HA, du réseau Zigbee ou de Zigbee2MQTT. Les détails des temporisations, des défauts et des essais matériels sont dans le guide.

L’anticipation de cette intégration apprend les variations de température observées par chaque pièce ; elle ne reproduit pas l’apprentissage propriétaire Netatmo. Le projet n’est affilié ni à Legrand, ni à Netatmo, ni à Sonoff.

## Développement et tests

Prérequis : Python 3.11+ et une version Node.js compatible avec la dépendance de test happy-dom. Depuis la racine du dépôt :

```sh
python -m pip install -r requirements-dev.txt
npm ci --ignore-scripts
python tests/test_dynamic.py
python tests/test_frontend_bundle.py
npm test
```

Tests de compatibilité des anciens fichiers V2 :

```sh
python tests/test_chauffage.py
node tests/test_dashboard.cjs
node tests/test_planning_card.cjs
```

Les tests vérifient notamment les priorités des quatre profils, les dérogations expirées après redémarrage, les temporisations chaudière, les références d’entités et les routes du tableau de bord. L’éditeur est testé pour les chevauchements, les conflits d’édition et les plages se terminant à 24:00. Les tests du paquet vérifient les cartes embarquées, leur version et leur enregistrement sans modifier les autres modules du frontend.

Après modification d’une carte source, régénérer les copies embarquées et les inclure dans le commit :

```sh
python scripts/build_frontend.py
python tests/test_frontend_bundle.py
```

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
