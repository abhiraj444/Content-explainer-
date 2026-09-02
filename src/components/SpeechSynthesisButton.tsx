'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Volume2, VolumeX, Pause, Play, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useSettings } from '@/context/SettingsContext';
import { ClientSideAiService } from '@/lib/ClientSideAiService';
import { useToast } from '@/hooks/use-toast';

// In-memory audio session cache so repeating the same voice clip is instant
const audioSessionCache = new Map<string, string>();

interface SpeechSynthesisButtonProps {
  text: string;
  label?: string;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  showLabel?: boolean;
  showVoiceBadge?: boolean;
  pedagogicalContext?: {
    title?: string;
    type?: 'slide' | 'diagnosis' | 'knowledge_node' | 'clinical_qa';
    context?: string;
  };
  generatePedagogicalScript?: boolean;
}

export function SpeechSynthesisButton({
  text,
  label = 'Listen with Voice',
  className = '',
  size = 'sm',
  variant = 'outline',
  showLabel = false,
  showVoiceBadge = false,
  pedagogicalContext,
  generatePedagogicalScript = false,
}: SpeechSynthesisButtonProps) {
  const { toast } = useToast();
  const { ttsSettings, aiConfig, language } = useSettings();
  
  // Browser SpeechSynthesis fallback hook
  const {
    isSpeaking: isBrowserSpeaking,
    isPaused: isBrowserPaused,
    isSupported: isBrowserSupported,
    toggleSpeak: toggleBrowserSpeak,
    stop: stopBrowserSpeak,
  } = useSpeechSynthesis();

  // AI TTS Audio state
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isPlayingAiAudio, setIsPlayingAiAudio] = useState(false);
  const [isPausedAiAudio, setIsPausedAiAudio] = useState(false);
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeProvider = ttsSettings?.provider || 'gemini';
  const activeVoice = ttsSettings?.voice || 'Kore';
  const activeSpeed = ttsSettings?.speed || 1.0;

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  if (!text) {
    return null;
  }

  const isCurrentActive = isPlayingAiAudio || isBrowserSpeaking;
  const isPaused = isPausedAiAudio || isBrowserPaused;

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlayingAiAudio(false);
      setIsPausedAiAudio(false);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSynthesizing(false);
    stopBrowserSpeak();
  };

  const handlePlayAiAudio = async (textToSpeak: string) => {
    // Check if audio exists in cache
    const cacheKey = `${activeProvider}_${activeVoice}_${activeSpeed}_${textToSpeak.slice(0, 100)}`;
    const cachedUrl = audioSessionCache.get(cacheKey);

    if (cachedUrl) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(cachedUrl);
      audio.playbackRate = activeSpeed;
      audioRef.current = audio;

      audio.onended = () => {
        setIsPlayingAiAudio(false);
        setIsPausedAiAudio(false);
      };
      audio.onerror = () => {
        setIsPlayingAiAudio(false);
        setIsPausedAiAudio(false);
      };

      await audio.play();
      setIsPlayingAiAudio(true);
      setIsPausedAiAudio(false);
      return;
    }

    // Synthesize new audio from backend
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsSynthesizing(true);

    try {
      let speechText = textToSpeak;

      // If pedagogical mode is requested, transform raw notes/bullet points into spoken teacher lecture
      if (generatePedagogicalScript && !generatedScript) {
        try {
          const script = await ClientSideAiService.generateAudioExplanationScript(aiConfig, {
            title: pedagogicalContext?.title || 'Clinical Lecture',
            content: textToSpeak,
            feature: pedagogicalContext?.type || 'slide',
            context: pedagogicalContext?.context,
            language: language || 'english',
            signal: controller.signal,
          });
          if (script && script.trim()) {
            speechText = script.trim();
            setGeneratedScript(script);
          }
        } catch (scriptErr) {
          console.warn('Pedagogical script generator fallback:', scriptErr);
        }
      } else if (generatedScript) {
        speechText = generatedScript;
      }

      const result = await ClientSideAiService.synthesizeSpeech(aiConfig, {
        text: speechText,
        provider: activeProvider,
        voice: activeVoice,
        speed: activeSpeed,
        endpoint: ttsSettings?.endpoint,
        apiKey: ttsSettings?.apiKey,
        model: ttsSettings?.model,
        language: language || 'english',
        signal: controller.signal,
      });

      if (result?.audioDataUrl) {
        audioSessionCache.set(cacheKey, result.audioDataUrl);

        if (audioRef.current) {
          audioRef.current.pause();
        }
        const audio = new Audio(result.audioDataUrl);
        audio.playbackRate = activeSpeed;
        audioRef.current = audio;

        audio.onended = () => {
          setIsPlayingAiAudio(false);
          setIsPausedAiAudio(false);
        };
        audio.onerror = (e) => {
          console.error('Audio playback error:', e);
          setIsPlayingAiAudio(false);
          setIsPausedAiAudio(false);
        };

        await audio.play();
        setIsPlayingAiAudio(true);
        setIsPausedAiAudio(false);
      } else {
        throw new Error('No audio returned from TTS engine.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.warn('AI TTS Synthesis error, falling back to Browser Web Speech:', err);
      toast({
        title: 'TTS Fallback Activated',
        description: `${err?.message || 'AI Voice Synthesis service unavailable'}. Falling back to Browser Speech.`,
        variant: 'destructive',
      });
      // Graceful fallback to browser speech synthesis
      toggleBrowserSpeak(textToSpeak);
    } finally {
      setIsSynthesizing(false);
      abortControllerRef.current = null;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // 1. If currently using native browser provider
    if (activeProvider === 'browser') {
      toggleBrowserSpeak(text);
      return;
    }

    // 2. If playing AI audio, handle pause / resume
    if (isPlayingAiAudio) {
      if (audioRef.current) {
        if (isPausedAiAudio) {
          audioRef.current.play();
          setIsPausedAiAudio(false);
        } else {
          audioRef.current.pause();
          setIsPausedAiAudio(true);
        }
      }
      return;
    }

    // 3. Otherwise, synthesize and start playback
    handlePlayAiAudio(text);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1">
            <Button
              type="button"
              variant={isCurrentActive ? 'default' : variant}
              size={size}
              onClick={handleClick}
              disabled={isSynthesizing}
              className={`transition-all duration-200 ${
                isCurrentActive
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs animate-pulse ring-2 ring-indigo-400/50'
                  : 'text-muted-foreground hover:text-foreground'
              } ${className}`}
              aria-label={
                isSynthesizing
                  ? 'Synthesizing voice explanation'
                  : isCurrentActive
                  ? isPaused
                    ? 'Resume voice reading'
                    : 'Pause voice reading'
                  : 'Read aloud with AI voice'
              }
            >
              {isSynthesizing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
              ) : isCurrentActive ? (
                isPaused ? (
                  <Play className="h-3.5 w-3.5 shrink-0 ml-0.5" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5 shrink-0 animate-bounce text-white" />
                )
              ) : (
                <Volume2 className="h-3.5 w-3.5 shrink-0" />
              )}

              {showLabel && (
                <span className="text-xs font-medium ml-1.5 whitespace-nowrap">
                  {isSynthesizing
                    ? 'Synthesizing (5-10s)...'
                    : isCurrentActive
                    ? isPaused
                      ? 'Paused'
                      : 'Playing Audio...'
                    : label}
                </span>
              )}

              {showVoiceBadge && !isSynthesizing && !isCurrentActive && (
                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-muted text-muted-foreground ml-1">
                  {activeVoice}
                </span>
              )}
            </Button>

            {isCurrentActive && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleStop}
                className="h-7 w-7 text-destructive hover:bg-destructive/10 shrink-0"
                title="Stop voice synthesis"
              >
                <VolumeX className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>
            {isSynthesizing
              ? `Synthesizing pedagogical explanation using ${activeProvider.toUpperCase()} (${activeVoice} voice)...`
              : isCurrentActive
              ? isPaused
                ? 'Click to resume AI voice lecture'
                : 'Click to pause AI voice lecture'
              : `Listen via ${activeProvider.toUpperCase()} (${activeVoice} • ${activeSpeed}x)`}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
