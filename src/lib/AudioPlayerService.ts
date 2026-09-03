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

export interface StreamAudioChunk {
  index: number;
  totalChunks?: number;
  text: string;
  audioBase64?: string;
  audioDataUrl?: string;
  blob?: Blob;
  mimeType?: string;
  isLast?: boolean;
  latencyMs?: number;
  status?: 'pending' | 'synthesizing' | 'ready' | 'playing' | 'played' | 'error';
}

export interface StreamingAudioPlaybackCallbacks {
  onStart?: () => void;
  onChunkStart?: (chunk: StreamAudioChunk) => void;
  onChunkLoaded?: (chunk: StreamAudioChunk) => void;
  onChunkEnded?: (chunk: StreamAudioChunk) => void;
  onProgress?: (progress: {
    currentChunkIndex: number;
    totalChunks: number;
    loadedChunks: number;
    activeText: string;
    allChunks: StreamAudioChunk[];
    isBuffering: boolean;
  }) => void;
  onBufferingChange?: (isBuffering: boolean) => void;
  onChunkChange?: (chunkIndex: number, total: number) => void;
  onTimeUpdate?: (currentTime: number, totalDuration: number) => void;
  onPause?: () => void;
  onResume?: () => void;
  onEnded?: (completedChunks: StreamAudioChunk[]) => void;
  onError?: (error: any) => void;
}

export interface StreamingAudioController extends AudioPlaybackController {
  feedChunk: (chunkOrBase64: StreamAudioChunk | string, mimeType?: string, text?: string) => void;
  markStreamComplete: (totalChunks?: number) => void;
  skipCurrentChunk: () => void;
  getCurrentChunk: () => StreamAudioChunk | null;
  getAllChunks: () => StreamAudioChunk[];
}

/**
 * Intelligent Text Chunker for Speech Synthesis
 * Breaks text into natural spoken phrases & complete sentences (averaging 60-140 chars)
 * respecting clinical abbreviations (Dr., mg., ml., vs., tab., cap., i.e., e.g.).
 */
