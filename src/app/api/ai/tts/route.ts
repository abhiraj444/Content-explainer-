import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Modality } from '@google/genai';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Converts 16-bit Mono PCM raw buffer into a standard RIFF/WAVE header buffer.
 */
function pcmToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // "fmt " sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // "data" sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Inspect magic bytes of audio buffer to determine exact audio MIME type.
 */
function detectMimeFromBytes(buf: Buffer): string {
  if (buf.length >= 12) {
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
      return 'audio/wav';
    }
    if (buf.toString('ascii', 0, 3) === 'ID3') {
      return 'audio/mp3';
    }
    if (buf.toString('ascii', 0, 4) === 'OggS') {
      return 'audio/ogg';
    }
    if (buf.toString('ascii', 0, 4) === 'fLaC') {
      return 'audio/flac';
    }
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
      return 'audio/mp3';
    }
  }
  return 'audio/mp3';
}

/**
 * Robust audio response parser: extracts audio regardless of whether the server
 * returned raw binary (MP3, WAV, OGG, PCM) or a JSON payload containing base64 (e.g. Sarvam AI).
 */
function processAudioResponse(
  rawBuffer: Buffer,
  declaredContentType: string | null
): { mimeType: string; base64Audio: string } {
  const contentType = (declaredContentType || '').toLowerCase();

  // 1. Check if the response is JSON (e.g. Sarvam AI, or error object)
  const isJson =
    contentType.includes('application/json') ||
    (rawBuffer.length > 0 && (rawBuffer[0] === 0x7b /* '{' */ || rawBuffer[0] === 0x5b /* '[' */));

  if (isJson) {
    try {
      const parsed = JSON.parse(rawBuffer.toString('utf-8'));
      if (parsed.error) {
        const errMsg = typeof parsed.error === 'string' ? parsed.error : parsed.error.message || JSON.stringify(parsed.error);
        throw new Error(errMsg);
      }
      // Sarvam AI format: { audios: ["<base64>"] }
      if (Array.isArray(parsed.audios) && parsed.audios[0]) {
        const b64 = parsed.audios[0];
        const innerBuf = Buffer.from(b64, 'base64');
        const detected = detectMimeFromBytes(innerBuf);
        return { mimeType: detected || 'audio/wav', base64Audio: b64 };
      }
      // Alternate JSON formats: { audio: "<base64>" } or { data: "<base64>" }
      if (typeof parsed.audio === 'string') {
        const b64 = parsed.audio;
        const innerBuf = Buffer.from(b64, 'base64');
        return { mimeType: detectMimeFromBytes(innerBuf) || 'audio/wav', base64Audio: b64 };
      }
      if (typeof parsed.data === 'string') {
        const b64 = parsed.data;
        const innerBuf = Buffer.from(b64, 'base64');
        return { mimeType: detectMimeFromBytes(innerBuf) || 'audio/wav', base64Audio: b64 };
      }
    } catch (e: any) {
      if (e.message && !e.message.includes('Unexpected') && !e.message.includes('JSON')) {
        throw e;
      }
    }
  }

  // 2. Handle raw PCM if declared or detected
  if (contentType.includes('pcm') || contentType.includes('audio/l16')) {
    const wavBuf = pcmToWavBuffer(rawBuffer, 24000, 1, 16);
    return { mimeType: 'audio/wav', base64Audio: wavBuf.toString('base64') };
  }

  // 3. Inspect magic bytes
  let mimeType = detectMimeFromBytes(rawBuffer);

  if (contentType.includes('audio/mpeg') || contentType.includes('audio/mp3')) {
    mimeType = 'audio/mp3';
  } else if (contentType.includes('audio/wav') || contentType.includes('audio/x-wav')) {
    mimeType = 'audio/wav';
  } else if (contentType.includes('audio/ogg')) {
    mimeType = 'audio/ogg';
  }

  return {
    mimeType: mimeType || 'audio/mp3',
    base64Audio: rawBuffer.toString('base64'),
  };
}

