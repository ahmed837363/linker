import { create } from 'zustand';
import type {
  OnboardingSession,
  MatchCandidate,
  OnboardingSummary,
  SwipeAction,
} from '@/types';
import api from '@/lib/api';

interface OnboardingState {
  session: OnboardingSession | null;
  currentMatch: MatchCandidate | null;
  summary: OnboardingSummary | null;
  isLoading: boolean;
  isAnimating: boolean;
  lastAction: SwipeAction | null;
  error: string | null;

  startSession: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  loadNextMatch: () => Promise<void>;
  swipeRight: () => Promise<void>;
  swipeLeft: () => Promise<void>;
  skip: () => Promise<void>;
  loadSummary: () => Promise<void>;
  setAnimating: (animating: boolean) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  session: null,
  currentMatch: null,
  summary: null,
  isLoading: false,
  isAnimating: false,
  lastAction: null,
  error: null,

  startSession: async () => {
    set({ isLoading: true, error: null });
    try {
      const session = await api.onboarding.start();
      set({ session });
      const match = await api.onboarding.nextMatch(session.id);
      set({ currentMatch: match, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start session';
      set({ error: message, isLoading: false });
    }
  },

  loadSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const session = await api.onboarding.session(id);
      set({ session });
      if (session.status === 'completed') {
        const summary = await api.onboarding.summary(id);
        set({ summary, isLoading: false });
      } else {
        const match = await api.onboarding.nextMatch(id);
        set({ currentMatch: match, isLoading: false });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load session';
      set({ error: message, isLoading: false });
    }
  },

  loadNextMatch: async () => {
    const { session } = get();
    if (!session) return;
    try {
      const match = await api.onboarding.nextMatch(session.id);
      set({ currentMatch: match });
      if (!match) {
        const summary = await api.onboarding.summary(session.id);
        set({ summary });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load next match';
      set({ error: message });
    }
  },

  swipeRight: async () => {
    const { session, currentMatch } = get();
    if (!session || !currentMatch || get().isAnimating) return;

    set({ isAnimating: true, lastAction: 'accept' });

    try {
      const result = await api.onboarding.swipe(
        session.id,
        currentMatch.id,
        'accept'
      );

      const updatedSession = {
        ...session,
        matchedCount: session.matchedCount + 1,
        remainingCount: session.remainingCount - 1,
      };

      set({
        session: updatedSession,
        currentMatch: result.next,
        isAnimating: false,
      });

      if (!result.next) {
        const summary = await api.onboarding.summary(session.id);
        set({ summary });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Swipe failed';
      set({ error: message, isAnimating: false });
    }
  },

  swipeLeft: async () => {
    const { session, currentMatch } = get();
    if (!session || !currentMatch || get().isAnimating) return;

    set({ isAnimating: true, lastAction: 'reject' });

    try {
      const result = await api.onboarding.swipe(
        session.id,
        currentMatch.id,
        'reject'
      );

      const updatedSession = {
        ...session,
        rejectedCount: session.rejectedCount + 1,
        remainingCount: session.remainingCount - 1,
      };

      set({
        session: updatedSession,
        currentMatch: result.next,
        isAnimating: false,
      });

      if (!result.next) {
        const summary = await api.onboarding.summary(session.id);
        set({ summary });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Swipe failed';
      set({ error: message, isAnimating: false });
    }
  },

  skip: async () => {
    const { session, currentMatch } = get();
    if (!session || !currentMatch || get().isAnimating) return;

    set({ isAnimating: true, lastAction: 'skip' });

    try {
      const result = await api.onboarding.swipe(
        session.id,
        currentMatch.id,
        'skip'
      );

      const updatedSession = {
        ...session,
        skippedCount: session.skippedCount + 1,
        remainingCount: session.remainingCount - 1,
      };

      set({
        session: updatedSession,
        currentMatch: result.next,
        isAnimating: false,
      });

      if (!result.next) {
        const summary = await api.onboarding.summary(session.id);
        set({ summary });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Skip failed';
      set({ error: message, isAnimating: false });
    }
  },

  loadSummary: async () => {
    const { session } = get();
    if (!session) return;
    try {
      const summary = await api.onboarding.summary(session.id);
      set({ summary });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load summary';
      set({ error: message });
    }
  },

  setAnimating: (isAnimating) => set({ isAnimating }),

  reset: () =>
    set({
      session: null,
      currentMatch: null,
      summary: null,
      isLoading: false,
      isAnimating: false,
      lastAction: null,
      error: null,
    }),
}));
