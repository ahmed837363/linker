'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Send, CornerDownLeft, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import type { AiMessage } from '@/types';

interface ChatPanelProps {
  contextType: 'onboarding' | 'products' | 'analytics' | 'pricing' | 'general';
  onClose: () => void;
  contextData?: Record<string, unknown>;
}

const suggestedQuestions: Record<string, string[]> = {
  onboarding: [
    'Why does the AI think these products match?',
    'What attributes are being compared?',
    'How can I improve match accuracy?',
    'Should I match these products?',
  ],
  products: [
    'Which products are underperforming?',
    'How do I optimize my product titles?',
    'What categories should I add?',
    'Suggest product descriptions',
  ],
  analytics: [
    'What is driving revenue growth?',
    'Which platform has the best ROI?',
    'How is my conversion rate trending?',
    'What should I focus on this month?',
  ],
  pricing: [
    'What pricing strategy should I use?',
    'How do my prices compare to competitors?',
    'Should I adjust my Amazon markup?',
    'What is the optimal price for my top products?',
  ],
  general: [
    'How do I connect a new platform?',
    'What features are available on my plan?',
    'How do I bulk update products?',
    'Help me with inventory management',
  ],
};

export function ChatPanel({ contextType, onClose, contextData }: ChatPanelProps) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const initConversation = useCallback(async () => {
    if (conversationId) return conversationId;
    try {
      const conv = await api.ai.createConversation(contextType);
      setConversationId(conv.id);
      return conv.id;
    } catch {
      return null;
    }
  }, [contextType, conversationId]);

  async function sendMessage(text: string) {
    if (!text.trim() || isTyping) return;

    const userMessage: AiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const convId = await initConversation();
      if (!convId) throw new Error('Failed to create conversation');

      const response = await api.ai.sendMessage(convId, text.trim(), contextData);
      setMessages((prev) => [...prev, response]);
    } catch {
      const errorMessage: AiMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const questions = suggestedQuestions[contextType] || suggestedQuestions.general;

  return (
    <div className="h-full flex flex-col bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dashboard-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">AI Assistant</h3>
            <p className="text-[10px] text-dashboard-muted leading-none">
              Ask anything about your store
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-dashboard-muted hover:text-white hover:bg-dashboard-hover transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/20 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="w-6 h-6 text-purple-400" />
              </div>
              <p className="text-sm text-dashboard-muted">
                How can I help you today?
              </p>
            </div>

            {/* Suggested questions */}
            <div className="space-y-2">
              <p className="text-xs text-dashboard-muted uppercase tracking-wider font-medium">
                Suggested Questions
              </p>
              {questions.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-dashboard-text
                             bg-dashboard-dark/50 hover:bg-dashboard-hover border border-dashboard-border
                             hover:border-purple-500/30 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  'flex',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-primary-600 text-white rounded-br-md'
                      : 'bg-dashboard-dark/70 text-dashboard-text border border-dashboard-border rounded-bl-md'
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      <span className="text-[10px] font-medium text-purple-400">
                        AI Assistant
                      </span>
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p
                    className={cn(
                      'text-[10px] mt-1',
                      msg.role === 'user'
                        ? 'text-primary-200'
                        : 'text-dashboard-muted'
                    )}
                  >
                    {formatDate(msg.timestamp, 'HH:mm')}
                  </p>
                </div>
              </motion.div>
            ))}

            {/* Typing indicator */}
            <AnimatePresence>
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-start"
                >
                  <div className="bg-dashboard-dark/70 border border-dashboard-border rounded-xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      <div className="flex items-center gap-1">
                        <motion.span
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                          className="w-1.5 h-1.5 bg-purple-400 rounded-full"
                        />
                        <motion.span
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{
                            repeat: Infinity,
                            duration: 1.5,
                            delay: 0.2,
                          }}
                          className="w-1.5 h-1.5 bg-purple-400 rounded-full"
                        />
                        <motion.span
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{
                            repeat: Infinity,
                            duration: 1.5,
                            delay: 0.4,
                          }}
                          className="w-1.5 h-1.5 bg-purple-400 rounded-full"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-dashboard-border p-3">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI assistant..."
            className="w-full input-base py-2.5 pr-10 text-sm bg-dashboard-dark/50"
            disabled={isTyping}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isTyping}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md
                       text-dashboard-muted hover:text-purple-400 transition-colors
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isTyping ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-dashboard-muted/50 mt-1 flex items-center gap-1">
          <CornerDownLeft className="w-2.5 h-2.5" />
          Press Enter to send
        </p>
      </div>
    </div>
  );
}
