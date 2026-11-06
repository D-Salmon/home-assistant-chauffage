# Historique

## 3.2.8 — 6 novembre 2026

- Force le rechargement des modules de carte à chaque version pour éviter qu’un navigateur conserve une ancienne carte après mise à jour.


## 3.2.7 — 6 novembre 2026

- Ajoute un nom de maison configurable dans les options de l’intégration.
- Affiche le nombre de vannes en demande et anime l’icône des pièces qui chauffent.


## 3.2.6 — 6 novembre 2026

- Renomme « Repos minimal du relais » en « Délai minimal avant relance du chauffage ».


## 3.2.5 — 6 novembre 2026

- Renomme le délai de surveillance en « depuis la dernière communication avec la vanne ».


## 3.2.4 — 6 novembre 2026

- Accepte les horaires saisis avec l’heure seule, par exemple `7`, et les normalise en `07:00`.
- Affiche des exemples de saisie dans les champs Début et Fin des plages.

## 3.2.3 — 6 novembre 2026

- Renomme le réglage du dernier contact pour préciser qu’il s’agit de la dernière communication de la vanne.
- Place les textes d’aide de la carte derrière un bouton « ? », visible au besoin.


## 3.2.2 — 6 novembre 2026

- Explications dans les réglages sur l’anticipation et le capteur extérieur, ainsi que sur les quatre temporisations chaudière (confirmation, arrêt, repos du relais et ancienneté du dernier contact).

## 3.2.1 — 6 novembre 2026

- URL Lovelace stable sans numéro de version ; les fichiers de cartes ne reçoivent plus le cache d’un mois après redémarrage HA.
- Le guide demande de remplacer une ancienne ressource versionnée une dernière fois, puis la ressource restera permanente.
- Ajout de l’icône de l’intégration dans ses fichiers de marque Home Assistant, aux formats 256 et 512 pixels.

## 3.2.0 — 6 novembre 2026

- Apprentissage glissant individuel par pièce des vitesses de chauffe et de refroidissement, conservé lorsque le chauffage est désactivé.
- Anticipation de montée de consigne et arrêt anticipé avant les transitions vers un profil plus frais, avec capteur extérieur facultatif.
- Pause d’une pièce par entité `binary_sensor`, `input_boolean` ou `switch`, active tant que l’entité est à `on`.
- Réglage dans l’interface de l’apprentissage sur 7 ou 14 jours ; actualisation des cartes embarquées et guide HACS.

## 3.1.2 — 6 novembre 2026

- Reconstruit les cartes embarquées avec le contraste corrigé et les effets de survol ; nouvelle version d’URL pour invalider le cache du navigateur.
- Accentue l’éclairage, l’ombre et le léger déplacement au survol ; focus clavier visible.

## 3.1.0 — 6 novembre 2026

- Installation depuis HACS comme dépôt personnalisé de type Intégration ; Home Assistant 2025.7 minimum déclaré.
- Cartes de chauffage et de planning embarquées dans le dossier de l’intégration.
- Chargement automatique des cartes, sans copie dans `www` ni ajout manuel de ressources de tableau de bord.
- Guide de première installation HAOS/HACS et lien direct vers le dépôt dans HACS.
- Tests de cohérence du paquet, d’enregistrement, de rechargement et de préservation des autres modules frontend.
- Tests locaux réussis ; installation réelle via HACS et essais sur chaudière restant à effectuer.

## 3.0.0 — 6 novembre 2026

- Intégration locale avec registre persistant de pièces.
- Ajout, modification et retrait de vannes depuis la carte, sans noms d’entités codés en dur.
- Une seule liste utilisée pour le tableau de bord, les températures et la coordination chaudière.
- Quatre profils par pièce et dérogations avec échéance conservée.
- Sélection des assistants Planning et du relais depuis les réglages.
- Contrôle des droits administrateur et des modifications concurrentes.
- Envois aux vannes en arrière-plan, arrêt chaudière indépendant de cette file.
- Guide de migration V2 → V3. Les anciens fichiers sont conservés mais ne doivent pas être exécutés en parallèle.
- Tests de logique, du pilote HA simulé et des formulaires dans un DOM simulé. Validation sur matériel restant à effectuer.

## 2.0.0

- Configurations YAML pour huit vannes, quatre profils par pièce et éditeur de planning.