export function splitTextIntoSpeechChunks(text: string, targetMaxChars = 140): string[] {
  if (!text) return [];
  const clean = text
    .replace(/[*#`_~\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length <= targetMaxChars) {
    return [clean];
  }

  // Regex to match sentence terminators (. ! ? ; or newline)
  // Protects abbreviations like Dr., Mr., vs., e.g., i.e., tab., cap., mg., mL.
  const sentences: string[] = [];
  const rawParts = clean.split(/(?<=[.!?;\n])\s+/);

  let currentSentence = '';
  for (const part of rawParts) {
    if (!part) continue;
    // Check if the part ends with a common abbreviation
    const isAbbr = /\b(Dr|Mr|Mrs|Ms|Prof|vs|eg|ie|etc|tab|cap|mg|ml|mcg|kg|approx|no)\.$/i.test(part.trim());
    if (isAbbr) {
      currentSentence += (currentSentence ? ' ' : '') + part;
    } else {
      if (currentSentence) {
        currentSentence += ' ' + part;
        sentences.push(currentSentence);
        currentSentence = '';
      } else {
        sentences.push(part);
      }
    }
  }
  if (currentSentence) {
    sentences.push(currentSentence);
  }

  // Group sentences up to targetMaxChars
  const groupedChunks: string[] = [];
  let chunkAcc = '';

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;

    if (!chunkAcc) {
      chunkAcc = s;
    } else if (chunkAcc.length + s.length + 1 <= targetMaxChars) {
      chunkAcc += ' ' + s;
    } else {
      groupedChunks.push(chunkAcc);
      chunkAcc = s;
    }
  }

  if (chunkAcc) {
    groupedChunks.push(chunkAcc);
  }

  // Break any remaining oversized chunk at clauses or commas
  const finalChunks: string[] = [];
  for (const chunk of groupedChunks) {
    if (chunk.length > 200) {
      const parts = chunk.split(/([,:\–\—]|\band\b|\bbut\b|\bbecause\b|\bwith\b)/i);
      let sub = '';
      for (const p of parts) {
        if (!sub) sub = p;
        else if (sub.length + p.length <= targetMaxChars) sub += p;
        else {
          if (sub.trim()) finalChunks.push(sub.trim());
          sub = p;
        }
      }
      if (sub.trim()) finalChunks.push(sub.trim());
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks.filter(c => c.trim().length > 0);
}

/**
 * Converts a base64 string (with or without data URL prefix) into a native Blob.
 */
export function base64ToBlob(base64String: string, defaultMimeType = 'audio/wav'): Blob {
  try {
    let cleanBase64 = base64String.trim();
    let mimeType = defaultMimeType;

    if (cleanBase64.includes(',')) {
      const parts = cleanBase64.split(',');
      cleanBase64 = parts[1];
      const match = parts[0].match(/:(.*?);/);
      if (match && match[1]) {
        mimeType = match[1];
      }
    }

    // Safety check: if string begins with "eyJ" (JSON base64 '{'), it is an error payload, not audio
    if (cleanBase64.startsWith('eyJ') || cleanBase64.startsWith('eyI')) {
      throw new Error('TTS service returned a JSON text payload instead of an audio stream.');
    }

    const binaryString = window.atob(cleanBase64);
    const len = binaryString.length;
    
    // Check if the decoded string starts with ASCII '{' or '<'
    if (len > 0 && (binaryString.charCodeAt(0) === 123 || binaryString.charCodeAt(0) === 60)) {
      throw new Error('Audio stream contains text/JSON data rather than playable audio.');
    }

    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  } catch (err: any) {
    console.warn('Failed to convert base64 to Blob:', err?.message || err);
    throw new Error(err?.message || 'Invalid audio data format.');
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
  public stop(): void {
    this.stopAll();
  }

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
   * Supports either (data, mimeType, speed, callbacks) OR (data, mimeType, callbacks).
   */
  public async playBase64(
    base64OrDataUrl: string,
    mimeType = 'audio/wav',
    speedOrCallbacks: number | AudioPlaybackCallbacks = 1.0,
    callbacksArg: AudioPlaybackCallbacks = {}
  ): Promise<AudioPlaybackController> {
    this.stopAll();

    let speed = 1.0;
    let callbacks: AudioPlaybackCallbacks = callbacksArg;

    if (typeof speedOrCallbacks === 'object' && speedOrCallbacks !== null) {
      callbacks = speedOrCallbacks;
      speed = 1.0;
    } else if (typeof speedOrCallbacks === 'number' && !isNaN(speedOrCallbacks)) {
      speed = speedOrCallbacks;
    }

    const safeSpeed = Math.max(0.5, Math.min(2.0, speed || 1.0));

    const blob = base64ToBlob(base64OrDataUrl, mimeType);
    const blobUrl = URL.createObjectURL(blob);
    this.activeBlobUrl = blobUrl;

    const audio = new Audio();
    this.activeAudio = audio;
    audio.preload = 'auto';
    audio.playbackRate = safeSpeed;

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
      console.warn('HTML5 audio.play deferred or failed, falling back to Web Audio API buffer playback:', playError?.message || playError);

      // Web Audio API Fallback (Bypasses any media source or browser iframe restrictions)
      try {
        const arrayBuffer = await blob.arrayBuffer();
        if (arrayBuffer.byteLength < 100) {
          throw new Error('Audio payload is too small or incomplete to decode.');
        }

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('Web Audio API not supported in this browser.');
        }

        const ctx = new AudioContextClass();
        this.activeWebAudioCtx = ctx;

        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }

        // Decode audio data safely with sliced buffer to prevent detachment issues
        let audioBuffer: AudioBuffer;
        try {
          audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
            const decodePromise = ctx.decodeAudioData(
              arrayBuffer.slice(0),
              (buf) => resolve(buf),
              (err) => reject(err || new Error('Audio decoding failed'))
            );
            if (decodePromise && typeof decodePromise.then === 'function') {
              decodePromise.then(resolve).catch(reject);
            }
          });
        } catch (decodeErr: any) {
          console.warn('Web Audio decodeAudioData rejected:', decodeErr?.message || decodeErr);
          throw new Error('Unable to decode audio stream: Format not supported or data corrupted.');
        }

        const source = ctx.createBufferSource();
        this.activeBufferSource = source;
        source.buffer = audioBuffer;
        source.playbackRate.value = safeSpeed;
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
        console.warn('All audio playback methods caught fallback error:', fallbackError?.message || fallbackError);
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

  /**
   * Play streaming audio queue with gapless progression, sub-second TTFB,
   * live buffering handling, and dynamic chunk feed.
   */
  public playStreaming(
    speed = 1.0,
    callbacks: StreamingAudioPlaybackCallbacks = {}
  ): StreamingAudioController {
    this.stopAll();

    let currentSpeed = Math.max(0.5, Math.min(2.0, speed || 1.0));
    const chunks: StreamAudioChunk[] = [];
    let isStreamMarkedComplete = false;
    let expectedTotal = 0;
    let activeChunkIndex = -1;
    let activeChunkController: AudioPlaybackController | null = null;
    let isBuffering = false;
    let isStopped = false;
    let isPausedState = false;

    let prevBufferingState: boolean | null = null;
    let prevChunkIndex: number | null = null;

    const notifyProgress = () => {
      if (isStopped) return;
      const loadedCount = chunks.filter(c => c.status === 'ready' || c.status === 'playing' || c.status === 'played').length;
      const activeText = activeChunkIndex >= 0 && chunks[activeChunkIndex] ? chunks[activeChunkIndex].text : '';
      
      if (prevBufferingState !== isBuffering) {
        prevBufferingState = isBuffering;
        callbacks.onBufferingChange?.(isBuffering);
      }

      if (prevChunkIndex !== activeChunkIndex && activeChunkIndex >= 0) {
        prevChunkIndex = activeChunkIndex;
        callbacks.onChunkChange?.(activeChunkIndex, expectedTotal || chunks.length);
      }

      callbacks.onProgress?.({
        currentChunkIndex: activeChunkIndex,
        totalChunks: expectedTotal || chunks.length,
        loadedChunks: loadedCount,
        activeText,
        allChunks: [...chunks],
        isBuffering,
      });
    };

    const tryPlayNextChunk = async () => {
      if (isStopped || isPausedState) return;

      const nextIndex = activeChunkIndex + 1;
      const nextChunk = chunks[nextIndex];

      if (!nextChunk) {
        if (isStreamMarkedComplete && nextIndex >= (expectedTotal || chunks.length)) {
          // Finished all chunks!
          this.currentPlaying = false;
          this.currentPaused = false;
          callbacks.onEnded?.(chunks);
        } else {
          // Waiting for more chunks to be synthesized
          isBuffering = true;
          notifyProgress();
        }
        return;
      }

      if (nextChunk.status === 'ready' && (nextChunk.audioBase64 || nextChunk.blob)) {
        isBuffering = false;
        activeChunkIndex = nextIndex;
        nextChunk.status = 'playing';
        notifyProgress();
        callbacks.onChunkStart?.(nextChunk);

        try {
          const base64Data = nextChunk.audioBase64 || (nextChunk.audioDataUrl || '');
          activeChunkController = await this.playBase64(
            base64Data,
            nextChunk.mimeType || 'audio/wav',
            currentSpeed,
            {
              onPlay: () => {
                this.currentPlaying = true;
                this.currentPaused = false;
                if (nextIndex === 0) {
                  callbacks.onStart?.();
                }
              },
              onPause: () => {
                this.currentPlaying = false;
                this.currentPaused = true;
                callbacks.onPause?.();
              },
              onTimeUpdate: (cur, dur) => {
                callbacks.onTimeUpdate?.(cur, dur);
              },
              onEnded: () => {
                if (isStopped) return;
                nextChunk.status = 'played';
                callbacks.onChunkEnded?.(nextChunk);
                notifyProgress();
                // Immediately proceed to the next chunk
                tryPlayNextChunk();
              },
              onError: (err) => {
                console.warn(`Chunk ${nextIndex} playback error:`, err);
                nextChunk.status = 'error';
                notifyProgress();
                // Attempt next chunk despite failure of current
                tryPlayNextChunk();
              },
            }
          );
        } catch (playErr) {
          console.warn(`Failed to play chunk ${nextIndex}:`, playErr);
          nextChunk.status = 'error';
          notifyProgress();
          tryPlayNextChunk();
        }
      } else if (nextChunk.status === 'error') {
        // Skip errored chunk
        activeChunkIndex = nextIndex;
        tryPlayNextChunk();
      } else {
        // Chunk is not ready yet
        isBuffering = true;
        notifyProgress();
      }
    };

    const controller: StreamingAudioController = {
      feedChunk: (chunkOrBase64: StreamAudioChunk | string, mimeType?: string, text?: string) => {
        if (isStopped) return;
        let resolvedChunk: StreamAudioChunk;
        if (typeof chunkOrBase64 === 'string') {
          resolvedChunk = {
            index: chunks.length,
            text: text || '',
            audioBase64: chunkOrBase64,
            mimeType: mimeType || 'audio/wav',
            status: 'ready',
          };
        } else {
          resolvedChunk = {
            ...chunkOrBase64,
            status: chunkOrBase64.status || (chunkOrBase64.audioBase64 || chunkOrBase64.blob ? 'ready' : 'pending'),
          };
        }

        const existingIdx = chunks.findIndex(c => c.index === resolvedChunk.index);
        if (existingIdx >= 0) {
          chunks[existingIdx] = resolvedChunk;
        } else {
          chunks.push(resolvedChunk);
          chunks.sort((a, b) => a.index - b.index);
        }

        if (resolvedChunk.totalChunks) {
          expectedTotal = Math.max(expectedTotal, resolvedChunk.totalChunks);
        }

        callbacks.onChunkLoaded?.(resolvedChunk);
        notifyProgress();

        // If we were idling or buffering, start playback immediately!
        if (activeChunkIndex === -1 || isBuffering) {
          tryPlayNextChunk();
        }
      },

      markStreamComplete: (totalChunks?: number) => {
        isStreamMarkedComplete = true;
        if (totalChunks) expectedTotal = totalChunks;
        notifyProgress();
        if (isBuffering || activeChunkIndex === -1) {
          tryPlayNextChunk();
        }
      },

      pause: () => {
        isPausedState = true;
        if (activeChunkController) {
          activeChunkController.pause();
        }
        this.currentPlaying = false;
        this.currentPaused = true;
        callbacks.onPause?.();
      },

      resume: async () => {
        isPausedState = false;
        if (activeChunkController) {
          await activeChunkController.resume();
          this.currentPlaying = true;
          this.currentPaused = false;
          callbacks.onResume?.();
        } else {
          tryPlayNextChunk();
        }
      },

      stop: () => {
        isStopped = true;
        this.stopAll();
        chunks.length = 0;
        this.currentPlaying = false;
        this.currentPaused = false;
        callbacks.onEnded?.([]);
      },

      skipCurrentChunk: () => {
        if (activeChunkController) {
          activeChunkController.stop();
        }
      },

      setSpeed: (newSpeed: number) => {
        currentSpeed = Math.max(0.5, Math.min(2.0, newSpeed));
        if (activeChunkController) {
          activeChunkController.setSpeed(currentSpeed);
        }
      },

      getCurrentChunk: () => {
        if (activeChunkIndex >= 0 && activeChunkIndex < chunks.length) {
          return chunks[activeChunkIndex];
        }
        return null;
      },

      getAllChunks: () => [...chunks],

      isPlaying: () => this.currentPlaying,
      isPaused: () => this.currentPaused,
    };

    return controller;
  }
}

export const AudioPlayerService = new UniversalAudioPlayer();
export const universalAudioPlayer = AudioPlayerService;
