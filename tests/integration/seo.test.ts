import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Tests ciblés (bilinguisme, suite) pour le filtre de statut utilisé par
 * `src/app/sitemap.ts` : une entreprise `draft` ne doit jamais apparaître
 * dans le sitemap, quel que soit le contenu éditorial qu'elle porte déjà.
 *
 * `sitemap.ts` importe `next/headers` (via le client Supabase serveur) et
 * ne peut pas être appelé directement hors du runtime Next.js (même
 * contrainte que pour toute route de src/app/, voir vitest.config.mts) :
 * ce test vérifie donc directement, contre le vrai projet Supabase, le
 * filtre exact que le sitemap applique (`status = 'active'`) plutôt que la
 * fonction elle-même — la présence de ce filtre dans le sitemap est
 * vérifiée séparément, en conditions réelles (voir le rapport du lot).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let draftCompanyId: string;
let activeCompanyId: string;
const draftSlug = `seo-test-draft-${RUN_ID}`;
const activeSlug = `seo-test-active-${RUN_ID}`;

beforeAll(async () => {
  const { data: draft } = await admin
    .from("companies")
    .insert({
      legal_name: `SEO Test Draft ${RUN_ID}`,
      display_name: `SEO Test Draft ${RUN_ID}`,
      slug: draftSlug,
      country_code: "FR",
      status: "draft",
    })
    .select("id")
    .single();
  draftCompanyId = draft!.id;

  const { data: active } = await admin
    .from("companies")
    .insert({
      legal_name: `SEO Test Active ${RUN_ID}`,
      display_name: `SEO Test Active ${RUN_ID}`,
      slug: activeSlug,
      country_code: "FR",
      status: "active",
    })
    .select("id")
    .single();
  activeCompanyId = active!.id;
}, 30000);

afterAll(async () => {
  await admin
    .from("companies")
    .delete()
    .in("id", [draftCompanyId, activeCompanyId]);
}, 30000);

describe("Filtre de statut du sitemap (une entreprise draft n'apparaît jamais)", () => {
  it("le filtre exact du sitemap (status = 'active') exclut une entreprise draft", async () => {
    const { data } = await admin
      .from("companies")
      .select("slug")
      .eq("status", "active")
      .eq("slug", draftSlug);
    expect(data ?? []).toEqual([]);
  });

  it("le même filtre inclut bien une entreprise active", async () => {
    const { data } = await admin
      .from("companies")
      .select("slug")
      .eq("status", "active")
      .eq("slug", activeSlug);
    expect((data ?? []).map((c) => c.slug)).toEqual([activeSlug]);
  });

  it("un changement de statut (draft -> active) fait apparaître l'entreprise dans le même filtre (pas une exception câblée sur le lot pilote)", async () => {
    await admin
      .from("companies")
      .update({ status: "active" })
      .eq("id", draftCompanyId);
    const { data } = await admin
      .from("companies")
      .select("slug")
      .eq("status", "active")
      .eq("slug", draftSlug);
    expect((data ?? []).map((c) => c.slug)).toEqual([draftSlug]);
  });
});
