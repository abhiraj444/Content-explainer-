'use client';

/**
 * Universal Audio Player Service
 * Eliminates "source is not attached" errors by using:
 * 1. Safe Blob URLs (URL.createObjectURL) instead of large base64 data URIs
 * 2. Proper cleanup via removeAttribute('src') and load() instead of audio.src = ''
 * 3. Automatic Web Audio API fallback (AudioContext.decodeAudioData) if HTMLMediaElement fails
 */

export interface AudioPlaybackController {
  pause: () => void;
  resume: () => Promise<void>;
  stop: () => void;
  setSpeed: (speed: number) => void;
  isPlaying: () => boolean;
  isPaused: () => boolean;
}

export interface AudioPlaybackCallbacks {
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (error: any) => void;
}

/**
 * Converts a base64 string (with or without data URL prefix) into a native Blob.
 */
export function base64ToBlob(base64String: string, defaultMimeType = 'audio/wav'): Blob {
  try {
    let cleanBase64 = base64String;
    let mimeType = defaultMimeType;

    if (base64String.includes(',')) {
      const parts = base64String.split(',');
      cleanBase64 = parts[1];
      const match = parts[0].match(/:(.*?);/);
      if (match && match[1]) {
        mimeType = match[1];
      }
    }

    const binaryString = window.atob(cleanBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  } catch (err) {
    console.error('Failed to convert base64 to Blob:', err);
    throw new Error('Invalid audio data format.');
  }
}

class UniversalAudioPlayer {
  private activeAudio: HTMLAudioElement | null = null;
  private activeBlobUrl: string | null = null;
  private activeWebAudioCtx: AudioContext | null = null;
  private activeBufferSource: AudioBufferSourceNode | null = null;
  private isUsingWebAudio = false;
  private currentPlaying = false;
  private currentPaused = false;

  /**
   * Stop any ongoing audio playback across HTML5 Audio and Web Audio API.
   */
  public stopAll(): void {
    // 1. Stop HTML5 audio
    if (this.activeAudio) {
      try {
        this.activeAudio.pause();
        // Crucial: removeAttribute rather than setting src = ''
        this.activeAudio.removeAttribute('src');
        this.activeAudio.load();
      } catch (err) {
        console.warn('HTMLAudio cleanup warning:', err);
      }
      this.activeAudio = null;
    }

    // 2. Revoke Object URL to release memory
    if (this.activeBlobUrl) {
      try {
        URL.revokeObjectURL(this.activeBlobUrl);
      } catch {}
      this.activeBlobUrl = null;
    }

    // 3. Stop Web Audio API buffer source
    if (this.activeBufferSource) {
      try {
        this.activeBufferSource.stop();
        this.activeBufferSource.disconnect();
      } catch {}
      this.activeBufferSource = null;
    }

    if (this.activeWebAudioCtx) {
      try {
        this.activeWebAudioCtx.close();
      } catch {}
      this.activeWebAudioCtx = null;
    }

    this.isUsingWebAudio = false;
    this.currentPlaying = false;
    this.currentPaused = false;
  }

  /**
   * Play base64 audio with bulletproof error recovery and Web Audio API fallback.
   */
  public async playBase64(
    base64OrDataUrl: string,
    mimeType = 'audio/wav',
    speed = 1.0,
    callbacks: AudioPlaybackCallbacks = {}
  ): Promise<AudioPlaybackController> {
    this.stopAll();

    const blob = base64ToBlob(base64OrDataUrl, mimeType);
    const blobUrl = URL.createObjectURL(blob);
    this.activeBlobUrl = blobUrl;

    const audio = new Audio();
    this.activeAudio = audio;
    audio.preload = 'auto';
    audio.playbackRate = Math.max(0.5, Math.min(2.0, speed));

    const handleEnded = () => {
      this.currentPlaying = false;
      this.currentPaused = false;
      callbacks.onEnded?.();
    };

    const handlePause = () => {
      this.currentPlaying = false;
      this.currentPaused = true;
      callbacks.onPause?.();
    };

    const handlePlay = () => {
      this.currentPlaying = true;
      this.currentPaused = false;
      callbacks.onPlay?.();
    };

    const handleTimeUpdate = () => {
      if (audio && !isNaN(audio.duration)) {
        callbacks.onTimeUpdate?.(audio.currentTime, audio.duration);
      }
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);

    audio.src = blobUrl;

    try {
      await audio.play();
      this.currentPlaying = true;
      this.currentPaused = false;
    } catch (playError: any) {
      console.warn('HTML5 audio.play failed, falling back to Web Audio API buffer playback:', playError);

      // Web Audio API Fallback (Bypasses any media source or browser iframe restrictions)
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('Web Audio API not supported in this browser.');
        }

        const ctx = new AudioContextClass();
        this.activeWebAudioCtx = ctx;

        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const source = ctx.createBufferSource();
        this.activeBufferSource = source;
        source.buffer = audioBuffer;
        source.playbackRate.value = speed;
        source.connect(ctx.destination);

        this.isUsingWebAudio = true;
        this.currentPlaying = true;
        this.currentPaused = false;

        source.onended = () => {
          this.currentPlaying = false;
          this.currentPaused = false;
          callbacks.onEnded?.();
        };

        source.start(0);
        callbacks.onPlay?.();
      } catch (fallbackError: any) {
        console.error('All audio playback methods failed:', fallbackError);
        this.stopAll();
        callbacks.onError?.(fallbackError);
        throw fallbackError;
      }
    }

    const controller: AudioPlaybackController = {
      pause: () => {
        if (this.isUsingWebAudio && this.activeWebAudioCtx) {
          if (this.activeWebAudioCtx.state === 'running') {
            this.activeWebAudioCtx.suspend();
            this.currentPlaying = false;
            this.currentPaused = true;
            callbacks.onPause?.();
          }
        } else if (this.activeAudio) {
          this.activeAudio.pause();
        }
      },
      resume: async () => {
        if (this.isUsingWebAudio && this.activeWebAudioCtx) {
          if (this.activeWebAudioCtx.state === 'suspended') {
            await this.activeWebAudioCtx.resume();
            this.currentPlaying = true;
            this.currentPaused = false;
            callbacks.onPlay?.();
          }
        } else if (this.activeAudio) {
          await this.activeAudio.play();
        }
      },
      stop: () => {
        this.stopAll();
        callbacks.onEnded?.();
      },
      setSpeed: (newSpeed: number) => {
        const clamped = Math.max(0.5, Math.min(2.0, newSpeed));
        if (this.activeAudio) {
          this.activeAudio.playbackRate = clamped;
        }
        if (this.activeBufferSource) {
          this.activeBufferSource.playbackRate.value = clamped;
        }
      },
      isPlaying: () => this.currentPlaying,
      isPaused: () => this.currentPaused,
    };

    return controller;
  }
}

export const AudioPlayerService = new UniversalAudioPlayer();
export const universalAudioPlayer = AudioPlayerService;
