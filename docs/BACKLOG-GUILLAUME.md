# Backlog — workflow de Guillaume (imprononçable)

Tenu au fil des sessions réelles. Chaque ligne part d'un incident constaté, avec
sa date et la session où il est apparu.

## Lot 1 — session CUISTOTS du 27/09/2026 (fait, branche `guillaume/workflow-cuistots`)

| # | Constat | Correctif |
| --- | --- | --- |
| 1 | Tout export scripté (aperçu, recette dossier image, recette dossier personnalisé) échouait avec « Dossier de traitement non valide (-43) » alors que l'export depuis l'interface marchait. Seul point commun : l'emplacement de sortie de la session lu comme `/????`. | `explainProcessFailure` : l'erreur nomme la cause, dit si rien n'a été mis en file et renvoie vers `co_set_output_location`. |
| 2 | Chaque aperçu raté laissait une recette « MCP Preview <uuid> » dans la session client (3 le 27/09). | Si `co.process` lève et que la file est vide, la recette privée et le dossier temporaire sont supprimés. |
| 3 | Réparer l'emplacement de sortie demandait un clic droit dans la bibliothèque. | Nouvel outil `co_set_output_location` (dossier existant obligatoire, relu après écriture). |
| 4 | `co_select_variants` a sélectionné 9 photos sur 11 sans rien signaler : les 2 autres étaient masquées par le filtre « Note ★ ». | `notSelected` + `notSelectedReason` avec les filtres actifs. |
| 5 | `stillExists` disait vrai pour des exports disparus de `~/Pictures`. | Vérifié sur le disque (`co_variant_output_files`, `co_get_variant`). |

**À valider en vrai** (jamais sur une session client) : sur une session jetable,
casser l'emplacement de sortie, vérifier que `co_process_variants` renvoie le
nouveau message, le réparer avec `co_set_output_location`, vérifier que
l'export passe. C'est ce test qui confirmera l'hypothèse du point 1.

## Lot 2 — à faire

| # | Besoin | Idée |
| --- | --- | --- |
| 6 | Harmoniser des fonds sur une photo de référence : il a fallu des captures d'écran et des scripts Python à la main. | `co_measure_region` : rend l'aperçu sRGB, décode via `sips` (pas de dépendance), renvoie L*a*b* moyen d'une zone ou d'un masque « fond clair peu saturé », et l'écart à une variante de référence (ΔE2000, écart en IL). |
| 7 | Retrouver un visuel parmi 239 : planches contact faites à la main. | `co_contact_sheet` : planche JPEG d'un intervalle de numéros, sélection signalée. |
| 8 | Trous dans la numérotation (0061 introuvable). | `co_list_variants` : option `report_gaps` sur le compteur du nom de fichier. |
| 9 | Sens des curseurs vérifié sur la doc Capture One : teinte à gauche = vert, Kelvin à gauche = froid. | À écrire dans la description de `co_adjust_variants`. |
| 10 | Les vignettes du cache (`.cot`) ne sont pas toutes à jour : inutilisables comme mesure. | À noter dans la doc, ne jamais s'en servir comme référence. |
