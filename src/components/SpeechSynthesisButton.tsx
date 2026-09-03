'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Volume2,
  VolumeX,
  Pause,
  Play,
  Loader2,
  Sparkles,
  FileText,
  Check,
  Radio,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from './ui/button';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useSettings } from '@/context/SettingsContext';
import { ClientSideAiService } from '@/lib/ClientSideAiService';
import { AudioPlayerService, type AudioPlaybackController } from '@/lib/AudioPlayerService';
import { useToast } from '@/hooks/use-toast';
import type { VoiceExplanationContext, VoiceContextType } from '@/types';
import { cn } from '@/lib/utils';

// In-memory audio session cache so repeating the same voice clip is instant
const audioSessionCache = new Map<string, { audioBase64: string; mimeType: string; script: string }>();

export interface SpeechSynthesisButtonProps {
  text?: string;
  label?: string;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  showLabel?: boolean;
  showVoiceBadge?: boolean;
  showScriptToggle?: boolean;
  voiceContext?: VoiceExplanationContext;
  pedagogicalContext?: {
    title?: string;
    type?: VoiceContextType | 'slide' | 'diagnosis' | 'knowledge_node' | 'clinical_qa';
    context?: string;
  };
  generatePedagogicalScript?: boolean;
}

export type VoiceSynthesisStep = 'idle' | 'generating_script' | 'synthesizing_voice' | 'playing' | 'paused';

