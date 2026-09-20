/**
 * Complétude et activation d'une fiche entreprise (Phase 10C) — deux
 * notions volontairement distinctes, jamais fusionnées (décision explicite
 * du propriétaire du projet) :
 *
 * - COMPLÉTUDE : un pourcentage (0/25/50/75/100) sur 4 critères à parts
 *   égales, purement informatif.
 * - ACTIVATION : un booléen strict. Une fiche à 75 % de complétude peut
 *   très bien être NON activée si le critère manquant est justement
 *   "au moins une offre ou un besoin actif" — condition sans laquelle
 *   aucun match n'est mathématiquement possible (voir Phase 9, régression
 *   "aucune offre + aucun besoin ⇒ aucun score").
 *
 * Fonctions pures, aucun accès base — les données sont déjà chargées par
 * la page appelante (mêmes principes que src/lib/import/dedup.ts).
 */

export interface CompanyCompletenessInput {
  hasDescription: boolean;
  hasIndustry: boolean;
  hasLocation: boolean;
  hasActiveOfferOrNeed: boolean;
}

export type CompletenessCriterionKey =
  | "description"
  | "industry"
  | "location"
  | "offerOrNeed";

export interface CompanyCompleteness {
  percent: 0 | 25 | 50 | 75 | 100;
  criteria: Record<CompletenessCriterionKey, boolean>;
}

const CRITERIA_ORDER: CompletenessCriterionKey[] = [
  "description",
  "industry",
  "location",
  "offerOrNeed",
];

export function computeCompanyCompleteness(
  input: CompanyCompletenessInput,
): CompanyCompleteness {
  const criteria: Record<CompletenessCriterionKey, boolean> = {
    description: input.hasDescription,
    industry: input.hasIndustry,
    location: input.hasLocation,
    offerOrNeed: input.hasActiveOfferOrNeed,
  };
  const metCount = CRITERIA_ORDER.filter((key) => criteria[key]).length;
  return {
    percent: ((metCount * 100) / CRITERIA_ORDER.length) as
      | 0
      | 25
      | 50
      | 75
      | 100,
    criteria,
  };
}

export interface CompanyActivationInput extends CompanyCompletenessInput {
  /**
   * "Revendiquée" au sens de ce calcul = a au moins un membre owner/admin
   * actif — PAS `companies.claimed_at IS NOT NULL`. Une entreprise
   * auto-créée (create_company(), Phase 3) a un owner dès sa création mais
   * `claimed_at` reste NULL indéfiniment (elle ne passe jamais par le
   * workflow company_claims, voir Phase 9 — gap documenté). Utiliser
   * claimed_at ici empêcherait à tort toute entreprise auto-créée
   * d'atteindre l'activation, ce qui contredirait la stratégie
   * d'acquisition Québec (Phase 10B), fondée sur l'inscription volontaire.
   */
  isClaimed: boolean;
}

export type ActivationCriterionKey = "claimed" | CompletenessCriterionKey;

export interface CompanyActivation {
  isActivated: boolean;
  /** Critères manquants, dans un ordre stable — vide si isActivated est true. */
  missingCriteria: ActivationCriterionKey[];
}

export function computeCompanyActivation(
  input: CompanyActivationInput,
): CompanyActivation {
  const missingCriteria: ActivationCriterionKey[] = [];
  if (!input.isClaimed) missingCriteria.push("claimed");
  if (!input.hasDescription) missingCriteria.push("description");
  if (!input.hasIndustry) missingCriteria.push("industry");
  if (!input.hasLocation) missingCriteria.push("location");
  if (!input.hasActiveOfferOrNeed) missingCriteria.push("offerOrNeed");

  return {
    isActivated: missingCriteria.length === 0,
    missingCriteria,
  };
}

/**
 * Checklist d'activation affichée sur /compte/entreprises/[id] (Phase 10C,
 * §2) — un dispositif d'onboarding distinct de la complétude/activation
 * ci-dessus : 6 étapes concrètes, jamais bloquantes, chacune pointant vers
 * une section déjà existante de la même page. L'étape "profile" regroupe
 * volontairement 3 des 4 critères de complétude (description/secteur/
 * localisation) en une seule action perçue par l'utilisateur.
 */
export interface ActivationChecklistInput {
  hasDescription: boolean;
  hasIndustry: boolean;
  hasLocation: boolean;
  hasProductsServices: boolean;
  hasActiveOffer: boolean;
  hasActiveNeed: boolean;
  hasTargetMarket: boolean;
  hasPotentialPartners: boolean;
}

export type ActivationChecklistItemId =
  | "profile"
  | "productsServices"
  | "offer"
  | "need"
  | "markets"
  | "viewPartners";

export interface ActivationChecklistItem {
  id: ActivationChecklistItemId;
  done: boolean;
}

const CHECKLIST_ITEM_IDS: ActivationChecklistItemId[] = [
  "profile",
  "productsServices",
  "offer",
  "need",
  "markets",
  "viewPartners",
];

export function buildActivationChecklist(
  input: ActivationChecklistInput,
): ActivationChecklistItem[] {
  const doneById: Record<ActivationChecklistItemId, boolean> = {
    profile: input.hasDescription && input.hasIndustry && input.hasLocation,
    productsServices: input.hasProductsServices,
    offer: input.hasActiveOffer,
    need: input.hasActiveNeed,
    markets: input.hasTargetMarket,
    viewPartners: input.hasPotentialPartners,
  };
  return CHECKLIST_ITEM_IDS.map((id) => ({ id, done: doneById[id] }));
}
