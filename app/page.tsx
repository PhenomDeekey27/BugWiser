import { Hero } from '@/components/landing/Hero';
import { ProductPreview } from '@/components/landing/ProductPreview';
import { FeatureSteps } from '@/components/landing/FeatureSteps';
import { HomepageHeader } from '@/components/landing/HomepageHeader';
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
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[10%] left-[20%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(212,167,145,0.12)_0%,transparent_70%)]" />
        <div className="absolute bottom-[10%] right-[15%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(89,23,27,0.2)_0%,transparent_70%)]" />
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
