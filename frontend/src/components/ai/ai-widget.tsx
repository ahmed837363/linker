'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Bot, X, Send, Minimize2, Maximize2 } from 'lucide-react';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import type { AiMessage } from '@/types';

function getContextFromPath(pathname: string): string {
  if (pathname.startsWith('/products')) return 'products';
  if (pathname.startsWith('/analytics')) return 'analytics';
  if (pathname.startsWith('/pricing')) return 'pricing';
  if (pathname.startsWith('/onboarding')) return 'onboarding';
  if (pathname.startsWith('/sales')) return 'analytics';
  if (pathname.startsWith('/orders')) return 'general';
  if (pathname.startsWith('/inventory')) return 'general';
  if (pathname.startsWith('/stores')) return 'general';
  return 'general';
}

const contextSuggestions: Record<string, string[]> = {
  products: ['How do I push products to all stores?', 'Which products have low stock?', 'How can I optimize my product titles?'],
  analytics: ['What are my best selling products?', 'Which store is performing best?', 'Why did my sales drop this week?'],
  pricing: ['How do pricing rules work?', 'What markup should I use for Amazon?', 'Help me create a pricing strategy'],
  onboarding: ['How does product matching work?', 'What if the AI match is wrong?', 'Can I undo a match?'],
  general: ['Give me an overview of my business', 'What should I focus on today?', 'How do I connect a new store?'],
};

export function AiWidget() {
  const { aiPanelOpen, toggleAiPanel, setAiPanelOpen } = useUiStore();
  const pathname = usePathname();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const context = getContextFromPath(pathname);
  const suggestions = contextSuggestions[context] || contextSuggestions.general;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMessage: AiMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      let convId = conversationId;
      if (!convId) {
        const conv = await api.ai.createConversation(context);
        convId = conv.id;
        setConversationId(convId);
      }

      const response = await api.ai.sendMessage(convId, text.trim(), {
        page: pathname,
        context,
      });
      setMessages((prev) => [...prev, response]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Sorry, I had trouble processing that. Please try again.',
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    setLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  if (!aiPanelOpen) {
    return (
      <button
        onClick={toggleAiPanel}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full gradient-primary shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 transition-transform"
        title="AI Assistant"
      >
        <Bot className="w-6 h-6 text-white" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        'fixed z-50 bg-dashboard-card border border-dashboard-border shadow-2xl flex flex-col transition-all duration-300',
        expanded
          ? 'inset-4 rounded-2xl'
          : 'bottom-6 right-6 w-96 h-[520px] rounded-2xl'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dashboard-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full gradient-primary flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">AI Assistant</h3>
            <p className="text-[10px] text-dashboard-muted capitalize">{context} context</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg text-dashboard-muted hover:text-white hover:bg-dashboard-hover transition-colors"
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setAiPanelOpen(false)}
            className="p-1.5 rounded-lg text-dashboard-muted hover:text-white hover:bg-dashboard-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot className="w-10 h-10 text-primary mx-auto mb-3 opacity-50" />
            <p className="text-sm text-dashboard-muted mb-4">
              Hi! I&apos;m your AI assistant. I can see what page you&apos;re on and help with context-specific questions.
            </p>
            <div className="space-y-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="block w-full text-left px-3 py-2 rounded-lg bg-dashboard-hover/50 text-sm text-dashboard-text hover:text-white hover:bg-dashboard-hover transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'flex',
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            <div
              className={cn(
                'max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-dashboard-hover text-dashboard-text rounded-bl-md'
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-dashboard-hover px-4 py-3 rounded-2xl rounded-bl-md">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-dashboard-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-dashboard-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-dashboard-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-dashboard-border shrink-0">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            className="flex-1 input-base text-sm py-2"
            disabled={loading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="p-2 rounded-lg bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
