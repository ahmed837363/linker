'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { X, ArrowDown, Check, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SwipeControlsProps {
  onReject: () => void;
  onSkip: () => void;
  onAccept: () => void;
  disabled?: boolean;
}

export function SwipeControls({
  onReject,
  onSkip,
  onAccept,
  disabled = false,
}: SwipeControlsProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-4">
        {/* Reject - Left */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onReject}
          disabled={disabled}
          className={cn(
            'w-14 h-14 rounded-full border-2 border-red-500/50 flex items-center justify-center',
            'text-red-400 hover:bg-red-500/20 hover:border-red-500 transition-all',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100'
          )}
          title="Not a match (Left arrow)"
        >
          <X className="w-6 h-6" />
        </motion.button>

        {/* Skip - Down */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onSkip}
          disabled={disabled}
          className={cn(
            'w-11 h-11 rounded-full border-2 border-dashboard-border flex items-center justify-center',
            'text-dashboard-muted hover:bg-dashboard-hover hover:border-dashboard-muted transition-all',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100'
          )}
          title="Skip (Down arrow)"
        >
          <ArrowDown className="w-5 h-5" />
        </motion.button>

        {/* Accept - Right */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onAccept}
          disabled={disabled}
          className={cn(
            'w-14 h-14 rounded-full border-2 border-accent-600/50 flex items-center justify-center',
            'text-accent-400 hover:bg-accent-600/20 hover:border-accent-600 transition-all',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100'
          )}
          title="Match! (Right arrow)"
        >
          <Check className="w-6 h-6" />
        </motion.button>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="flex items-center gap-1 text-xs text-dashboard-muted/60">
        <Keyboard className="w-3 h-3" />
        <span>
          <kbd className="px-1 py-0.5 bg-dashboard-hover rounded text-[10px] font-mono">
            &larr;
          </kbd>{' '}
          No{' '}
          <kbd className="px-1 py-0.5 bg-dashboard-hover rounded text-[10px] font-mono ml-2">
            &darr;
          </kbd>{' '}
          Skip{' '}
          <kbd className="px-1 py-0.5 bg-dashboard-hover rounded text-[10px] font-mono ml-2">
            &rarr;
          </kbd>{' '}
          Yes
        </span>
      </div>
    </div>
  );
}
