interface Stat {
  label: string;
  value: string | number;
}

interface StatsGridProps {
  stats?: Stat[];
}

export function StatsGrid({ stats = [] }: StatsGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="p-4 rounded-lg bg-surface-container/90 border border-bw-burgundy/40 hover:border-bw-terracotta/50 transition-colors card-depth"
        >
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
            {stat.label}
          </p>
          <p className="text-2xl font-bold text-bw-peach-light">
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
