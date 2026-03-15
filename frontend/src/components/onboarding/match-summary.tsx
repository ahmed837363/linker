'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  ArrowRight,
  RotateCcw,
  Package,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OnboardingSummary } from '@/types';

interface MatchSummaryProps {
  summary: OnboardingSummary;
  onStartNew: () => void;
  onGoToProducts: () => void;
}

export function MatchSummary({
  summary,
  onStartNew,
  onGoToProducts,
}: MatchSummaryProps) {
  const statItems = [
    {
      icon: <CheckCircle2 className="w-6 h-6" />,
      color: 'text-accent-400',
      bgColor: 'bg-accent-600/20',
      label: 'Matched',
      value: summary.matched,
    },
    {
      icon: <XCircle className="w-6 h-6" />,
      color: 'text-red-400',
      bgColor: 'bg-red-500/20',
      label: 'Rejected',
      value: summary.rejected,
    },
    {
      icon: <MinusCircle className="w-6 h-6" />,
      color: 'text-dashboard-muted',
      bgColor: 'bg-dashboard-hover',
      label: 'Skipped',
      value: summary.skipped,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col items-center max-w-lg mx-auto text-center"
    >
      {/* Celebration icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
        className="w-20 h-20 rounded-2xl gradient-primary flex items-center justify-center mb-6"
      >
        <Sparkles className="w-10 h-10 text-white" />
      </motion.div>

      <h2 className="text-2xl font-bold text-white mb-2">
        Matching Complete!
      </h2>
      <p className="text-dashboard-muted mb-8">
        You&apos;ve reviewed all {summary.totalProcessed} product candidates.
        {summary.productsCreated > 0 && (
          <span className="text-accent-400">
            {' '}
            {summary.productsCreated} products were linked across platforms.
          </span>
        )}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 w-full mb-8">
        {statItems.map((stat) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-dashboard-card border border-dashboard-border rounded-xl p-4"
          >
            <div
              className={`w-10 h-10 rounded-lg ${stat.bgColor} flex items-center justify-center ${stat.color} mx-auto mb-2`}
            >
              {stat.icon}
            </div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-dashboard-muted">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Match rate */}
      <div className="w-full bg-dashboard-card border border-dashboard-border rounded-xl p-4 mb-8">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-dashboard-muted">Match Rate</span>
          <span className="text-white font-bold">
            {(summary.matchRate * 100).toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-dashboard-dark rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${summary.matchRate * 100}%` }}
            transition={{ delay: 0.5, duration: 0.8, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-accent-600 to-accent-400 rounded-full"
          />
        </div>
      </div>

      {/* Next Steps */}
      {summary.nextSteps.length > 0 && (
        <div className="w-full bg-dashboard-card border border-dashboard-border rounded-xl p-4 mb-8 text-left">
          <h3 className="text-sm font-semibold text-white mb-3">
            Recommended Next Steps
          </h3>
          <ul className="space-y-2">
            {summary.nextSteps.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-dashboard-text"
              >
                <ArrowRight className="w-4 h-4 text-primary-400 shrink-0 mt-0.5" />
                {step}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 w-full">
        <Button
          variant="outline"
          className="flex-1"
          leftIcon={<RotateCcw className="w-4 h-4" />}
          onClick={onStartNew}
        >
          Start New Session
        </Button>
        <Button
          className="flex-1"
          leftIcon={<Package className="w-4 h-4" />}
          onClick={onGoToProducts}
        >
          View Products
        </Button>
      </div>
    </motion.div>
  );
}
