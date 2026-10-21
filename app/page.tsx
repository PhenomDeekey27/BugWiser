import { Hero } from '@/components/landing/Hero';
import { ProductPreview } from '@/components/landing/ProductPreview';
import { FeatureSteps } from '@/components/landing/FeatureSteps';
import { HomepageHeader } from '@/components/landing/HomepageHeader';
import { getAuthenticatedUser, viewerFromAuthUser } from '@/lib/auth/session';

export default async function Home() {
  const user = await getAuthenticatedUser();
  const githubUser = viewerFromAuthUser(user);

  return (
    <div className="min-h-screen bg-page-landing relative">
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 landing-radial-fade" />
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
