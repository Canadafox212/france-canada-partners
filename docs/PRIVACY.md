# Confidentialité — brouillon technique interne

> **Ce document n'est pas un avis juridique et n'est pas la politique de confidentialité publiée sur le site.** Il documente les choix techniques faits pour rendre la conformité RGPD/Loi 25 possible. Une validation par un professionnel du droit reste nécessaire avant le lancement commercial, notamment pour la rédaction de la politique publique et l'évaluation des facteurs relatifs à la vie privée (Loi 25).

Le détail des tables et de l'architecture de confidentialité est dans `PROJECT_SPEC.md` §9.1. Ce fichier sert à centraliser les informations concrètes qui devront être tenues à jour.

## Localisation principale des données

- Base de données et authentification : Supabase, région **Canada Central (`ca-central-1`)**.
- Hébergement de l'application (Next.js) : à déterminer (ex. Vercel) — **à documenter ici dès que choisi**, avec sa propre région.

## Données personnelles envisagées

| Donnée                        | Table                              | Nature                           |
| ----------------------------- | ----------------------------------- | -------------------------------- |
| Adresse courriel de connexion | `auth.users` (géré par Supabase Auth, jamais dupliqué) | Identifiant de compte |
| Nom complet                   | `profiles.full_name`                | Personnel                        |
| Consentements                 | `user_consents` _(pas encore construite)_ | Personnel (lié à un utilisateur) |
| Demandes RGPD/Loi 25          | `data_subject_requests` _(pas encore construite)_ | Personnel (lié à un utilisateur) |

Il n'existe pas de table `public.users` dans ce projet : l'identité
applicative d'un utilisateur (au-delà de ce que Supabase Auth gère déjà
dans `auth.users`) vit dans `public.profiles` (relation 1:1 stricte,
`profiles.id = auth.users.id`).

Tout le reste (nom d'entreprise, courriel professionnel générique, téléphone d'entreprise, adresse commerciale) est traité comme donnée **professionnelle**, pas personnelle — voir le principe de séparation en tête de `PROJECT_SPEC.md` §4.

## Import de données de sourcing (Phase 8 — état réel)

Un pipeline d'import **contrôlé** est construit et a été exécuté
réellement pour un lot pilote de 13 entreprises françaises (voir
`docs/IMPORT_PIPELINE.md`). Les principes retenus pour la confidentialité
restent ceux actés dès l'audit :

- **Provenance et licence tracées** : chaque entreprise importée
  conserve sa source, sa licence et la date de vérification
  (`data_sources`, `company_source_records`) — voir `docs/DATA_SOURCES.md`.
  Un import n'est possible que depuis une source dont la licence
  autorise explicitement l'usage commercial (garde-fou appliqué au
  niveau de la base de données, pas seulement de l'application).
- **Zone de préparation (`staging_companies`)** : chaque ligne source est
  d'abord chargée dans une table de travail, jamais directement dans
  `companies` — voir `data/README.md`.
- **Statut `draft` par défaut** : une entreprise importée n'est jamais
  publique par défaut. Elle reste invisible du public tant qu'un
  administrateur ne la publie pas explicitement, entreprise par
  entreprise (voir `docs/DIRECTORY.md`).
- **Revendication** : une entreprise importée reste `UNCLAIMED` ;
  son représentant légitime peut la revendiquer (`company_claims`,
  voir `docs/CLAIMING.md`), après quoi son contenu est protégé contre
  tout écrasement par un futur import.
- **Publication sélective** : le passage de `draft` à `active` (visible
  publiquement) est une décision humaine distincte de l'import
  lui-même, prise au cas par cas.
- **Données personnelles traitées avec prudence** : les colonnes
  identifiées lors de l'audit comme potentiellement personnelles (noms
  de dirigeants/responsables, adresses courriel **nominatives** du type
  `prenom.nom@...`, par opposition aux adresses génériques
  `info@`/`contact@`) ne sont jamais copiées vers une table publique.
  Seule une adresse courriel **générique** (classée automatiquement,
  voir `docs/IMPORT_PIPELINE.md` §5) peut être publiée ; une adresse
  nominative resterait au mieux en usage interne (staging), jamais
  affichée publiquement par défaut.

Ce mécanisme reste un import **contrôlé et limité** (lot pilote de 13
entreprises, décision entreprise par entreprise) — pas un import de masse
automatisé. Aucune donnée québécoise n'a été importée à ce jour, faute de
source dont la licence couvre explicitement un usage commercial.

## Principe de minimisation

On ne demande, à l'inscription, que ce qui est strictement nécessaire pour créer un compte (courriel, nom). Toute information supplémentaire est liée à l'entreprise, pas à la personne.

## Sous-traitants ("subprocessors")

| Sous-traitant              | Rôle                                                    | Région                  |
| -------------------------- | ------------------------------------------------------- | ----------------------- |
| Supabase                   | Base de données, authentification, stockage de fichiers | Canada (`ca-central-1`) |
| _(à déterminer)_           | Hébergement de l'application                            | _(à déterminer)_        |
| _(à déterminer, Phase 3+)_ | Envoi de courriels transactionnels                      | _(à déterminer)_        |
| _(à déterminer, post-MVP)_ | Paiement (Stripe)                                       | _(à déterminer)_        |

Cette liste doit être mise à jour à chaque nouveau service tiers intégré, et reflétée dans la politique de confidentialité publique.

## Transferts internationaux à examiner

Toute donnée d'un utilisateur ou d'une entreprise **française/européenne** traitée par un service hébergé au Canada constitue un transfert international au sens du RGPD. Ce point doit être formellement couvert (ex. clauses contractuelles types côté fournisseur) avant le lancement commercial en France — **à valider avec un conseil juridique**, pas par ce document.

## Conservation des données (à définir avant la mise en production)

Durées de conservation à trancher avec le propriétaire du projet, par exemple :

- Compte utilisateur inactif : suppression ou anonymisation après [durée à définir].
- Demande RGPD/Loi 25 traitée : conservation de la preuve de traitement pendant [durée à définir].

## Obligations à valider avant la mise en production

- [ ] Rédaction et publication de la politique de confidentialité (langage clair, FR/EN).
- [ ] Bandeau de consentement aux cookies non essentiels.
- [ ] Procédure documentée de traitement d'une demande d'accès/rectification/suppression/export (`data_subject_requests`).
- [ ] Vérification des clauses de transfert international avec chaque sous-traitant.
- [ ] Décision sur la durée de conservation par type de donnée.
- [ ] Revue juridique globale (RGPD + Loi 25) avant le lancement commercial.
