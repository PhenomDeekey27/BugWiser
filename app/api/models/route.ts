import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrBuildCatalog } from '@/lib/ai/model-intelligence';
import { getModelPreference } from '@/lib/ai/preferences';
import { isProviderConfiguredBysEnv } from '@/lib/ai/connection/service';
import type { ProviderName } from '@/lib/ai/model-catalog/types';
import { PROVIDER_DEFINITIONS } from '@/lib/ai/catalog/registry';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Read from stored model intelligence catalog
    const catalog = await getOrBuildCatalog(user.id);
    const preference = await getModelPreference(user.id);

    // Build provider list from definitions + catalog connection state
    const connectedProviders = new Set(catalog.models.map((m) => m.provider));
    const providers = PROVIDER_DEFINITIONS.map((def) => ({
      providerId: def.providerId,
      displayName: def.displayName,
      authType: def.authType,
      status: connectedProviders.has(def.providerId as ProviderName) ? 'connected' : 'disconnected',
      serverConfigured: isProviderConfiguredBysEnv(def.providerId as ProviderName),
      connected: connectedProviders.has(def.providerId as ProviderName),
      modelCount: catalog.models.filter((m) => m.provider === def.providerId).length,
      hasFreeModels: catalog.models.some((m) => m.provider === def.providerId && m.isFree),
      hasPaidModels: catalog.models.some((m) => m.provider === def.providerId && !m.isFree),
      description: def.description,
      docsUrl: def.docsUrl,
    }));

    // Models with availability flag (available if their provider has models in catalog)
    const models = catalog.models.map((m) => ({
      providerId: m.provider,
      modelId: m.modelId,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      price: { input: m.inputPrice, output: m.outputPrice, isFree: m.isFree },
      supportsReasoning: m.supportsReasoning,
      supportsToolCalling: m.supportsToolCalling,
      supportsStructuredOutput: m.supportsStructuredOutput,
      capabilities: [
        ...(m.supportsCoding ? ['coding'] : []),
        ...(m.supportsReasoning ? ['reasoning'] : []),
        ...(m.supportsVision ? ['vision'] : []),
        ...(m.supportsToolCalling ? ['tool_calling'] : []),
        ...(m.supportsStructuredOutput ? ['structured_output'] : []),
      ],
      availability: m.availability,
      scores: {
        coding: Math.round(m.codingScore / 20),
        reasoning: Math.round(m.reasoningScore / 20),
        speed: Math.round(m.speedScore / 20),
        longContext: Math.round(m.longContextScore / 20),
      },
      tags: m.recommendedCategories,
      fit: m.overallScore,
      stageFit: {} as Record<string, number>,
      available: true,
    }));

    return NextResponse.json({ providers, models, preference });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models] Error:', err.message);
    return NextResponse.json({ error: 'Failed to load model catalog' }, { status: 500 });
  }
}
