'use client';

import React, { useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, MessageSquare, ArrowLeftRight } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboarding.store';
import { MatchCard } from '@/components/onboarding/match-card';
import { SwipeControls } from '@/components/onboarding/swipe-controls';
import { MatchProgress } from '@/components/onboarding/match-progress';
import { MatchSummary } from '@/components/onboarding/match-summary';
import { ChatPanel } from '@/components/ai/chat-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/loading';
import { cn } from '@/lib/utils';

const swipeVariants = {
  enter: { opacity: 0, scale: 0.95 },
  center: { opacity: 1, scale: 1 },
  exitRight: { opacity: 0, x: 300, rotate: 10, transition: { duration: 0.3 } },
  exitLeft: { opacity: 0, x: -300, rotate: -10, transition: { duration: 0.3 } },
  exitDown: { opacity: 0, y: 200, scale: 0.9, transition: { duration: 0.3 } },
};

export default function OnboardingMatchPage() {
  const router = useRouter();
  const {
    session,
    currentMatch,
    summary,
    isLoading,
    isAnimating,
    lastAction,
    error,
    startSession,
    swipeRight,
    swipeLeft,
    skip,
    reset,
  } = useOnboardingStore();

  const [showChat, setShowChat] = useState(false);
  const [exitAnimation, setExitAnimation] = useState<
    'exitRight' | 'exitLeft' | 'exitDown' | null
  >(null);

  // Start session on mount
  useEffect(() => {
    if (!session) {
      startSession();
    }
    return () => {
      // do not reset on unmount to allow coming back
    };
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isAnimating || !currentMatch) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          handleAccept();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleReject();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleSkip();
          break;
      }
    },
    [isAnimating, currentMatch]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  function handleAccept() {
    setExitAnimation('exitRight');
    setTimeout(() => {
      swipeRight();
      setExitAnimation(null);
    }, 300);
  }

  function handleReject() {
    setExitAnimation('exitLeft');
    setTimeout(() => {
      swipeLeft();
      setExitAnimation(null);
    }, 300);
  }

  function handleSkip() {
    setExitAnimation('exitDown');
    setTimeout(() => {
      skip();
      setExitAnimation(null);
    }, 300);
  }

  function handleStartNew() {
    reset();
    startSession();
  }

  if (isLoading && !session) {
    return <PageLoader />;
  }

  if (error && !session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] gap-4">
        <p className="text-red-400">{error}</p>
        <Button onClick={handleStartNew}>Try Again</Button>
      </div>
    );
  }

  // Show summary when complete
  if (summary) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <MatchSummary
          summary={summary}
          onStartNew={handleStartNew}
          onGoToProducts={() => router.push('/products')}
        />
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-7rem)]">
      {/* Main content */}
      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 transition-all duration-300',
          showChat && 'mr-0'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <ArrowLeftRight className="w-6 h-6 text-primary-400" />
              Product Matching
            </h1>
            <p className="text-dashboard-muted text-sm mt-0.5">
              Review AI-suggested matches between your platforms
            </p>
          </div>
          <Button
            variant={showChat ? 'primary' : 'outline'}
            size="sm"
            leftIcon={<MessageSquare className="w-4 h-4" />}
            onClick={() => setShowChat(!showChat)}
          >
            AI Assistant
          </Button>
        </div>

        {/* Progress */}
        {session && (
          <div className="mb-4 shrink-0">
            <MatchProgress
              matched={session.matchedCount}
              skipped={session.skippedCount}
              rejected={session.rejectedCount}
              total={session.totalCandidates}
            />
          </div>
        )}

        {/* Match Cards */}
        {currentMatch ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentMatch.id}
                variants={swipeVariants}
                initial="enter"
                animate={exitAnimation || 'center'}
                transition={{ duration: 0.3 }}
                className="w-full max-w-4xl"
              >
                <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] gap-4 items-start">
                  {/* Anchor product (left) */}
                  <MatchCard
                    product={currentMatch.anchorProduct}
                    side="left"
                    isAnchor
                  />

                  {/* AI Confidence */}
                  <div className="flex flex-col items-center justify-center gap-3 py-4 md:py-16">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.2 }}
                      className={cn(
                        'w-16 h-16 rounded-full flex items-center justify-center font-bold text-lg border-2',
                        currentMatch.aiConfidence >= 0.8
                          ? 'bg-accent-600/20 border-accent-600/50 text-accent-400'
                          : currentMatch.aiConfidence >= 0.5
                          ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400'
                          : 'bg-red-500/20 border-red-500/50 text-red-400'
                      )}
                    >
                      {Math.round(currentMatch.aiConfidence * 100)}%
                    </motion.div>
                    <div className="flex items-center gap-1 text-xs text-dashboard-muted">
                      <Sparkles className="w-3 h-3" />
                      AI Confidence
                    </div>
                    {currentMatch.aiReasoning && (
                      <p className="text-xs text-dashboard-muted text-center max-w-[160px] leading-relaxed">
                        {currentMatch.aiReasoning}
                      </p>
                    )}
                    {currentMatch.matchAttributes.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-1 max-w-[180px]">
                        {currentMatch.matchAttributes.map((attr) => (
                          <Badge key={attr} variant="outline" size="sm">
                            {attr}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Candidate product (right) */}
                  <MatchCard
                    product={currentMatch.candidateProduct}
                    side="right"
                  />
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Swipe Controls */}
            <div className="mt-6 shrink-0">
              <SwipeControls
                onReject={handleReject}
                onSkip={handleSkip}
                onAccept={handleAccept}
                disabled={isAnimating || !!exitAnimation}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-dashboard-muted">
                {isLoading ? 'Loading next match...' : 'No more matches available.'}
              </p>
              {!isLoading && (
                <Button className="mt-4" onClick={handleStartNew}>
                  Start New Session
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI Chat Panel */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="shrink-0 overflow-hidden"
          >
            <ChatPanel
              contextType="onboarding"
              onClose={() => setShowChat(false)}
              contextData={
                currentMatch
                  ? {
                      anchorProduct: currentMatch.anchorProduct.title,
                      candidateProduct: currentMatch.candidateProduct.title,
                      confidence: currentMatch.aiConfidence,
                    }
                  : undefined
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
