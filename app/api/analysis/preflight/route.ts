import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildStrategies, getRecommendedStrategy } from '@/lib/ai/orchestration/strategies';
import { isProviderConfigured, ProviderName } from '@/lib/ai/providers/registry';
import { MODEL_REGISTRY } from '@/lib/ai/model-registry';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Determine available providers (env-configured + user-connected)
  const availableProviders = new Set<ProviderName>();
  const allProviders: ProviderName[] = [
    'gemini', 'deepseek', 'zai', 'opencode', 'openrouter', 'chutes', 'openai',
  ];

  for (const p of allProviders) {
    if (isProviderConfigured(p)) {
      availableProviders.add(p);
    }
  }

  // Also check user-connected providers from the database
  try {
    const { data: connections } = await supabase
      .from('provider_connections')
      .select('provider')
      .eq('user_id', user.id);

    if (connections) {
      for (const conn of connections) {
        availableProviders.add(conn.provider as ProviderName);
      }
    }
  } catch {
    // Continue with env-configured providers only
  }

  const strategies = buildStrategies(availableProviders);
  const recommended = getRecommendedStrategy(strategies);

  const hasFreeProviders = strategies.some((s) => s.isFree);
  const hasPaidProviders = strategies.some((s) => !s.isFree);

  return NextResponse.json({
    strategies,
    recommended,
    availableProviders: Array.from(availableProviders),
    hasPaidProviders,
    hasFreeProviders,
  });
}
