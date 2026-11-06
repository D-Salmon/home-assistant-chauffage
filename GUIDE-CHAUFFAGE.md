# Ma maison — Chauffage Home Assistant

Configuration préparée pour huit TRV Sonoff Gen2 avec Zigbee2MQTT et un relais chaudière à contact sec. Le radiateur de salle de bain reste toujours ouvert. Interface inspirée de Home + Control ; elle fonctionne dans Home Assistant et n’est pas une copie intégrale de l’application Legrand.

## Ce que vous pouvez faire

- Choisir **Habituel**, **Télétravail** ou **Vacances à la maison** dans une liste déroulante.
- Activer **Absent** juste à côté. Le planning choisi est conservé, mais les consignes passent à la température d’absence. Appuyer à nouveau rétablit le planning.
- Toucher une pièce, choisir une température et une durée, puis **Appliquer**. Une dérogation ne concerne que cette pièce. Durée initiale : trois heures, réglable de 30 minutes à 12 heures.
- Reprendre le planning d’une pièce avant l’échéance, ou de toutes les pièces depuis la page Plannings.
- Régler **Confort, Éco, Nuit et Absent** séparément pour chaque pièce.
- Maintenir une pièce sur un de ces quatre profils avec son sélecteur **Mode de la pièce**, ou choisir **Planning** pour suivre les horaires. Une chambre d’enfant peu occupée peut rester en Absent, par exemple à 13 °C, sans affecter les autres pièces.

Les horaires du planning sélectionné sont communs aux pièces en mode Planning. Chaque plage choisit un des quatre profils ; chaque pièce utilise sa propre température correspondante. Les quatre valeurs sont indépendantes : Absent peut être inférieur à Éco, et Nuit peut être supérieur ou inférieur à Éco. Un planning comprend les sept jours. Les profils permanents des pièces restent en place lors d’un changement de planning ou d’un aller-retour en absence de toute la maison.

## Créer et modifier visuellement les plages

Sur le tableau de bord, ouvrir **Plannings** :

1. Choisir le planning à **modifier** (Habituel, Télétravail ou Vacances à la maison). Ce choix d’édition ne change pas le planning **actif** de l’accueil.
2. Choisir un jour avec les boutons Lun → Dim.
3. Cliquer **Ajouter une plage**, saisir son début et sa fin en HH:MM, puis choisir **Confort / Éco / Nuit / Absent** dans la liste déroulante.
4. Modifier une plage existante ou la supprimer. Les heures non couvertes utilisent Éco.
5. Si nécessaire, ouvrir **Copier cette journée**, cocher les jours et cliquer **Remplacer les jours cochés**. Cette opération remplace leurs plages dans le brouillon.
6. Cliquer **Enregistrer**. Les modifications restent locales jusqu’à cette action ; **Annuler les modifications** recharge la dernière version enregistrée.

Exemple : Nuit de 00:00 à 06:30, Confort de 06:30 à 08:30, Éco de 08:30 à 17:00, Confort de 17:00 à 22:00, Nuit de 22:00 à 24:00. Couper une plage qui traverse minuit en deux plages sur les jours concernés. Les chevauchements et les durées négatives sont bloqués.

L’éditeur fourni modifie les trois assistants Planning créés à l’installation. Il permet de construire leurs journées à partir de zéro ; il ne crée pas de nouveaux programmes nommés au-delà de ces trois choix. Pour en ajouter un, créer un assistant Planning et compléter `planning_map`, les déclencheurs du pilote, les options de `input_select.chauffage_planning` et la liste `schedules` de la carte.

