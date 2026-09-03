'use client';

import React from 'react';
import { useSettings, type TargetLanguage, type AudienceMode } from '@/context/SettingsContext';
import type { TtsAudioPreference } from '@/types';
import { Stethoscope, Sparkles, Globe, BookOpen, Info, Volume2, Headphones, Check } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface ModeLanguageSelectorProps {
  className?: string;
  compact?: boolean;
  showAudioPreference?: boolean;
  onModeChange?: (mode: AudienceMode) => void;
  onLanguageChange?: (lang: TargetLanguage) => void;
  onAudioPreferenceChange?: (pref: TtsAudioPreference) => void;
}

export function ModeLanguageSelector({
  className = '',
  compact = false,
  showAudioPreference = true,
  onModeChange,
  onLanguageChange,
  onAudioPreferenceChange,
}: ModeLanguageSelectorProps) {
  const {
    language,
    setLanguage,
    audienceMode,
    setAudienceMode,
    ttsAudioPreference,
    setTtsAudioPreference,
  } = useSettings();

  const handleModeSelect = (mode: AudienceMode) => {
    setAudienceMode(mode);
    if (onModeChange) onModeChange(mode);
  };

  const handleLanguageSelect = (lang: TargetLanguage) => {
    setLanguage(lang);
    if (onLanguageChange) onLanguageChange(lang);
  };

  const handleAudioPrefSelect = (pref: TtsAudioPreference) => {
    setTtsAudioPreference(pref);
    if (onAudioPreferenceChange) onAudioPreferenceChange(pref);
  };

  if (compact) {
    return (
      <div className={cn('w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap', className)}>
        {/* Audience Mode Toggle */}
        <div className="grid grid-cols-2 w-full sm:w-auto rounded-lg border bg-muted/50 p-0.5 shadow-2xs">
          <Button
            type="button"
            variant={audienceMode === 'doctor' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleModeSelect('doctor')}
            className={cn(
              'h-8 px-2 text-xs font-semibold gap-1.5 rounded-md transition-all justify-center',
              audienceMode === 'doctor'
                ? 'shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Stethoscope className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              <span className="sm:hidden">Doctor</span>
              <span className="hidden sm:inline">Doctor (Clinical)</span>
            </span>
          </Button>
          <Button
            type="button"
            variant={audienceMode === 'simplified' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleModeSelect('simplified')}
            className={cn(
              'h-8 px-2 text-xs font-semibold gap-1.5 rounded-md transition-all justify-center',
              audienceMode === 'simplified'
                ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              <span className="sm:hidden">Simplified</span>
              <span className="hidden sm:inline">Simplified</span>
            </span>
          </Button>
        </div>

        {/* Language Toggle */}
        <div className="grid grid-cols-2 w-full sm:w-auto rounded-lg border bg-muted/50 p-0.5 shadow-2xs">
          <Button
            type="button"
            variant={language === 'english' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleLanguageSelect('english')}
            className={cn(
              'h-8 px-2 text-xs font-semibold gap-1 rounded-md transition-all justify-center',
              language === 'english'
                ? 'shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Globe className="h-3 w-3 shrink-0" />
            <span>English</span>
          </Button>
          <Button
            type="button"
            variant={language === 'hinglish' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleLanguageSelect('hinglish')}
            className={cn(
              'h-8 px-2 text-xs font-semibold gap-1 rounded-md transition-all justify-center',
              language === 'hinglish'
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>🇮🇳 Hinglish</span>
          </Button>
        </div>

        {/* Audio Accent Toggle */}
        {showAudioPreference && (
          <div className="flex items-center gap-1 rounded-lg border bg-muted/50 p-0.5 shadow-2xs w-full sm:w-auto overflow-x-auto">
            <span className="text-[10px] font-semibold text-muted-foreground px-1.5 flex items-center gap-1 shrink-0">
              <Headphones className="h-3 w-3 text-indigo-500" />
              <span>Voice:</span>
            </span>
            <Button
              type="button"
              variant={ttsAudioPreference === 'hinglish_indian' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleAudioPrefSelect('hinglish_indian')}
              className={cn(
                'h-7 px-2 text-[11px] font-medium rounded-md transition-all justify-center shrink-0',
                ttsAudioPreference === 'hinglish_indian'
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Hinglish language in Indian tone"
            >
              <span>🇮🇳 Hinglish (Indian)</span>
            </Button>
            <Button
              type="button"
              variant={ttsAudioPreference === 'english_indian' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleAudioPrefSelect('english_indian')}
              className={cn(
                'h-7 px-2 text-[11px] font-medium rounded-md transition-all justify-center shrink-0',
                ttsAudioPreference === 'english_indian'
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="English language in Indian tone"
            >
              <span>🇮🇳 English (Indian)</span>
            </Button>
            <Button
              type="button"
              variant={ttsAudioPreference === 'english_american' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleAudioPrefSelect('english_american')}
              className={cn(
                'h-7 px-2 text-[11px] font-medium rounded-md transition-all justify-center shrink-0',
                ttsAudioPreference === 'english_american'
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="English language in American accent"
            >
              <span>🇺🇸 US Accent</span>
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'w-full rounded-xl border bg-gradient-to-r from-card to-muted/30 p-3 sm:p-4 shadow-2xs space-y-4 overflow-hidden',
        className
      )}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Audience Mode Section */}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">Presentation &amp; Tone</span>
          </div>
          <div className="grid grid-cols-2 w-full rounded-lg border bg-background/90 p-1 shadow-2xs gap-1">
            <Button
              type="button"
              variant={audienceMode === 'doctor' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleModeSelect('doctor')}
              className={cn(
                'h-9 px-2 text-xs font-semibold gap-1.5 rounded-md transition-all justify-center w-full min-w-0',
                audienceMode === 'doctor'
                  ? 'shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Stethoscope className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                <span className="inline lg:hidden">Doctor</span>
                <span className="hidden lg:inline">Doctor / Clinical</span>
              </span>
            </Button>
            <Button
              type="button"
              variant={audienceMode === 'simplified' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleModeSelect('simplified')}
              className={cn(
                'h-9 px-2 text-xs font-semibold gap-1.5 rounded-md transition-all justify-center w-full min-w-0',
                audienceMode === 'simplified'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                <span className="inline lg:hidden">Simplified</span>
                <span className="hidden lg:inline">Simplified / Patient</span>
              </span>
            </Button>
          </div>
        </div>

        {/* Output Language Section */}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">Written Content Language</span>
          </div>
          <div className="grid grid-cols-2 w-full rounded-lg border bg-background/90 p-1 shadow-2xs gap-1">
            <Button
              type="button"
              variant={language === 'english' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleLanguageSelect('english')}
              className={cn(
                'h-9 px-2 text-xs font-semibold gap-1.5 rounded-md transition-all justify-center w-full min-w-0',
                language === 'english'
                  ? 'shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span>🇬🇧</span>
              <span className="truncate">English</span>
            </Button>
            <Button
              type="button"
              variant={language === 'hinglish' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleLanguageSelect('hinglish')}
              className={cn(
                'h-9 px-2 text-xs font-semibold gap-1.5 rounded-md transition-all justify-center w-full min-w-0',
                language === 'hinglish'
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span>🇮🇳</span>
              <span className="truncate">
                <span className="inline lg:hidden">Hinglish</span>
                <span className="hidden lg:inline">Hinglish (Roman)</span>
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Global Voice / Audio Accent Tone Preference */}
      {showAudioPreference && (
        <div className="space-y-2 pt-2 border-t border-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Headphones className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
              <span>Spoken Voice Tone &amp; Accent Preference</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-medium">
              Applied globally across all audio narrations
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              {
                id: 'hinglish_indian',
                title: 'Hinglish (Indian Tone)',
                badge: '🇮🇳 Most Popular in India',
                desc: 'Natural Hindi + English mix with a warm, encouraging Indian educator cadence.',
              },
              {
                id: 'english_indian',
                title: 'English (Indian Tone)',
                badge: '🇮🇳 Highly Clear',
                desc: 'Articulate, clear English spoken with a natural Indian accent. No confusing American slang.',
              },
              {
                id: 'english_american',
                title: 'American Accent',
                badge: '🇺🇸 Standard US',
                desc: 'Standard American English accent and pronunciation pacing.',
              },
            ].map((option) => {
              const isSelected = ttsAudioPreference === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleAudioPrefSelect(option.id as TtsAudioPreference)}
                  className={cn(
                    'flex flex-col items-start p-3 rounded-xl border text-left transition-all relative',
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40 shadow-xs ring-1 ring-indigo-500'
                      : 'border-border/70 hover:border-indigo-300 hover:bg-muted/40 bg-card'
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="font-semibold text-xs text-foreground truncate">{option.title}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 ml-1" />}
                  </div>
                  <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 mb-1">
                    {option.badge}
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {option.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Explanatory Context Note */}
      <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] sm:text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-0.5 min-w-0 flex-1">
          <p className="leading-relaxed">
            <span className="font-semibold text-foreground">Global Audio Preference:</span> When listening to audio explanations, slide voiceovers, or clinical breakdowns, voice will speak in{' '}
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">
              {ttsAudioPreference === 'hinglish_indian'
                ? 'Hinglish in an authentic Indian educator tone'
                : ttsAudioPreference === 'english_indian'
                ? 'clear English in a natural Indian accent'
                : 'English with an American accent'}
            </span>.
          </p>
        </div>
      </div>
    </div>
  );
}

