# Architecture technique

Référence complète des décisions produit : voir `PROJECT_SPEC.md` à la racine. Ce document se concentre sur l'organisation concrète du code.

## Stack

- **Next.js 16** (App Router, TypeScript, React 19)
- **Tailwind CSS 4** (configuration "CSS-first" dans `src/app/globals.css`, pas de `tailwind.config.js`)
- **Supabase** (PostgreSQL, authentification, stockage) — région `ca-central-1`
- **next-intl** pour le bilingue FR/EN
- **Zod** pour la validation des entrées
- **Vitest** pour les tests unitaires

## Organisation des dossiers

```
src/
  app/
    [locale]/        toutes les pages du site (routage + segments d'URL par langue)
      layout.tsx      layout racine réel (html/body), fournit les traductions
      page.tsx         page d'accueil
      connexion/, inscription/, mot-de-passe-oublie/,
      reinitialiser-mot-de-passe/   pages d'authentification
      compte/          compte utilisateur + gestion des entreprises
        entreprises/nouvelle/, entreprises/[id]/
      not-found.tsx, error.tsx      pages d'erreur génériques
    globals.css        styles globaux + configuration Tailwind
    favicon.ico
  components/
    ui/                composants génériques (Button, FormField)
    layout/            Header (barre de navigation, conscient de la session)
    auth/              formulaires d'authentification (Client Components)
    account/           formulaire de profil, bouton de déconnexion
    companies/         formulaires et affichage liés à une entreprise (profil, produits/services, offres, besoins, membres)
  lib/
    env.ts             lecture + validation des variables d'environnement
    utils.ts            fonctions utilitaires pures (ex. slugify)
    companies.ts         repli de langue pour les descriptions d'entreprise
    offersNeeds.ts        composition automatique du titre d'une offre/d'un besoin
    supabase/
      client.ts          client Supabase pour le navigateur
      server.ts           client Supabase pour le code serveur
      session.ts           utilisateur/profil/entreprises courants (serveur uniquement)
  validations/         schémas Zod partagés entre formulaires (auth, entreprise, offre/besoin, communs)
  i18n/
    routing.ts          langues supportées, langue par défaut, segments d'URL traduits
    navigation.ts        Link/redirect/useRouter conscients de la langue
    request.ts            chargement des traductions par requête
  proxy.ts              routage de langue + rafraîchissement de session (avant chaque page)
messages/
  fr.json, en.json      textes d'interface traduits
tests/
  unit/                tests unitaires rapides et hors-ligne (Vitest)
  integration/          tests réels contre le vrai projet Supabase (voir docs/DATABASE.md)
scripts/
  seed-demo-data.mjs     jeu de données de démonstration (npm run seed:demo) — pas une migration
supabase/
  migrations/           migrations SQL (schéma + Row Level Security, voir docs/DATABASE.md)
data/
  raw/                  données brutes de sourcing, non versionnées (voir data/README.md)
docs/                   cette documentation
```

## Pourquoi `src/proxy.ts` et pas `middleware.ts` ?

Next.js 16 a renommé la convention `middleware.ts` en `proxy.ts` (le nom prêtait à confusion avec les middlewares Express.js). Le fichier joue le même rôle : il s'exécute avant chaque page pour rediriger vers la bonne langue (`/` → `/fr`).

## Pourquoi `next/root-params` pour la langue ?

Depuis Next.js 16.3, la langue (premier segment de route `[locale]`) peut être lue n'importe où côté serveur via `import { locale } from "next/root-params"`, sans avoir à la faire passer manuellement de composant en composant. C'est ce que `src/i18n/request.ts` et `src/app/[locale]/layout.tsx` utilisent.

## Authentification (en place depuis la Phase 3)

Côté base de données, l'identité repose sur `auth.users` (géré par Supabase) + une table `profiles` en relation 1:1 pour les données applicatives — voir `docs/DATABASE.md` et `PROJECT_SPEC.md` §4.1. Côté application : `src/lib/supabase/client.ts`/`server.ts` fournissent les clients, `src/lib/supabase/session.ts` expose `getCurrentUser()` (protection des pages, basé sur `getClaims()`), `getCurrentAuthUser()` (affichage, ex. statut de confirmation du courriel) et `getCurrentUserCompanies()`. `src/proxy.ts` rafraîchit la session à chaque requête, en plus du routage de langue.

## URLs traduites (`pathnames`)

`src/i18n/routing.ts` déclare des segments d'URL différents par langue (ex. `/connexion` en français, `/login` en anglais) via l'option `pathnames` de next-intl. Les fichiers du système de routage restent nommés en français (chemin "canonique") ; `Link`/`redirect`/`router.push` utilisent toujours ce chemin canonique, et next-intl affiche/route automatiquement vers la bonne URL localisée. Pour un chemin dynamique, passer un objet plutôt qu'une chaîne : `{ pathname: "/compte/entreprises/[id]", params: { id } }`.

## Conventions de nommage

- Fichiers de composants React : `PascalCase.tsx` (ex. `Button.tsx`)
- Fichiers utilitaires/logique : `camelCase.ts` (ex. `env.ts`, `utils.ts`)
- Dossiers : `kebab-case` ou un seul mot en minuscules
- Clés de traduction : regroupées par page/section (ex. `HomePage.title`)
- Tables et colonnes de base de données : `snake_case` (voir `PROJECT_SPEC.md` §4)

## Gestion des erreurs

Les fonctions qui dépendent de configuration externe (ex. `getPublicEnv`/`getServerEnv` dans `src/lib/env.ts`) valident leurs entrées avec Zod et lancent une erreur explicite en français plutôt que de échouer silencieusement ou avec un message technique obscur.
