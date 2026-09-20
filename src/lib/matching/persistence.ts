import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { ALGORITHM_VERSION } from "./config";
import type { MatchScoreResult } from "./types";

/**
 * Seule porte d'écriture vers matches/opportunity_matches — utilise
 * systématiquement la clé secrète (voir supabase/migrations/0016 : aucune
 * politique RLS n'autorise un client normal à insérer/mettre à jour un
 * score). Upsert plutôt qu'insert : un recalcul remplace le résultat
 * précédent pour la même paire au lieu d'empiler des doublons.
 */

/**
 * Retourne l'id de la ligne `matches` upsertée — utilisé par
 * getPartnersForCompany() pour que "Demander une mise en relation"
 * (Phase 9) puisse RÉFÉRENCER ce match précis (source_match_id) sans
 * jamais recopier ni recalculer son score dans partnership_requests.
 */
export async function upsertMatch(params: {
  companyId: string;
  needId: string;
  candidateCompanyId: string;
  offerId: string;
  result: MatchScoreResult;
}): Promise<string | null> {
  if (params.result.eliminated) return null;
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("matches")
    .upsert(
      {
        company_id: params.companyId,
        need_id: params.needId,
        candidate_company_id: params.candidateCompanyId,
        offer_id: params.offerId,
        score: params.result.score,
        confidence: params.result.confidence,
        score_breakdown: params.result.breakdown,
        algorithm_version: ALGORITHM_VERSION,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: "need_id,offer_id" },
    )
    .select("id")
    .single();
  return data?.id ?? null;
}

export async function upsertOpportunityMatch(params: {
  opportunityId: string;
  candidateCompanyId: string;
  candidateOfferId?: string;
  candidateNeedId?: string;
  result: MatchScoreResult;
}) {
  if (params.result.eliminated) return;
  const supabase = createServiceRoleClient();
  await supabase.from("opportunity_matches").upsert(
    {
      opportunity_id: params.opportunityId,
      candidate_company_id: params.candidateCompanyId,
      candidate_offer_id: params.candidateOfferId ?? null,
      candidate_need_id: params.candidateNeedId ?? null,
      score: params.result.score,
      confidence: params.result.confidence,
      score_breakdown: params.result.breakdown,
      algorithm_version: ALGORITHM_VERSION,
      calculated_at: new Date().toISOString(),
    },
    { onConflict: "opportunity_id,candidate_company_id" },
  );
}