L’enregistrement nécessite les droits administrateur HA pour modifier ces assistants. Les interfaces de gestion HA utilisées par cette carte peuvent évoluer : les appels sont basés sur le [code du frontend HA](https://github.com/home-assistant/frontend/blob/dev/src/data/schedule.ts), mais doivent être validés sur votre version. Une modification concurrente détectée bloque l’écriture et demande un rechargement.

## Fichiers

| Fichier | Destination / rôle |
|---|---|
| `chauffage-trv-blueprint.yaml` | `/config/blueprints/automation/local/chauffage-trv-blueprint.yaml` : coordination chaudière |
| `chauffage-trv-exemple.yaml` | `/config/packages/chauffage_chaudiere.yaml` : assistants et instance du blueprint |
| `chauffage-planning-exemple.yaml` | `/config/packages/chauffage_planning.yaml` : plannings sélectionnables, absence et dérogations |
| `chauffage-tableau-de-bord.yaml` | Configuration brute d’un nouveau tableau de bord |
| `chauffage-planning-card.js` | `/config/www/chauffage-planning-card.js` : éditeur graphique de plages |

Le tableau de bord ne doit pas être placé dans le dossier `packages`. Le blueprint non plus.

## Installation

1. Remplacer les huit identifiants `climate.trv_salon`, `climate.trv_cuisine`, `climate.trv_chambre_1`, `climate.trv_chambre_2`, `climate.trv_chambre_3`, `climate.trv_bureau`, `climate.trv_entree`, `climate.trv_piece_8` et `switch.relais_chaudiere` par vos entités réelles, **dans les trois fichiers qui les utilisent**. La correspondance `valve_map` dans le package planning doit aussi être adaptée. Conserver les identifiants des assistants `input_*` pour commencer ; les noms visibles des pièces peuvent être modifiés librement dans le tableau de bord.
2. Installer **Button Card** (`custom:button-card`) via HACS, ou suivre son [installation officielle](https://custom-cards.github.io/button-card/). Copier aussi la carte fournie `chauffage-planning-card.js` dans `/config/www/`. Dans les ressources des tableaux de bord, ajouter `/local/chauffage-planning-card.js?v=2`, type **Module JavaScript**. Le menu Ressources peut nécessiter le mode avancé du profil HA. Recharger le navigateur après ajout. Le sélecteur de planning actif utilise une carte Tile native avec `select-options`.
3. Copier le blueprint à la destination ci-dessus. Si les packages ne sont pas déjà activés, ajouter à la section `homeassistant` existante de `configuration.yaml` :

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

   Fusionner avec la section existante plutôt que créer une seconde clé `homeassistant`. Copier les deux packages dans `/config/packages/`. Ne pas recopier ces mêmes assistants dans `configuration.yaml` et ne pas créer une deuxième instance de l’automatisation chaudière.
4. Vérifier la configuration depuis les outils développeur de HA, puis redémarrer HA. L’autorisation générale de chauffage est désactivée lors de sa première création ; son état sera ensuite restauré.
5. Dans **Paramètres → Appareils et services → Assistants**, créer trois assistants **Planning**. Vérifier leurs identifiants exacts :

   | Nom | Identifiant exigé | Exemple de plages Confort |
   |---|---|---|
   | Chauffage habituel | `schedule.chauffage_habituel` | Lun–ven 06:30–08:30 et 17:00–22:00 ; sam–dim 08:00–23:00 |
   | Chauffage télétravail | `schedule.chauffage_teletravail` | Lun–ven 07:00–22:00 ; sam–dim 08:00–23:00 |
   | Chauffage vacances maison | `schedule.chauffage_vacances_maison` | Chaque jour 08:00–23:00 |

   Ces plages sont facultatives : vous pouvez créer les trois assistants vides, puis construire leurs plages dans la page Plannings fournie. Les plages existantes sans profil restent interprétées comme Confort. Hors plage : Éco. « Vacances à la maison » est un planning de présence ; pour un départ, utiliser **Absent**.
6. Créer un **nouveau tableau de bord** dont l’URL est **`chauffage-maison`**. Ouvrir son éditeur de configuration brute, puis y copier tout `chauffage-tableau-de-bord.yaml`. Si vous choisissez une autre URL, remplacer tous les préfixes `/chauffage-maison/` dans ce fichier. Ne pas écraser votre tableau de bord existant.
7. Dans sa page **Réglages**, cliquer **Initialiser les températures**, avant d’activer le chauffage. Cette action unique renseigne pour chaque pièce 20 °C Confort, 17 °C Éco, 17 °C Nuit et 14 °C Absent, ainsi que 3 h de dérogation. Ce sont des valeurs de départ modifiables. Le bouton disparaît après initialisation. Les valeurs n’ont pas de `initial` fixe, afin de conserver ensuite vos réglages au redémarrage.
8. Vérifier chaque pièce et ajuster ses quatre températures. Activer **Chauffage autorisé** une fois les vérifications ci-dessous effectuées.

**Mise à jour depuis la première version :** désactiver Chauffage autorisé, remplacer le package planning et le tableau de bord en conservant vos identifiants d’entités, installer la nouvelle carte et redémarrer HA après validation de configuration. Dans Réglages, cliquer **Initialiser Nuit et Absent** : seules les nouvelles températures Nuit (17 °C) et Absent (14 °C) sont renseignées ; les anciennes températures Confort/Éco sont préservées. Ajuster puis réactiver. L’ancien assistant global `input_number.chauffage_absence` n’est plus utilisé. Les plannings existants sans profil restent compatibles.

La configuration vise une version récente de HA disposant de la fonctionnalité de carte `select-options`. Si votre version ne la propose pas, mettre HA à jour ou remplacer cette carte par une carte Entities contenant `input_select.chauffage_planning`.

## Régulation et priorités

**Arrêt général → Absent de toute la maison → profil permanent de la pièce → dérogation temporaire → planning.**

- Arrêt général : demande de relais OFF, aucun nouvel envoi de consigne aux vannes par le planning. Il ne faut pas le confondre avec un mode hors gel.
- Absent de toute la maison : applique la température Absent propre à chaque pièce, sans arrêt forcé de la chaudière. Le bouton ne réactive pas un chauffage arrêté. Les nouvelles dérogations sont refusées tant qu’Absent est actif.
- Profil permanent d’une pièce : maintient Confort, Éco, Nuit ou Absent jusqu’à un nouveau choix. Les autres pièces continuent normalement. Une consigne temporaire n’est disponible que si la pièce est en mode Planning. Le changement de mode de pièce annule sa dérogation ; Reprendre le planning remet ce sélecteur sur Planning.
- Entrée/sortie d’Absent ou changement de planning : les anciennes dérogations sont annulées. Pas de réactivation surprise d’une ancienne consigne au retour.
- Dérogation : la température temporaire reste prioritaire même si une plage horaire change. Elle expire à la date mémorisée ; le planning alors en vigueur reprend. Le bouton collectif Annuler les consignes temporaires conserve les profils permanents des pièces.
- Redémarrage : les échéances et consignes sont restaurées. Une dérogation déjà expirée ne redémarre pas. Les automatismes réévaluent la situation toutes les 15 secondes.
- Modifier un champ « Nouvelle consigne » prépare la valeur ; **Appliquer** la valide. La durée choisie sert aux prochaines dérogations et ne modifie pas celles déjà actives.
- Le planning utilise le mode **heat** des TRV : la consigne vient de HA. Le mode **auto** utiliserait leur programme interne. Activer `smart_temperature_control` dans Zigbee2MQTT pour la régulation PID locale souhaitée.
- Une modification directement sur la vanne ou dans sa fenêtre climate native est réécrite par le pilote HA. Pour une dérogation conservée, utiliser la fiche de pièce fournie. Cette version ne détecte pas les modifications physiques comme des dérogations temporaires.

Le tableau de bord affiche la température et la consigne **remontées par la vanne**. Un petit délai de transmission est donc normal après Appliquer. « En chauffe » correspond à `hvac_action: heating`, pas à une mesure de flamme de la chaudière. Le bandeau indique l’état de demande du relais.

## Coordination chaudière

Une demande valide d’une seule TRV suffit. La salle de bain n’entre pas dans le calcul : elle reçoit simplement la chaleur lorsque le circuit fonctionne. Ne pas ajouter une neuvième fausse entité climate.

Valeurs de départ : confirmation de demande **30 s**, absence de demande avant arrêt **30 s**, repos minimal du relais **180 s**. Le contrôle toutes les 15 s peut ajouter jusqu’à environ 15 s. Ces paramètres sont à adapter au fonctionnement réel de la chaudière ; ils ne mesurent pas ses cycles internes de brûleur. Aucun minimum de marche n’est imposé après disparition des demandes.

Une vanne indisponible ou sans `hvac_action` exploitable est exclue. Les autres demandes continuent de compter. S’il n’y a plus de demande valide et qu’une vanne est en défaut, arrêt demandé sans attendre le délai d’arrêt. Une notification persistante apparaît dans HA.

Trois commandes espacées d’au moins 15 secondes sont tentées en cas de relais non confirmé. Après trois échecs, une notification demande une intervention. Après correction, **recharger les automatisations** pour relancer les tentatives. L’état rapporté du relais ne prouve pas une fermeture physique du contact.

Activer et vérifier la disponibilité des appareils dans Zigbee2MQTT. Par défaut, les appareils sur batterie peuvent rester considérés disponibles longtemps sans message. Le dictionnaire optionnel `last_seen_map` du blueprint permet un contrôle supplémentaire par date de dernier message : renseigner les huit correspondances vers des capteurs ISO 8601 et ajuster le délai après observation des remontées. Laisser `{}` désactive ce contrôle. Un dernier message récent ne garantit pas que chaque attribut, dont `hvac_action`, est récent.

Si un planning est absent ou indisponible, aucune consigne issue de ce planning n’est envoyée ; la dernière consigne de la vanne reste en place. Une absence, un profil permanent ou une dérogation valide peut toujours fournir une consigne. Un profil de plage invalide est également ignoré. Vérifier impérativement les trois assistants Planning avant activation.

**Limite de disponibilité :** cette configuration ne fournit pas d’arrêt autonome du relais si HA, Zigbee2MQTT ou le coordinateur tombe en panne. Les TRV continuent leur régulation locale sur leur dernière consigne ; le relais peut rester dans son dernier état. Un éventuel mécanisme de coupure autonome du module doit être vérifié sur le matériel et n’est pas implémenté ici. Régler et tester le comportement du relais au retour d’alimentation, notamment `power_on_behavior: off` si exposé.

## Vérification sur votre installation

Les fichiers ont fait l’objet d’une validation YAML, de compilation des expressions et de simulations locales des décisions. Ils n’ont pas été chargés dans votre HA ni testés avec votre chaudière. L’aperçu graphique présente des données de démonstration ; ce n’est pas une capture d’une installation réelle.

1. Dans les outils développeur, vérifier les huit `climate.*` et les attributs `current_temperature`, `temperature`, `hvac_action`. Vérifier que `heating` apparaît lors d’une demande, puis `idle` ou `off` à son arrêt.
2. Vérifier les trois plannings, le relais et les assistants sans valeur inconnue.
3. Tester une demande d’une pièce seule, puis sa disparition. Observer les temporisations et le radiateur de salle de bain.
4. Tester une dérogation courte et son annulation ; modifier son échéance dans les outils développeur pour tester l’expiration sans attendre.
5. Tester Absent / retour et le changement de planning : les dérogations doivent s’annuler. Une chambre en Absent permanent doit rester sur ce profil ; les autres pièces suivent les plages. Tester une plage Nuit et vérifier que les températures Nuit propres aux pièces sont utilisées.
6. Redémarrer HA pendant une dérogation, puis tester une échéance dépassée pendant l’arrêt. Vérifier le retour au planning.
7. Vérifier les réactions à une TRV indisponible, au relais indisponible et à l’arrêt général. Consulter les traces des automatisations et les notifications.

## Périmètre de la ressemblance avec Home + Control

Inclus : vue par pièce, quatre températures par pièce, profil permanent de pièce, plannings sélectionnables, éditeur de plages avec copie de journées, absence de toute la maison, dérogations temporaires et reprise automatique. Non inclus : anticipation thermique Netatmo, statistiques énergétiques, géolocalisation, programmation d’une date de retour d’absence, fonction hors gel séparée, et copie exacte de l’éditeur graphique Legrand.

Sources techniques : [Planning HA](https://www.home-assistant.io/integrations/schedule/), [échéances persistantes](https://www.home-assistant.io/integrations/input_datetime/), [TRV-ZBT Zigbee2MQTT](https://www.zigbee2mqtt.io/devices/TRV-ZBT.html), [MINI-ZBD](https://www.zigbee2mqtt.io/devices/MINI-ZBD.html), [disponibilité Zigbee2MQTT](https://www.zigbee2mqtt.io/guide/configuration/device-availability.html), [Button Card](https://custom-cards.github.io/button-card/), [consignes manuelles Home + Control](https://helpcenter.netatmo.com/hc/en-us/articles/32826998306578-Will-my-products-still-work-if-my-internet-Wi-Fi-goes-down-or-if-there-is-a-power-cut).
