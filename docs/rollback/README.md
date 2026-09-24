# Plans de retour arrière — migrations 0024/0025/0026

Ce dossier contient les plans de retour arrière pour les 3 migrations de sécurité de la Phase 10C (`0024_dedup_search_and_rate_limit.sql`, `0025_protect_company_contacts.sql`, `0026_secure_company_publication.sql`). **Testé de bout en bout sur `fcp-preprod` le 2026-09-24** (voir CHANGELOG.md pour le détail complet du test).

Ce document est autoportant : quelqu'un qui l'utilise en urgence (le propriétaire du projet, ou un agent) doit pouvoir le faire sans avoir accès à la conversation qui a produit ces fichiers.

## Ordre d'exécution — TOUJOURS le même, jamais un autre

1. `0026-complet.sql` (ou `0026-fonctions-avant.sql` pour la version partielle — voir plus bas)
2. `0025-protection-coordonnees.sql`
3. `0024-dedup-et-anti-rafale.sql`

**Pourquoi cet ordre et pas l'ordre inverse d'application (0024 puis 0025 puis 0026)** : `create_partnership_request()` n'a qu'une seule version vivante en base à la fois (`CREATE OR REPLACE FUNCTION`). La chaîne réelle est 0023 → 0024 → 0026 — ce qui tourne actuellement en base est la version 0026, pas 0024. Restaurer directement la version 0023 sans avoir d'abord défait 0026 écraserait silencieusement une partie de 0026 (la conversion des messages d'erreur en codes stables) sans que ce soit tracé nulle part. 0025 n'a aucune dépendance technique trouvée envers 0024 ou 0026 (elle touche `create_company()`/`submit_company_claim()`, jamais touchées par les deux autres) — l'ordre 0026 → 0025 → 0024 est suivi par prudence, pour rester dans l'ordre chronologique inverse de l'application réelle.

## Où exécuter ces scripts

**SQL Editor du tableau de bord Supabase du projet VISÉ** — jamais via un autre canal (ce projet n'a ni CLI liée, ni chaîne de connexion `postgres://` accessible à un agent ; voir l'en-tête de `0026-fonctions-avant.sql`).

**Avant de coller quoi que ce soit, vérifiez la référence de projet dans l'adresse de l'onglet Supabase ouvert :**

| Projet | Référence | À faire |
| --- | --- | --- |
| `fcp-preprod` (préproduction) | `eowveslvhbufomsdkhzt` | Seul projet où ces scripts ont été testés. Sûr pour rejouer le test. |
| Production | `exfhxhoragpphrksdcjf` | **Ne jamais coller ces scripts ici sans décision explicite et séparée.** Ce sont des opérations destructives (suppressions de table, de fonctions, de contraintes) — voir « Données perdues » dans l'en-tête de chaque fichier. |

Si l'adresse ne contient ni l'une ni l'autre référence, ce n'est ni la préprod testée ni la production connue — s'arrêter et vérifier avant toute exécution.

Coller **un fichier entier en une seule fois** (jamais morceau par morceau) : chaque script est une transaction unique — un échec de vérification interne (ex. l'étape 3 de `0025-protection-coordonnees.sql`) annule tout le script, y compris les étapes déjà exécutées. Un collage partiel casse cette garantie.

## Requête de vérification des contacts (0025)

`0025-protection-coordonnees.sql` recopie `company_contacts` vers `companies.professional_email`/`phone` puis vérifie automatiquement chaque ligne avant de continuer (le script s'arrête tout seul en cas d'écart). Pour vérifier manuellement, avant ou après avoir lancé le script — tant que `company_contacts` existe encore — cette requête ne doit renvoyer AUCUNE ligne :

```sql
select cc.company_id, cc.professional_email, cc.phone,
       c.professional_email as companies_professional_email,
       c.phone as companies_phone
from public.company_contacts cc
join public.companies c on c.id = cc.company_id
where c.professional_email is distinct from cc.professional_email
   or c.phone is distinct from cc.phone;
```

- Avant le retour arrière : une ligne renvoyée ici est normale (les valeurs vivent dans `company_contacts`, `companies` les a à `NULL` par construction depuis 0025) — sert surtout à voir combien de lignes seraient concernées.
- Juste après l'exécution de `0025-protection-coordonnees.sql` (donc après recopie, avant que le script ne supprime `company_contacts` à sa toute dernière étape) : doit renvoyer 0 ligne — c'est exactement ce que l'étape 3 du script vérifie déjà en interne.

## Fichiers de ce dossier

| Fichier | Contenu |
| --- | --- |
| `0024-dedup-et-anti-rafale.sql` | Retour arrière complet de 0024. Aucune perte de données. |
| `0025-protection-coordonnees.sql` | Retour arrière complet de 0025, sans perte de données (recopie + vérification avant suppression). |
| `0026-complet.sql` | Retour arrière **complet** de 0026 — supprime aussi `company_publication_requests` et ses 4 fonctions. **Perte de données réelle** : tout l'historique des demandes de publication. |
| `0026-fonctions-avant.sql` | Retour arrière **partiel** de 0026 (antérieur à `0026-complet.sql`, conservé tel quel) — restaure les 3 objets redéfinis par 0026 SANS supprimer `company_publication_requests` ni ses 4 fonctions. À préférer si l'objectif est seulement de rouvrir temporairement l'ancien comportement de `create_partnership_request()`/`companies_insert_authenticated`/`protect_companies_platform_fields()` sans perdre l'historique des publications. |

Tous reconstruits depuis le texte des migrations déjà commitées (`supabase/migrations/`), jamais depuis une introspection de la production — voir l'en-tête de chaque fichier pour le détail des données perdues et des failles de sécurité rouvertes.

## Après un retour arrière réel

1. Vérifier que l'application fonctionne toujours avec le comportement restauré (voir les notes « IMPORTANT après exécution » dans `0026-complet.sql`/`0026-fonctions-avant.sql` sur `RequestPartnershipButton.tsx`).
2. Pour revenir à l'état normal : réappliquer les migrations **originales**, dans l'ordre `supabase/migrations/0024_dedup_search_and_rate_limit.sql` → `0025_protect_company_contacts.sql` → `0026_secure_company_publication.sql` (jamais les fichiers de ce dossier).
3. Relancer `npm run test:integration` (contre `fcp-preprod` uniquement, jamais la production — voir `tests/integration/setup.ts`) et confirmer que la suite est verte avant de considérer l'incident clos.
