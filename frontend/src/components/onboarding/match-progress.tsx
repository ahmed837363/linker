'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface MatchProgressProps {
  matched: number;
  skipped: number;
  rejected: number;
  total: number;
}

export function MatchProgress({
  matched,
  skipped,
  rejected,
  total,
}: MatchProgressProps) {
  const processed = matched + skipped + rejected;
  const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="text-dashboard-muted">
          Reviewed{' '}
          <span className="text-white font-medium">{processed}</span> of{' '}
          <span className="text-white font-medium">{total}</span>
        </span>
        <span className="text-white font-semibold">{percentage}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-dashboard-dark rounded-full overflow-hidden">
        <div className="h-full flex" style={{ width: `${percentage}%` }}>
          {matched > 0 && (
            <div
              className="h-full bg-accent-500 transition-all duration-500"
              style={{
                width: `${total > 0 ? (matched / processed) * 100 : 0}%`,
              }}
            />
          )}
          {rejected > 0 && (
            <div
              className="h-full bg-red-500 transition-all duration-500"
              style={{
                width: `${total > 0 ? (rejected / processed) * 100 : 0}%`,
              }}
            />
          )}
          {skipped > 0 && (
            <div
              className="h-full bg-dashboard-muted transition-all duration-500"
              style={{
                width: `${total > 0 ? (skipped / processed) * 100 : 0}%`,
              }}
            />
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-accent-500" />
          <span className="text-dashboard-muted">
            Matched ({matched})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-dashboard-muted">
            Rejected ({rejected})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-dashboard-muted" />
          <span className="text-dashboard-muted">
            Skipped ({skipped})
          </span>
        </div>
      </div>
    </div>
  );
}
