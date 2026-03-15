import React from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: number;
  trendLabel?: string;
  className?: string;
}

export function StatCard({
  icon,
  label,
  value,
  trend,
  trendLabel,
  className,
}: StatCardProps) {
  const isPositive = trend !== undefined && trend >= 0;

  return (
    <div
      className={cn(
        'bg-dashboard-card border border-dashboard-border rounded-xl p-6 hover:border-dashboard-hover transition-colors',
        className
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-lg bg-primary-600/20 flex items-center justify-center text-primary-400">
          {icon}
        </div>
        {trend !== undefined && (
          <div
            className={cn(
              'flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5',
              isPositive
                ? 'bg-accent-600/20 text-accent-400'
                : 'bg-red-500/20 text-red-400'
            )}
          >
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-sm text-dashboard-muted">
        {label}
        {trendLabel && (
          <span className="text-xs ml-1">({trendLabel})</span>
        )}
      </div>
    </div>
  );
}