export function SpeechSynthesisButton({
  text = '',
  label = 'Explain with Voice',
  className = '',
  size = 'sm',
  variant = 'outline',
  showLabel = false,
  showVoiceBadge = false,
  showScriptToggle = false,
  voiceContext,
  pedagogicalContext,
  generatePedagogicalScript = true,
}: SpeechSynthesisButtonProps) {
  const { toast } = useToast();
  const { ttsSettings, aiConfig, language } = useSettings();

  // Browser Web Speech fallback hook
  const {
    isSpeaking: isBrowserSpeaking,
    isPaused: isBrowserPaused,
    toggleSpeak: toggleBrowserSpeak,
    stop: stopBrowserSpeak,
  } = useSpeechSynthesis();

  // Two-Stage Voice Architecture state
  const [stage, setStage] = useState<VoiceSynthesisStep>('idle');
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const playbackControllerRef = useRef<AudioPlaybackController | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeProvider = ttsSettings?.provider || 'gemini';
  const activeVoice = ttsSettings?.voice || 'Kore';
  const activeSpeed = ttsSettings?.speed || 1.0;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playbackControllerRef.current) {
        playbackControllerRef.current.stop();
        playbackControllerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      AudioPlayerService.stopAll();
    };
  }, []);

  // Compute effective text to speak or explain
  const effectiveText = voiceContext?.mainContent || text || '';
  if (!effectiveText && !voiceContext) {
    return null;
  }

  // Derive standardized VoiceExplanationContext
  const resolvedContext: VoiceExplanationContext = voiceContext || {
    type: (pedagogicalContext?.type as VoiceContextType) || 'general',
    title: pedagogicalContext?.title || 'Clinical Concept',
    mainContent: effectiveText,
    additionalContext: pedagogicalContext?.context,
    language: language || 'english',
  };

  const cacheKey = `${activeProvider}_${activeVoice}_${activeSpeed}_${resolvedContext.type}_${resolvedContext.title}_${effectiveText.slice(0, 80)}`;

  const isCurrentActive = stage === 'playing' || isBrowserSpeaking;
  const isCurrentPaused = stage === 'paused' || isBrowserPaused;
  const isBusy = stage === 'generating_script' || stage === 'synthesizing_voice';

  // Handle Stop Playback & Reset
  const handleStop = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (playbackControllerRef.current) {
      playbackControllerRef.current.stop();
      playbackControllerRef.current = null;
    }
    AudioPlayerService.stopAll();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopBrowserSpeak();
    setStage('idle');
  };

  // Two-Stage Generation and Playback Process
  const handleStartTwoStageSynthesis = async () => {
    // 1. Check local session cache for instant replay
    const cached = audioSessionCache.get(cacheKey);
    if (cached) {
      setGeneratedScript(cached.script);
      try {
        const controller = await AudioPlayerService.playBase64(
          cached.audioBase64,
          cached.mimeType,
          activeSpeed,
          {
            onPlay: () => setStage('playing'),
            onPause: () => setStage('paused'),
            onEnded: () => setStage('idle'),
            onError: () => setStage('idle'),
          }
        );
        playbackControllerRef.current = controller;
        setStage('playing');
        return;
      } catch (playErr) {
        console.warn('Cached audio playback error, regenerating:', playErr);
      }
    }

    // 2. Begin Two-Stage Generation
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let scriptToSpeak = generatedScript;

      // STAGE 1: Main LLM Call to generate natural spoken script
      if (!scriptToSpeak) {
        setStage('generating_script');
        try {
          const generated = await ClientSideAiService.generateSpokenScript(
            aiConfig,
            resolvedContext,
            controller.signal
          );
          if (generated && generated.trim()) {
            scriptToSpeak = generated.trim();
            setGeneratedScript(scriptToSpeak);
          } else {
            scriptToSpeak = effectiveText;
          }
        } catch (llmErr: any) {
          if (controller.signal.aborted) return;
          console.warn('Stage 1 LLM script generation fallback:', llmErr);
          scriptToSpeak = effectiveText.replace(/[*#`_~\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
          setGeneratedScript(scriptToSpeak);
        }
      }

      if (controller.signal.aborted) return;

      // STAGE 2: Subsequent TTS AI Model Call to generate the voice
      setStage('synthesizing_voice');

      if (activeProvider === 'browser') {
        // Direct browser speech fallback
        toggleBrowserSpeak(scriptToSpeak || effectiveText);
        setStage('playing');
        return;
      }

      const ttsResult = await ClientSideAiService.synthesizeSpeech(aiConfig, {
        text: scriptToSpeak || effectiveText,
        provider: activeProvider,
        voice: activeVoice,
        speed: activeSpeed,
        endpoint: ttsSettings?.endpoint,
        apiKey: ttsSettings?.apiKey,
        model: ttsSettings?.model,
        language: language || 'english',
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!ttsResult?.audioBase64 && !ttsResult?.audioDataUrl) {
        throw new Error('TTS model did not return audio data.');
      }

      const audioData = ttsResult.audioBase64 || ttsResult.audioDataUrl;
      const mimeType = ttsResult.mimeType || 'audio/wav';

      // Cache for instant future replays
      audioSessionCache.set(cacheKey, {
        audioBase64: audioData,
        mimeType,
        script: scriptToSpeak || effectiveText,
      });

      // STAGE 3: Audio Playback via Universal Audio Player
      const playback = await AudioPlayerService.playBase64(
        audioData,
        mimeType,
        activeSpeed,
        {
          onPlay: () => setStage('playing'),
          onPause: () => setStage('paused'),
          onEnded: () => {
            setStage('idle');
            playbackControllerRef.current = null;
          },
          onError: (err) => {
            console.warn('Playback error caught, falling back to browser speech:', err);
            setStage('idle');
            playbackControllerRef.current = null;
            toggleBrowserSpeak(scriptToSpeak || effectiveText);
          },
        }
      );

      playbackControllerRef.current = playback;
      setStage('playing');
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        setStage('idle');
        return;
      }
      console.warn('Two-stage voice synthesis encountered issue, switching to browser speech:', err);
      toast({
        title: 'TTS Service Notice',
        description: `${err?.message || 'TTS request failed'}. Speaking via browser voice engine.`,
      });
      toggleBrowserSpeak(generatedScript || effectiveText);
      setStage('idle');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // If currently using native browser provider
    if (activeProvider === 'browser') {
      toggleBrowserSpeak(generatedScript || effectiveText);
      return;
    }

    // If already playing AI audio -> Toggle Pause / Resume
    if (stage === 'playing') {
      if (playbackControllerRef.current) {
        playbackControllerRef.current.pause();
        setStage('paused');
      }
      return;
    }

    if (stage === 'paused') {
      if (playbackControllerRef.current) {
        await playbackControllerRef.current.resume();
        setStage('playing');
      }
      return;
    }

    // Start fresh Two-Stage process
    await handleStartTwoStageSynthesis();
  };

  const handleCopyScript = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!generatedScript) return;
    navigator.clipboard.writeText(generatedScript);
    setCopiedScript(true);
    toast({ title: 'Script Copied', description: 'Spoken script copied to clipboard.' });
    setTimeout(() => setCopiedScript(false), 2000);
  };

  return (
    <div className="relative inline-flex flex-col items-start">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant={isCurrentActive ? 'default' : variant}
                size={size}
                onClick={handleClick}
                disabled={isBusy}
                className={cn(
                  'transition-all duration-200 gap-1.5 shadow-xs',
                  isCurrentActive
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground ring-2 ring-primary/40'
                    : 'text-muted-foreground hover:text-foreground',
                  isBusy && 'opacity-90 cursor-wait',
                  className
                )}
                aria-label={
                  stage === 'generating_script'
                    ? 'AI generating spoken explanation script'
                    : stage === 'synthesizing_voice'
                    ? 'TTS synthesizing audio voice'
                    : isCurrentActive
                    ? isCurrentPaused
                      ? 'Resume voice reading'
                      : 'Pause voice reading'
                    : label
                }
              >
                {/* Stage-Aware Visual Icons */}
                {stage === 'generating_script' ? (
                  <div className="flex items-center gap-1 text-primary">
                    <Sparkles className="h-3.5 w-3.5 animate-spin text-amber-500" />
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </div>
                ) : stage === 'synthesizing_voice' ? (
                  <div className="flex items-center gap-1 text-primary">
                    <Radio className="h-3.5 w-3.5 animate-pulse text-primary" />
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </div>
                ) : isCurrentActive ? (
                  isCurrentPaused ? (
                    <Play className="h-3.5 w-3.5 shrink-0 ml-0.5" />
                  ) : (
                    <div className="flex items-center gap-0.5 h-3.5 px-0.5">
                      <span className="w-1 bg-current rounded-full animate-[pulse_0.6s_ease-in-out_infinite] h-2" />
                      <span className="w-1 bg-current rounded-full animate-[pulse_0.4s_ease-in-out_infinite] h-3.5" />
                      <span className="w-1 bg-current rounded-full animate-[pulse_0.8s_ease-in-out_infinite] h-2.5" />
                    </div>
                  )
                ) : (
                  <Volume2 className="h-3.5 w-3.5 shrink-0" />
                )}

                {/* Status Label Text */}
                {showLabel && (
                  <span className="text-xs font-semibold whitespace-nowrap">
                    {stage === 'generating_script'
                      ? 'Step 1/2: Crafting Script...'
                      : stage === 'synthesizing_voice'
                      ? 'Step 2/2: Generating Voice...'
                      : isCurrentActive
                      ? isCurrentPaused
                        ? 'Paused'
                        : 'Playing Audio...'
                      : label}
                  </span>
                )}

                {/* Voice Badge Indicator */}
                {showVoiceBadge && !isBusy && !isCurrentActive && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border/50">
                    {activeVoice}
                  </span>
                )}
              </Button>

              {/* Stop Button when active or busy */}
              {(isCurrentActive || isBusy) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleStop}
                  className="h-7 w-7 text-destructive hover:bg-destructive/10 shrink-0"
                  title="Stop voice playback"
                >
                  <VolumeX className="h-3.5 w-3.5" />
                </Button>
              )}

              {/* Toggle Script Button when a script is generated */}
              {generatedScript && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowScriptModal(!showScriptModal);
                  }}
                  className={cn(
                    'h-7 w-7 text-muted-foreground hover:text-foreground shrink-0',
                    showScriptModal && 'text-primary bg-primary/10'
                  )}
                  title={showScriptModal ? 'Hide Spoken Script' : 'View AI Spoken Script'}
                >
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-xs">
            <p>
              {stage === 'generating_script'
                ? 'Phase 1: Main AI LLM creating natural spoken explanation script...'
                : stage === 'synthesizing_voice'
                ? `Phase 2: Synthesizing voice audio with ${activeProvider.toUpperCase()} (${activeVoice} voice)...`
                : isCurrentActive
                ? isCurrentPaused
                  ? 'Click to resume AI voice explanation'
                  : 'Click to pause voice explanation'
                : `Explain in voice via ${activeProvider.toUpperCase()} (${activeVoice} • ${activeSpeed}x)`}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Expandable Spoken Transcript Drawer */}
      {showScriptModal && generatedScript && (
        <div className="absolute top-full left-0 z-50 mt-1.5 w-80 sm:w-96 rounded-xl border border-border bg-popover/95 backdrop-blur-md p-3.5 shadow-xl animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between pb-2 border-b border-border/60">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-bold text-foreground">AI Spoken Script</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCopyScript}
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                title="Copy spoken script"
              >
                {copiedScript ? <Check className="h-3 w-3 text-emerald-500" /> : <FileText className="h-3 w-3" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowScriptModal(false)}
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="mt-2 text-xs leading-relaxed text-muted-foreground font-sans max-h-48 overflow-y-auto pr-1 whitespace-pre-wrap">
            {generatedScript}
          </div>
          <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
            <span>TTS Model: {activeProvider.toUpperCase()}</span>
            <span>Voice: {activeVoice}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Named alias for clarity
export const VoiceExplanationButton = SpeechSynthesisButton;
