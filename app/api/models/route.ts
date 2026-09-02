import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getModelCatalog } from '@/lib/ai/catalog';
import { fetchLiveModels } from '@/lib/ai/catalog/live';
import { computeOverallFit, fitForStage } from '@/lib/ai/catalog/scoring';
import { getProviderConnections, isProviderConfiguredBysEnv } from '@/lib/ai/connection/service';
import { getModelPreference } from '@/lib/ai/preferences';
import type { AnalysisStageKey, ProviderName } from '@/lib/ai/catalog/types';

const STAGE_LABELS: Array<{ key: AnalysisStageKey; label: string }> = [
  { key: 'relevant_file_discovery', label: 'Relevant File Discovery' },
  { key: 'root_cause_analysis', label: 'Root Cause Analysis' },
  { key: 'evidence_extraction', label: 'Evidence Extraction' },
  { key: 'solution_generation', label: 'Solution Generation' },
  { key: 'patch_generation', label: 'Patch Generation' },
];

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const base = getModelCatalog();
    const connected = await getProviderConnections(user.id);
    const preference = await getModelPreference(user.id);

    // Merge live catalogs (best-effort) for providers with configured keys.
    const liveByProvider = await fetchLiveModels(user.id);
    const mergedModels = [...base.models];
    for (const group of liveByProvider) {
      for (const live of group.models) {
        const existingIdx = mergedModels.findIndex(
          (m) => m.providerId === group.providerId && m.modelId === live.modelId
        );
        if (existingIdx >= 0) {
          mergedModels[existingIdx] = live;
        } else {
          mergedModels.push(live);
        }
      }
    }

    // Augment providers with connection status. serverConfigured means the app
    // has a key via env; otherwise it's a user-supplied BYOK connection.
    const providers = base.providers.map((p) => ({
      ...p,
      status: connected[p.providerId as ProviderName] ? 'connected' : 'disconnected',
      serverConfigured: isProviderConfiguredBysEnv(p.providerId as ProviderName),
    }));

    const models = mergedModels.map((m) => ({
      ...m,
      fit: computeOverallFit(m),
      stageFit: STAGE_LABELS.reduce((acc, s) => {
        acc[s.key] = fitForStage(m, s.key);
        return acc;
      }, {} as Record<string, number>),
      // A model is selectable only when the provider has valid credentials.
      available: !!connected[m.providerId as ProviderName],
    }));

    return NextResponse.json({ providers, models, preference });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models] Error:', err.message);
    return NextResponse.json({ error: 'Failed to load model catalog' }, { status: 500 });
  }
}