import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrBuildCatalog } from '@/lib/ai/model-intelligence';
import { getModelPreference } from '@/lib/ai/preferences';
import { getProviderConnections, isProviderConfiguredBysEnv } from '@/lib/ai/connection/service';
import type { ProviderName } from '@/lib/ai/model-catalog/types';
import { PROVIDER_DEFINITIONS } from '@/lib/ai/catalog/registry';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const [catalog, preference, connections] = await Promise.all([
      getOrBuildCatalog(user.id),
      getModelPreference(user.id),
      getProviderConnections(user.id),
    ]);

    const connectedIds = new Set(
      (Object.keys(connections) as ProviderName[]).filter((p) => connections[p])
    );

    const providers = PROVIDER_DEFINITIONS
      .filter((def) => connectedIds.has(def.providerId as ProviderName))
      .map((def) => {
        const pid = def.providerId as ProviderName;
        const providerModels = catalog.models.filter((m) => m.provider === pid);
        return {
          providerId: pid,
          displayName: def.displayName,
          authType: def.authType,
          status: 'connected' as const,
          serverConfigured: isProviderConfiguredBysEnv(pid),
          connected: true,
          modelCount: providerModels.length,
          hasFreeModels: providerModels.some((m) => m.isFree),
          hasPaidModels: providerModels.some((m) => !m.isFree),
          description: def.description,
          docsUrl: def.docsUrl,
        };
      });

    const disconnectedProviders = PROVIDER_DEFINITIONS
      .filter((def) => !connectedIds.has(def.providerId as ProviderName))
      .map((def) => ({
        providerId: def.providerId,
        displayName: def.displayName,
        authType: def.authType,
        status: 'disconnected' as const,
        serverConfigured: isProviderConfiguredBysEnv(def.providerId as ProviderName),
        connected: false,
        modelCount: 0,
        hasFreeModels: false,
        hasPaidModels: false,
        description: def.description,
        docsUrl: def.docsUrl,
      }));

    const allProviders = [...providers, ...disconnectedProviders];

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
        coding: m.codingScore,
        reasoning: m.reasoningScore,
        speed: m.speedScore,
        longContext: m.longContextScore,
      },
      valueScore: m.valueScore,
      tags: m.recommendedCategories,
      fit: m.overallScore,
      stageFit: {} as Record<string, number>,
      available: true,
    }));

    return NextResponse.json({
      providers: allProviders,
      models,
      preference,
      classifiedByAi: catalog.classifiedByAi,
      classificationModel: catalog.classificationModel,
      analyzedAt: catalog.analyzedAt,
    });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models] Error:', err.message);
    return NextResponse.json({ error: 'Failed to load model catalog' }, { status: 500 });
  }
}
