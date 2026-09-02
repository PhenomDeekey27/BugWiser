import { Hero } from '@/components/landing/Hero';
import { ProductPreview } from '@/components/landing/ProductPreview';
import { FeatureSteps } from '@/components/landing/FeatureSteps';
import { HomepageHeader } from '@/components/landing/HomepageHeader';
import { DotPattern } from '@/components/ui/dot-pattern';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const githubUser = user?.user_metadata
    ? {
        login: user.user_metadata.user_name || user.user_metadata.login || 'user',
        name: user.user_metadata.full_name || user.user_metadata.name || null,
        avatarUrl: user.user_metadata.avatar_url || '',
      }
    : null;

  return (
    <div className="min-h-screen bg-page-landing relative">
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="dot-pattern-container absolute inset-0" style={{ color: 'rgba(110, 100, 95, 0.12)' }}>
          <DotPattern
            width={22}
            height={22}
            cr={0.6}
            className="opacity-70"
          />
        </div>
        {/* Radial fade for subtle emphasis around hero */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(250,248,245,0)_0%,_rgba(250,248,245,0.6)_70%)]" />
      </div>

      <HomepageHeader user={githubUser} />

      <main className="relative z-10">
        <Hero user={githubUser} />
        <FeatureSteps />
        <ProductPreview />
      </main>
    </div>
  );
}
