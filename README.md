# Ma maison — Chauffage Home Assistant

Piloter huit vannes thermostatiques Sonoff TRV Gen2 avec Zigbee2MQTT et coordonner une chaudière équipée d’un relais à contact sec. Interface mobile inspirée de Home + Control, réalisée pour Home Assistant.

## Fonctionnalités

- Quatre températures indépendantes par pièce : **Confort, Éco, Nuit et Absent**.
- Mode **Planning** ou profil permanent pour chaque pièce, notamment Absent pour une chambre peu occupée.
- Consigne manuelle temporaire avec durée réglable et retour au planning ; échéance conservée après redémarrage.
- Trois plannings sélectionnables : Habituel, Télétravail, Vacances à la maison.
- Éditeur graphique des plages : choix du jour, début, fin, profil, copie vers d’autres jours, validation avant enregistrement.
- Bouton **Absent** pour toute la maison, avec la température Absent de chaque pièce.
- Coordination chaudière : une demande valide suffit ; temporisations, contrôle périodique, exclusions des vannes indisponibles et notifications.

Un radiateur de salle de bain reste ouvert et chauffe avec le circuit. Il ne nécessite pas d’entité de commande supplémentaire.

## Installation

Suivre le [guide complet](GUIDE-CHAUFFAGE.md), y compris les instructions de mise à jour depuis la première version.

Les fichiers à installer sont dans [configuration/](configuration/). Remplacer les entités d’exemple par celles de votre installation, installer Button Card et enregistrer la ressource JavaScript de l’éditeur de planning. Les trois assistants Planning se créent dans HA ; leurs plages se modifient ensuite dans le tableau de bord.

| Fichier | Fonction |
|---|---|
| [Blueprint chaudière](configuration/chauffage-trv-blueprint.yaml) | Coordination du relais selon les demandes des TRV |
| [Package chaudière](configuration/chauffage-trv-exemple.yaml) | Assistants et instance du blueprint |
| [Package planning](configuration/chauffage-planning-exemple.yaml) | Profils par pièce, absence et dérogations |
| [Tableau de bord](configuration/chauffage-tableau-de-bord.yaml) | Accueil, plannings, réglages et fiches des pièces |
| [Éditeur de planning](configuration/chauffage-planning-card.js) | Carte personnalisée pour modifier les plages |

## État de validation et limites

Cette configuration a été testée par simulations locales. Elle n’a pas encore été validée sur une installation réelle Home Assistant et une chaudière. Les tests de l’éditeur utilisent une API HA simulée ; ils ne constituent pas un test visuel dans HA.

Les horaires sont communs aux pièces en mode Planning ; les températures sont propres à chaque pièce. Les profils permanents restent prioritaires. Les modifications physiques directement sur une TRV ne créent pas de dérogation dans ce pilote.

HA doit fonctionner pour envoyer les ordres. Ce projet ne fournit pas d’arrêt autonome du relais en cas de panne de HA, du réseau Zigbee ou de Zigbee2MQTT. Les détails des temporisations, des défauts et des essais matériels sont dans le guide.

Le projet ne reproduit pas l’anticipation thermique Netatmo, ses statistiques énergétiques ni son application complète. Il n’est affilié ni à Legrand, ni à Netatmo, ni à Sonoff.

## Développement et tests

Prérequis : Python 3.11 ou supérieur et Node.js 20 ou supérieur. Depuis la racine du dépôt :

```sh
python -m pip install -r requirements-dev.txt
python tests/test_chauffage.py
node tests/test_dashboard.cjs
node tests/test_planning_card.cjs
```

Les tests vérifient notamment les priorités des quatre profils, les dérogations expirées après redémarrage, les temporisations chaudière, les références d’entités et les routes du tableau de bord. L’éditeur est testé pour les chevauchements, les conflits d’édition et les plages se terminant à 24:00.

Pour régénérer le package planning et le tableau de bord :

```sh
python scripts/build_chauffage.py
```

**Attention :** cette commande réécrit ces deux fichiers avec les entités d’exemple. Si vous maintenez votre installation dans ce dépôt, reportez vos personnalisations dans le générateur avant de l’exécuter. Le blueprint, sa configuration d’exemple et l’éditeur JavaScript sont maintenus directement dans `configuration/`.

## Sources

- [Home Assistant — Schedule](https://www.home-assistant.io/integrations/schedule/)
- [Zigbee2MQTT — TRV-ZBT](https://www.zigbee2mqtt.io/devices/TRV-ZBT.html)
- [Zigbee2MQTT — MINI-ZBD](https://www.zigbee2mqtt.io/devices/MINI-ZBD.html)
- [Button Card](https://custom-cards.github.io/button-card/)

Les fichiers ne contiennent que des noms d’entités d’exemple. Ne pas y ajouter de jetons d’accès, mots de passe ou exports privés de Home Assistant.
