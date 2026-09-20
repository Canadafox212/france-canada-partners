# Annuaire public (Phase 7)

## 1. Ce qui est public

Une entreprise n'apparaît dans l'annuaire (recherche, fiche) que si
`companies.status = 'active'` — jamais `draft`, `suspended` ni `archived`.
Cette règle est appliquée à DEUX niveaux, comme pour tout le reste du
projet : la fonction `search_companies()` la filtre explicitement, ET la
RLS de `companies` (depuis la Phase 2) empêche de toute façon un visiteur
non membre de lire une ligne non active — même si un bug introduisait un
jour un oubli de filtre côté application, la RLS resterait le filet de
sécurité. Il n'existe pas de champ "entreprise explicitement privée"
distinct du statut : `status` est la seule source de vérité pour la
visibilité publique (voir PROJECT_SPEC.md §4.2).

Une entreprise importée sans propriétaire (voir docs/CLAIMING.md) est déjà
publique dès `status = 'active'`, avec une fiche minimale — c'est le
scénario visé par la future Phase 10 (import massif).

## 2. Recherche : plein texte PostgreSQL, pas de l'ILIKE naïf

`companies.search_vector` (tsvector, index GIN) agrège nom légal/commercial
(poids A), description (poids B), secteurs et produits/services (poids
B/C), titres des offres/besoins actifs (poids C). Recalculé par
déclencheur à chaque changement pertinent (voir migration 0017) — jamais
reconstruit à la volée pendant une recherche.

**Pourquoi le plein texte plutôt que `ILIKE '%terme%'`** : `ILIKE` avec un
joker en début de motif ne peut pas utiliser d'index B-tree classique et
dégénère en lecture séquentielle de toute la table à mesure que le volume
grandit (le projet vise 100 000+ entreprises à terme — voir PROJECT_SPEC.md
§0). Le plein texte PostgreSQL (`tsvector`/`tsquery` + index GIN) reste
performant à cette échelle.

**Insensibilité aux accents** (§36 : "Québec" et "Quebec" doivent être
traités de façon équivalente) : `unaccent()` est appliqué à la fois à
l'indexation (dans `refresh_company_search_vector()`) et à la recherche
(dans `search_companies()`), avec la configuration `simple` — pas
`french`, pour éviter que la racinisation linguistique déforme des noms
d'entreprise ou des codes de produits. Les filtres région/ville (`ILIKE`)
appliquent la même normalisation.

## 3. Filtres combinables

Tous les filtres (pays, région, ville, secteur, sous-secteur,
produit/service, type proposé, type recherché, marché cible, vérifiée,
opportunités actives) sont des paramètres de la fonction SQL
`search_companies()` — un seul aller-retour base de données, quel que soit
le nombre de filtres actifs simultanément. Chaque filtre est optionnel
(`null` = ignoré) et combinable librement (ET logique entre filtres).

## 4. Pagination

Approche "limit+1" plutôt qu'un `COUNT(*)` séparé : la fonction est
appelée avec `p_limit = taille_page + 1`, puis l'application tronque à
`taille_page` et déduit `hasNextPage` de la présence de cette ligne
supplémentaire. Évite un `COUNT(*)` potentiellement coûteux sur une grande
table pour un simple bouton "suivant" — voir `src/lib/directory/search.ts`.
L'URL conserve tous les paramètres de recherche/filtres/page (formulaire
GET natif, pas de soumission JavaScript) : partageable, rafraîchissable,
indexable quand pertinent (§5).

## 5. URLs géographiques et sectorielles

`/entreprises/[geoOrSlug]` sert DEUX rôles (voir le commentaire dans
`src/i18n/routing.ts`) : si le segment correspond à une zone connue
(`src/lib/directory/geoSlugs.ts` : `france`, `canada`, `quebec` — un
ensemble volontairement FIXE et restreint, jamais généré automatiquement),
c'est une entrée géographique dans l'annuaire ; sinon c'est un slug
d'entreprise. Next.js interdit deux noms de segment dynamique différents
au même niveau (`[slug]` et `[geo]` ne peuvent pas coexister) : la
désambiguïsation se fait donc dans la page, pas dans le routage.
`/entreprises/[geoOrSlug]/[industry]` combine zone + secteur (le premier
segment DOIT alors être une zone reconnue).