/**
 * Parses a multiline string of custom HTTP headers into a key-value record.
 */
function parseCustomHeaders(headersStr?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headersStr || typeof headersStr !== 'string') return result;

  const lines = headersStr.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (key && val) {
        result[key] = val;
      }
    }
  }
  return result;
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk.includes('key') || lk.includes('auth') || lk.includes('token') || lk.includes('secret')) {
      if (v.length > 12) {
        masked[k] = `${v.slice(0, 4)}••••••••${v.slice(-4)}`;
      } else {
        masked[k] = '••••••••';
      }
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

/**
 * Parses custom JSON parameters (string or object) and applies them to the request payload.
 * Setting a key's value to null or undefined in customParams will explicitly delete that key from the target payload.
 */
function applyCustomParams(target: Record<string, any>, customParams?: string | Record<string, any>): void {
  if (!customParams) return;
  let parsed: Record<string, any> | null = null;
  if (typeof customParams === 'string') {
    const trimmed = customParams.trim();
    if (!trimmed) return;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e: any) {
      console.warn('Could not parse customParams JSON in TTS route:', e.message);
      return;
    }
  } else if (typeof customParams === 'object' && customParams !== null) {
    parsed = customParams;
  }

  if (parsed && typeof parsed === 'object') {
    for (const [key, val] of Object.entries(parsed)) {
      if (val === null || val === undefined) {
        delete target[key];
      } else {
        target[key] = val;
      }
    }
  }
}

