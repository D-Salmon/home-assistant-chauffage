# Historique

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
