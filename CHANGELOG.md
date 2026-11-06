# Historique

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