## 6. SEO des listes : `shouldIndexDirectoryPage()`

Centralisé dans `src/lib/directory/search.ts`. Une page de résultats n'est
indexée QUE si :

1. aucune recherche libre (texte arbitraire non pertinent pour un moteur
   de recherche) ;
2. au plus UN filtre "interactif" actif (ceux choisis via le formulaire —
   les segments d'URL géo/secteur, eux, sont des choix ÉDITORIAUX fixes,
   pas des combinaisons arbitraires, et ne comptent donc pas dans ce
   seuil) ;
3. au moins 5 résultats.

Ce choix évite d'indexer des millions de combinaisons quasi vides tout en
laissant les pages `/entreprises/france`, `/entreprises/quebec`,
`/entreprises/quebec/distribution` (etc.) être indexées normalement — ce
sont exactement les pages visées par les exemples du cahier des charges.
Pas de contenu éditorial dédié par combinaison de filtre cette phase
(aurait demandé une table supplémentaire) : simplification documentée,
à revisiter si le SEO de listes filtrées devient un levier prioritaire.

## 7. Fiche entreprise : ce qui est affiché publiquement

Nom, localisation (ville/région/pays — **jamais l'adresse complète avec
numéro de rue**, choix délibéré de confidentialité par défaut, voir §13 du
cahier des charges), description, site, secteur(s), produits/services,
langues de travail, certifications, statut vérifié, offres/besoins actifs,
opportunités actives. Le site web et le courriel professionnel affichés
sont ceux de `companies` (déjà conçus comme des coordonnées PROFESSIONNELLES
d'entreprise, jamais une adresse personnelle d'utilisateur).

Source et dernière vérification (§21) affichées uniquement si l'entreprise
n'a **jamais** été revendiquée (`companies.claimed_at is null`) : une fois
revendiquée, les informations proviennent potentiellement de l'entreprise
elle-même, pas uniquement de la source d'origine — les afficher resterait
trompeur.

## 8. Compatibilité sur la fiche publique : calcul ciblé, jamais de liste

`getCompatibilityBetweenCompanies()` (`src/lib/matching/service.ts`)
réutilise STRICTEMENT le moteur de la Phase 6 (`computeMatchScore`) —
aucun second algorithme de score. Appelée uniquement sur la fiche d'UNE
entreprise (comparaison ciblée entre deux entreprises précises), jamais
sur la liste de résultats de l'annuaire : afficher un score pour chacun
des 20 résultats d'une page reviendrait à recalculer des dizaines de
scores complexes à chaque clic, exactement ce que le cahier des charges
(§28) demande d'éviter. Le résultat est persisté dans `matches` comme
n'importe quel autre calcul du moteur (mêmes règles de sécurité, voir
docs/MATCHING.md et docs/SECURITY.md) — pas un score parallèle non
traçable. Utilisateur avec plusieurs entreprises : sélecteur simple
(`?compareWith=<id>`), le score dépend de l'entreprise choisie.

## 9. Ce qui n'a pas été construit cette phase (limites documentées)

- **Tri par compatibilité** dans la liste de résultats : nécessiterait de
  calculer un score pour chaque résultat de la page avant de pouvoir les
  trier, contraire à la stratégie de calcul ciblé du §8 — le badge de
  compatibilité par carte de résultat reste possible plus tard via un
  calcul groupé, non fait cette phase (voir aussi §28 du cahier des
  charges qui qualifie cette fonctionnalité d'"éventuelle").
- **Favoris** ("enregistrer l'entreprise") : la table `favorites` n'existe
  pas encore (prévue Phase 9, voir PROJECT_SPEC.md §16) — non construite
  ici, conformément à la condition explicite du cahier des charges ("si
  favorites existe déjà").
- **Logo d'entreprise** : aucun système de téléversement de fichiers
  (Supabase Storage) n'est configuré dans ce projet — non construit cette
  phase, la fiche fonctionne sans logo.
