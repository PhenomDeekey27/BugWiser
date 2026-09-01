interface DashboardHeaderProps {
  userName?: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardHeader({ userName = 'developer' }: DashboardHeaderProps) {
  return (
    <div className="mb-8 surface-elevated rounded-xl p-6">
      <h1 className="text-2xl font-bold text-bw-peach-light mb-2">
        {getGreeting()}, <span className="text-primary-default">{userName}</span>.
      </h1>
      <p className="text-sm text-bw-peach">
        System online. All systems nominal.
      </p>
    </div>
  );
}