export async function performTtsSynthesis(body: any): Promise<{
  success: boolean;
  provider: string;
  mimeType: string;
  audioDataUrl: string;
  audioBase64: string;
  voice?: string;
  sampleRate?: number;
  requestDetails?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
  };
}> {
  const {
    text,
    provider: rawProvider = 'gemini',
    voice: rawVoice = 'Kore',
    apiKey: clientApiKey,
    endpoint: rawEndpoint,
    model: rawModel,
    speed: rawSpeed = 1.0,
    language = 'english',
    audioPreference = 'english_indian',
    customFormat = 'auto',
    customHeaders,
    customParams,
    sarvamLanguage: rawSarvamLang,
  } = body;

  // Parse custom parameters for top-level overrides
  let parsedCustom: Record<string, any> = {};
  if (customParams) {
    if (typeof customParams === 'string' && customParams.trim()) {
      try {
        parsedCustom = JSON.parse(customParams.trim());
      } catch {}
    } else if (typeof customParams === 'object' && customParams !== null) {
      parsedCustom = customParams;
    }
  }

  const provider = (parsedCustom.provider || rawProvider || 'gemini').toLowerCase();
  const voice = parsedCustom.voice || parsedCustom.speaker || rawVoice;
  const model = parsedCustom.model || parsedCustom.model_id || rawModel;
  const endpoint = parsedCustom.endpoint || parsedCustom.url || rawEndpoint;
  const speed = parsedCustom.speed !== undefined ? parsedCustom.speed : (parsedCustom.pace !== undefined ? parsedCustom.pace : rawSpeed);
  const sarvamLanguage = parsedCustom.target_language_code || parsedCustom.sarvamLanguage || rawSarvamLang;

  const rawCustomInput = Array.isArray(parsedCustom.inputs) && parsedCustom.inputs.length > 0
    ? parsedCustom.inputs[0]
    : parsedCustom.input || parsedCustom.text || parsedCustom.prompt || parsedCustom.inputs;

  const resolvedText = rawCustomInput || text;
  if (!resolvedText || typeof resolvedText !== 'string' || !resolvedText.trim()) {
    throw new Error('Text content is required for speech synthesis.');
  }

  const cleanText = resolvedText.trim();
  const resolvedAudioPref = audioPreference || (language === 'hinglish' ? 'hinglish_indian' : 'english_indian');
  const userHeaders = parseCustomHeaders(customHeaders);

  // 1. Google Gemini Native TTS
  if (provider === 'gemini') {
    const activeGeminiKey = clientApiKey || process.env.GEMINI_API_KEY;
    if (!activeGeminiKey) {
      throw new Error('Gemini API Key is required for Gemini TTS. Please add your key in Settings or provide a valid key.');
    }

    const ai = new GoogleGenAI({
      apiKey: activeGeminiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const validGeminiVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr', 'Aoede', 'Leda', 'Orus'];
    const selectedVoice = validGeminiVoices.includes(voice) ? voice : 'Kore';

    let spokenPrompt = cleanText;
    if (resolvedAudioPref === 'hinglish_indian') {
      spokenPrompt = `Speak this explanation in a warm, natural conversational Hinglish style with a clear Indian tone and teacher cadence:\n\n${cleanText}`;
    } else if (resolvedAudioPref === 'english_indian') {
      spokenPrompt = `Speak this explanation in clear, articulate English with a natural, friendly Indian accent and warm educator cadence:\n\n${cleanText}`;
    }

    const requestedModel = model || 'gemini-3.1-flash-tts-preview';
    const modelsToTry = [requestedModel, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3.1-flash-tts-preview'].filter((v, i, a) => a.indexOf(v) === i);
    
    let response: any = null;
    let lastErr: any = null;
    let successfulModel = requestedModel;

    const requestDetails = {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent`,
      method: 'POST',
      headers: maskHeaders({
        'Content-Type': 'application/json',
        'x-goog-api-key': activeGeminiKey,
        ...userHeaders,
      }),
      body: {
        model: requestedModel,
        contents: [{ parts: [{ text: spokenPrompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      },
    };

    // Try candidate models with retry for rate limits
    modelLoop: for (const candidateModel of modelsToTry) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
          }
          response = await ai.models.generateContent({
            model: candidateModel,
            contents: [{ parts: [{ text: spokenPrompt }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: selectedVoice },
                },
              },
            },
          });

          const parts = response?.candidates?.[0]?.content?.parts || [];
          const hasAudio = parts.some((p: any) => p?.inlineData?.data);
          if (hasAudio) {
            successfulModel = candidateModel;
            break modelLoop;
          }
        } catch (err: any) {
          lastErr = err;
          const msg = (err?.message || '').toLowerCase();
          const isRetryable = msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('503') || msg.includes('overloaded');
          const isNotFound = msg.includes('not found') || msg.includes('404') || msg.includes('unsupported') || msg.includes('invalid argument');
          if (isNotFound) {
            // Immediately try next model in candidate list
            break;
          }
          if (!isRetryable || attempt === 1) {
            break;
          }
        }
      }
    }

    const parts = response?.candidates?.[0]?.content?.parts || [];
    let audioPart: any = null;
    for (const part of parts) {
      if (part?.inlineData?.data) {
        audioPart = part.inlineData;
        break;
      }
    }

    if (!audioPart || !audioPart.data) {
      const errLower = (lastErr?.message || '').toLowerCase();
      const isQuota = errLower.includes('resource_exhausted') || errLower.includes('quota') || errLower.includes('429');
      if (isQuota) {
        throw new Error('Gemini TTS Rate Limit / Quota Exceeded. Please try again in a few moments or switch TTS provider in Settings.');
      }
      throw new Error(`Gemini TTS did not return audio data (${lastErr?.message || 'Empty audio candidate'}).`);
    }

    // Convert raw PCM to standard WAV buffer for seamless browser playback
    const rawPcmBuffer = Buffer.from(audioPart.data, 'base64');
    const wavBuffer = pcmToWavBuffer(rawPcmBuffer, 24000, 1, 16);
    const wavBase64 = wavBuffer.toString('base64');

    return {
      success: true,
      provider: 'gemini',
      mimeType: 'audio/wav',
      audioDataUrl: `data:audio/wav;base64,${wavBase64}`,
      audioBase64: wavBase64,
      voice: selectedVoice,
      sampleRate: 24000,
      requestDetails,
    };
  }

  // 2. Groq Cloud (Orpheus / Kokoro)
  if (provider === 'groq') {
    const activeKey = clientApiKey || process.env.GROQ_API_KEY;
    if (!activeKey) {
      throw new Error('Groq API Key is required. Please add your Groq key (gsk_...) in Settings.');
    }

    const GROQ_ORPHEUS_VOICES = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'];
    const requestedVoice = (parsedCustom.voice || parsedCustom.speaker || voice || '').toLowerCase().trim();
    const resolvedVoice = GROQ_ORPHEUS_VOICES.includes(requestedVoice)
      ? requestedVoice
      : requestedVoice.length > 0 && !['af_heart', 'am_adam', 'default', 'alloy'].includes(requestedVoice)
        ? requestedVoice
        : 'autumn';

    const groqUrl = endpoint || 'https://api.groq.com/openai/v1/audio/speech';
    const groqHeaders: Record<string, string> = {
      Authorization: `Bearer ${activeKey}`,
      'Content-Type': 'application/json',
      ...userHeaders,
    };
    const groqBody: Record<string, any> = {
      model: parsedCustom.model || model || 'canopylabs/orpheus-v1-english',
      input: cleanText,
      voice: resolvedVoice,
      speed: Math.max(0.5, Math.min(2.0, Number(parsedCustom.speed !== undefined ? parsedCustom.speed : (parsedCustom.pace !== undefined ? parsedCustom.pace : speed)) || 1.0)),
      response_format: parsedCustom.response_format || 'wav',
    };
    applyCustomParams(groqBody, customParams);

    // Normalize canonical fields and clean aliases
    groqBody.input = groqBody.input || (Array.isArray(groqBody.inputs) ? groqBody.inputs[0] : groqBody.inputs) || groqBody.text || groqBody.prompt || cleanText;
    groqBody.voice = groqBody.voice || groqBody.speaker || resolvedVoice;
    groqBody.speed = Math.max(0.5, Math.min(2.0, Number(groqBody.speed || groqBody.pace) || 1.0));
    delete groqBody.speaker;
    delete groqBody.inputs;
    delete groqBody.text;
    delete groqBody.prompt;
    delete groqBody.pace;

    const requestDetails = {
      url: groqUrl,
      method: 'POST',
      headers: maskHeaders(groqHeaders),
      body: groqBody,
    };

    const response = await fetch(groqUrl, {
      method: 'POST',
      headers: groqHeaders,
      body: JSON.stringify(groqBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq TTS error (${response.status}): ${errorText}`);
    }

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

    return {
      success: true,
      provider: 'groq',
      mimeType: processed.mimeType,
      audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
      audioBase64: processed.base64Audio,
      voice: groqBody.voice || resolvedVoice,
      requestDetails,
    };
  }

  // 3. Sarvam AI (Indian Neural TTS - Bulbul v3 / v2 / v1)
  if (provider === 'sarvam' || (provider === 'custom' && (endpoint?.includes('sarvam.ai') || customFormat === 'sarvam'))) {
    const activeKey = clientApiKey || process.env.SARVAM_API_KEY;
    if (!activeKey) {
      throw new Error('Sarvam API Subscription Key is required. Please get your key from sarvam.ai and enter it in Settings.');
    }

    const sarvamUrl = endpoint || 'https://api.sarvam.ai/text-to-speech';
    const targetLang = parsedCustom.target_language_code || parsedCustom.language || parsedCustom.sarvamLanguage || sarvamLanguage || (resolvedAudioPref === 'hinglish_indian' ? 'hi-IN' : 'en-IN');
    const selectedSpeaker = parsedCustom.speaker || parsedCustom.voice || (voice && voice !== 'default' ? voice : 'shubh');
    const selectedModel = parsedCustom.model || model || 'bulbul:v3';
    const selectedPace = parsedCustom.pace !== undefined ? parsedCustom.pace : (parsedCustom.speed !== undefined ? parsedCustom.speed : (speed || 1.0));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-subscription-key': activeKey,
      Authorization: `Bearer ${activeKey}`,
      ...userHeaders,
    };

    const isBulbulV2 = Boolean(selectedModel && (selectedModel.toLowerCase().includes('v2') || selectedModel.toLowerCase().includes('v1')));
    const sarvamBody: Record<string, any> = {
      inputs: Array.isArray(parsedCustom.inputs) && parsedCustom.inputs.length > 0 ? parsedCustom.inputs : [cleanText],
      target_language_code: targetLang,
      speaker: selectedSpeaker,
      pace: Math.max(0.5, Math.min(2.0, Number(selectedPace) || 1.0)),
      model: selectedModel,
      output_audio_codec: parsedCustom.output_audio_codec || 'wav',
      enable_preprocessing: parsedCustom.enable_preprocessing !== undefined ? parsedCustom.enable_preprocessing : true,
    };

    if (isBulbulV2 || parsedCustom.pitch !== undefined) {
      sarvamBody.pitch = parsedCustom.pitch !== undefined ? parsedCustom.pitch : 0;
    }
    if (isBulbulV2 || parsedCustom.loudness !== undefined) {
      sarvamBody.loudness = parsedCustom.loudness !== undefined ? parsedCustom.loudness : 1.0;
    }

    applyCustomParams(sarvamBody, customParams);

    // Strictly canonicalize Sarvam payload fields and strip incompatible alias keys
    sarvamBody.inputs = Array.isArray(sarvamBody.inputs) && sarvamBody.inputs.length > 0
      ? sarvamBody.inputs
      : [sarvamBody.input || sarvamBody.text || sarvamBody.prompt || cleanText];
    sarvamBody.speaker = sarvamBody.speaker || sarvamBody.voice || selectedSpeaker;
    sarvamBody.target_language_code = sarvamBody.target_language_code || targetLang;
    sarvamBody.pace = Math.max(0.5, Math.min(2.0, Number(sarvamBody.pace || sarvamBody.speed || selectedPace) || 1.0));
    sarvamBody.model = sarvamBody.model || selectedModel;

    delete sarvamBody.voice;
    delete sarvamBody.speed;
    delete sarvamBody.input;
    delete sarvamBody.text;
    delete sarvamBody.prompt;
    delete sarvamBody.language;
    delete sarvamBody.sarvamLanguage;
    if (!isBulbulV2 && parsedCustom.pitch === undefined) {
      delete sarvamBody.pitch;
      delete sarvamBody.loudness;
    }

    const requestDetails = {
      url: sarvamUrl,
      method: 'POST',
      headers: maskHeaders(headers),
      body: sarvamBody,
    };

    const response = await fetch(sarvamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(sarvamBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sarvam AI TTS error (${response.status}): ${errorText}`);
    }

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

    return {
      success: true,
      provider: 'sarvam',
      mimeType: processed.mimeType,
      audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
      audioBase64: processed.base64Audio,
      voice: sarvamBody.speaker || selectedSpeaker,
      requestDetails,
    };
  }

  // 4. OpenRouter Audio / Kokoro
  if (provider === 'openrouter') {
    const activeKey = clientApiKey || process.env.OPENROUTER_API_KEY;
    if (!activeKey) {
      throw new Error('OpenRouter API Key is required for OpenRouter audio.');
    }

    const openRouterUrl = endpoint || 'https://openrouter.ai/api/v1/audio/speech';
    const openRouterHeaders: Record<string, string> = {
      Authorization: `Bearer ${activeKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://medigen.app',
      'X-Title': 'MediGen Voice AI',
      ...userHeaders,
    };
    const openRouterBody: Record<string, any> = {
      model: parsedCustom.model || model || 'openai/tts-1',
      input: cleanText,
      voice: parsedCustom.voice || parsedCustom.speaker || voice || 'alloy',
      speed: Math.max(0.25, Math.min(4.0, Number(parsedCustom.speed !== undefined ? parsedCustom.speed : (parsedCustom.pace !== undefined ? parsedCustom.pace : speed)) || 1.0)),
      response_format: parsedCustom.response_format || 'mp3',
    };
    applyCustomParams(openRouterBody, customParams);

    openRouterBody.input = openRouterBody.input || (Array.isArray(openRouterBody.inputs) ? openRouterBody.inputs[0] : openRouterBody.inputs) || openRouterBody.text || openRouterBody.prompt || cleanText;
    openRouterBody.voice = openRouterBody.voice || openRouterBody.speaker || voice || 'alloy';
    delete openRouterBody.speaker;
    delete openRouterBody.inputs;
    delete openRouterBody.text;
    delete openRouterBody.prompt;
    delete openRouterBody.pace;

    const requestDetails = {
      url: openRouterUrl,
      method: 'POST',
      headers: maskHeaders(openRouterHeaders),
      body: openRouterBody,
    };

    const response = await fetch(openRouterUrl, {
      method: 'POST',
      headers: openRouterHeaders,
      body: JSON.stringify(openRouterBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter Audio error (${response.status}): ${errorText}`);
    }

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

    return {
      success: true,
      provider: 'openrouter',
      mimeType: processed.mimeType,
      audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
      audioBase64: processed.base64Audio,
      voice: openRouterBody.voice || voice || 'alloy',
      requestDetails,
    };
  }

  // 5. OpenAI Audio (TTS)
  if (provider === 'openai') {
    const activeKey = clientApiKey || process.env.OPENAI_API_KEY;
    if (!activeKey) {
      throw new Error('OpenAI API Key is required for OpenAI TTS.');
    }

    const openAiUrl = endpoint || 'https://api.openai.com/v1/audio/speech';
    const openAiHeaders: Record<string, string> = {
      Authorization: `Bearer ${activeKey}`,
      'Content-Type': 'application/json',
      ...userHeaders,
    };
    const openAiBody: Record<string, any> = {
      model: parsedCustom.model || model || 'tts-1',
      input: cleanText,
      voice: parsedCustom.voice || parsedCustom.speaker || voice || 'alloy',
      speed: Math.max(0.25, Math.min(4.0, Number(parsedCustom.speed !== undefined ? parsedCustom.speed : (parsedCustom.pace !== undefined ? parsedCustom.pace : speed)) || 1.0)),
      response_format: parsedCustom.response_format || 'mp3',
    };
    applyCustomParams(openAiBody, customParams);

    openAiBody.input = openAiBody.input || (Array.isArray(openAiBody.inputs) ? openAiBody.inputs[0] : openAiBody.inputs) || openAiBody.text || openAiBody.prompt || cleanText;
    openAiBody.voice = openAiBody.voice || openAiBody.speaker || voice || 'alloy';
    delete openAiBody.speaker;
    delete openAiBody.inputs;
    delete openAiBody.text;
    delete openAiBody.prompt;
    delete openAiBody.pace;

    const requestDetails = {
      url: openAiUrl,
      method: 'POST',
      headers: maskHeaders(openAiHeaders),
      body: openAiBody,
    };

    const response = await fetch(openAiUrl, {
      method: 'POST',
      headers: openAiHeaders,
      body: JSON.stringify(openAiBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS error (${response.status}): ${errorText}`);
    }

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

    return {
      success: true,
      provider: 'openai',
      mimeType: processed.mimeType,
      audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
      audioBase64: processed.base64Audio,
      voice: openAiBody.voice || voice || 'alloy',
      requestDetails,
    };
  }

  // 6. ElevenLabs Speech
  if (provider === 'elevenlabs') {
    const activeKey = clientApiKey || process.env.ELEVENLABS_API_KEY;
    if (!activeKey) {
      throw new Error('ElevenLabs API Key is required.');
    }

    const voiceId = parsedCustom.voice_id || parsedCustom.voice || parsedCustom.speaker || voice || '21m00Tcm4TlvDq8ikWAM';
    const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const elevenHeaders: Record<string, string> = {
      'xi-api-key': activeKey,
      'Content-Type': 'application/json',
      ...userHeaders,
    };
    const elevenBody: Record<string, any> = {
      text: cleanText,
      model_id: parsedCustom.model_id || parsedCustom.model || model || 'eleven_multilingual_v2',
      voice_settings: {
        stability: parsedCustom.stability !== undefined ? parsedCustom.stability : 0.5,
        similarity_boost: parsedCustom.similarity_boost !== undefined ? parsedCustom.similarity_boost : 0.75,
      },
    };
    applyCustomParams(elevenBody, customParams);

    elevenBody.text = elevenBody.text || elevenBody.input || (Array.isArray(elevenBody.inputs) ? elevenBody.inputs[0] : elevenBody.inputs) || cleanText;
    delete elevenBody.inputs;
    delete elevenBody.input;
    delete elevenBody.speaker;
    delete elevenBody.voice;

    const requestDetails = {
      url: elevenUrl,
      method: 'POST',
      headers: maskHeaders(elevenHeaders),
      body: elevenBody,
    };

    const response = await fetch(elevenUrl, {
      method: 'POST',
      headers: elevenHeaders,
      body: JSON.stringify(elevenBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs error (${response.status}): ${errorText}`);
    }

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

    return {
      success: true,
      provider: 'elevenlabs',
      mimeType: processed.mimeType,
      audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
      audioBase64: processed.base64Audio,
      voice: voiceId,
      requestDetails,
    };
  }

  // 7. Custom Configurable Audio Server
  if (provider === 'custom') {
    const activeKey = clientApiKey || '';
    const ttsUrl = endpoint || 'http://localhost:8000/v1/audio/speech';

    // If custom endpoint points to Sarvam, route through Sarvam handler above
    if (ttsUrl.includes('sarvam.ai') || customFormat === 'sarvam') {
      // Re-invoke with sarvam provider
      return performTtsSynthesis({
        ...body,
        provider: 'sarvam',
        endpoint: ttsUrl,
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...userHeaders,
    };
    if (activeKey) {
      headers['Authorization'] = `Bearer ${activeKey}`;
    }

    let requestBody: Record<string, any>;
    if (customFormat === 'json_base64') {
      requestBody = {
        text: cleanText,
        voice: parsedCustom.voice || parsedCustom.speaker || voice || 'default',
        model: parsedCustom.model || model || 'tts-1',
        speed: Number(parsedCustom.speed !== undefined ? parsedCustom.speed : (parsedCustom.pace !== undefined ? parsedCustom.pace : speed)) || 1.0,
      };
    } else {
      requestBody = {
        model: parsedCustom.model || model || 'tts-1',
        input: cleanText,
        voice: parsedCustom.voice || parsedCustom.speaker || voice || 'default',
        speed: Number(parsedCustom.speed !== undefined ? parsedCustom.speed : (parsedCustom.pace !== undefined ? parsedCustom.pace : speed)) || 1.0,
        response_format: parsedCustom.response_format || 'mp3',
      };
    }
    applyCustomParams(requestBody, customParams);

    const requestDetails = {
      url: ttsUrl,
      method: 'POST',
      headers: maskHeaders(headers),
      body: requestBody,
    };

    const response = await fetch(ttsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Custom TTS error (${response.status}): ${errorText}`);
    }

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

    return {
      success: true,
      provider: 'custom',
      mimeType: processed.mimeType,
      audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
      audioBase64: processed.base64Audio,
      voice: requestBody.voice || voice || 'default',
      requestDetails,
    };
  }

  throw new Error(`Unsupported TTS provider: ${provider}`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await performTtsSynthesis(body);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Server TTS Error:', error);
    const msg = error?.message || 'Failed to synthesize speech on server.';
    const isQuota = msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit');
    return NextResponse.json(
      { error: msg, isQuotaExhausted: isQuota },
      { status: isQuota ? 429 : 500 }
    );
  }
}

