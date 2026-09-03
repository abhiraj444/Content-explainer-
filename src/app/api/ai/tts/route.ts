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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      text,
      provider = 'gemini',
      voice = 'Kore',
      apiKey: clientApiKey,
      endpoint,
      model,
      speed = 1.0,
      language = 'english',
      audioPreference = 'english_indian',
      customFormat = 'auto',
      customHeaders,
      customParams,
      sarvamLanguage,
    } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Text content is required for speech synthesis.' }, { status: 400 });
    }

    const cleanText = text.trim();
    const resolvedAudioPref = audioPreference || (language === 'hinglish' ? 'hinglish_indian' : 'english_indian');
    const userHeaders = parseCustomHeaders(customHeaders);

    // 1. Google Gemini Native TTS
    if (provider === 'gemini') {
      const activeGeminiKey = clientApiKey || process.env.GEMINI_API_KEY;
      if (!activeGeminiKey) {
        return NextResponse.json(
          { error: 'Gemini API Key is required for Gemini TTS. Please add your key in Settings or provide a valid key.' },
          { status: 401 }
        );
      }

      const ai = new GoogleGenAI({
        apiKey: activeGeminiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const validGeminiVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
      const selectedVoice = validGeminiVoices.includes(voice) ? voice : 'Kore';

      let spokenPrompt = cleanText;
      if (resolvedAudioPref === 'hinglish_indian') {
        spokenPrompt = `Speak this explanation in a warm, natural conversational Hinglish style with a clear Indian tone and teacher cadence:\n\n${cleanText}`;
      } else if (resolvedAudioPref === 'english_indian') {
        spokenPrompt = `Speak this explanation in clear, articulate English with a natural, friendly Indian accent and warm educator cadence:\n\n${cleanText}`;
      }

      const ttsModelToTry = model || 'gemini-3.1-flash-tts-preview';
      let response: any = null;
      let lastErr: any = null;

      // Exponential retry for transient rate limits (429/resource_exhausted/503)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 600 * Math.pow(2, attempt - 1)));
          }
          response = await ai.models.generateContent({
            model: ttsModelToTry,
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
          if (response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
            break;
          }
        } catch (err: any) {
          lastErr = err;
          const msg = (err?.message || '').toLowerCase();
          const isRetryable = msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('503') || msg.includes('overloaded');
          if (!isRetryable || attempt === 2) {
            break;
          }
        }
      }

      const audioPart = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!audioPart || !audioPart.data) {
        const errLower = (lastErr?.message || '').toLowerCase();
        const isQuota = errLower.includes('resource_exhausted') || errLower.includes('quota') || errLower.includes('429');
        return NextResponse.json(
          {
            error: isQuota
              ? 'Gemini TTS Rate Limit / Quota Exceeded. Please try again in a few moments or switch TTS provider in Settings.'
              : `Gemini TTS did not return audio data (${lastErr?.message || 'Empty audio candidate'}).`,
            isQuotaExhausted: isQuota,
          },
          { status: isQuota ? 429 : 500 }
        );
      }

      // Convert raw PCM to standard WAV buffer for seamless browser playback
      const rawPcmBuffer = Buffer.from(audioPart.data, 'base64');
      const wavBuffer = pcmToWavBuffer(rawPcmBuffer, 24000, 1, 16);
      const wavBase64 = wavBuffer.toString('base64');

      return NextResponse.json({
        success: true,
        provider: 'gemini',
        mimeType: 'audio/wav',
        audioDataUrl: `data:audio/wav;base64,${wavBase64}`,
        audioBase64: wavBase64,
        voice: selectedVoice,
        sampleRate: 24000,
      });
    }

    // 2. Groq Cloud (Orpheus)
    if (provider === 'groq') {
      const activeKey = clientApiKey || process.env.GROQ_API_KEY;
      if (!activeKey) {
        return NextResponse.json(
          { error: 'Groq API Key is required. Please add your Groq key (gsk_...) in Settings.' },
          { status: 401 }
        );
      }

      // Official Orpheus voices on Groq: autumn, diana, hannah, austin, daniel, troy
      const GROQ_ORPHEUS_VOICES = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'];
      const requestedVoice = (voice || '').toLowerCase().trim();
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
        model: model || 'canopylabs/orpheus-v1-english',
        input: cleanText,
        voice: resolvedVoice,
        speed: Math.max(0.5, Math.min(2.0, Number(speed) || 1.0)),
        response_format: 'mp3',
      };
      applyCustomParams(groqBody, customParams);

      const response = await fetch(groqUrl, {
        method: 'POST',
        headers: groqHeaders,
        body: JSON.stringify(groqBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `Groq TTS error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const rawBuffer = Buffer.from(await response.arrayBuffer());
      const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

      return NextResponse.json({
        success: true,
        provider: 'groq',
        mimeType: processed.mimeType,
        audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
        audioBase64: processed.base64Audio,
        voice: resolvedVoice,
      });
    }

    // 3. Sarvam AI (Indian Neural TTS - Bulbul v3 / v2 / v1)
    if (provider === 'sarvam' || (provider === 'custom' && endpoint?.includes('sarvam.ai')) || customFormat === 'sarvam') {
      const activeKey = clientApiKey || process.env.SARVAM_API_KEY;
      if (!activeKey) {
        return NextResponse.json(
          { error: 'Sarvam API Subscription Key is required. Please get your key from sarvam.ai and enter it in Settings.' },
          { status: 401 }
        );
      }

      const sarvamUrl = endpoint || 'https://api.sarvam.ai/text-to-speech';
      const targetLang = sarvamLanguage || (resolvedAudioPref === 'hinglish_indian' ? 'hi-IN' : 'en-IN');
      const selectedSpeaker = voice && voice !== 'default' ? voice : 'shubh';

      const userHeaders = parseCustomHeaders(customHeaders);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'api-subscription-key': activeKey,
        Authorization: `Bearer ${activeKey}`,
        ...userHeaders,
      };

      // Sarvam payload: Bulbul v3 strictly rejects 'pitch' and 'loudness'.
      // Only legacy Bulbul v2 supports pitch and loudness.
      const isBulbulV2 = Boolean(model && model.toLowerCase().includes('v2'));
      const sarvamBody: Record<string, any> = {
        text: cleanText,
        inputs: [cleanText],
        target_language_code: targetLang,
        speaker: selectedSpeaker,
        pace: Math.max(0.5, Math.min(2.0, Number(speed) || 1.0)),
        model: model || 'bulbul:v3',
        output_audio_codec: 'wav',
        enable_preprocessing: true,
      };

      if (isBulbulV2) {
        sarvamBody.pitch = 0;
        sarvamBody.loudness = 1.0;
      }

      // Merge user-specified custom parameters or payload overrides
      applyCustomParams(sarvamBody, customParams);

      const response = await fetch(sarvamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(sarvamBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `Sarvam AI TTS error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const rawBuffer = Buffer.from(await response.arrayBuffer());
      const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

      return NextResponse.json({
        success: true,
        provider: 'sarvam',
        mimeType: processed.mimeType,
        audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
        audioBase64: processed.base64Audio,
        voice: selectedSpeaker,
      });
    }

    // 4. OpenRouter Audio / Kokoro
    if (provider === 'openrouter') {
      const activeKey = clientApiKey || process.env.OPENROUTER_API_KEY;
      if (!activeKey) {
        return NextResponse.json(
          { error: 'OpenRouter API Key is required for OpenRouter audio.' },
          { status: 401 }
        );
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
        model: model || 'openai/tts-1',
        input: cleanText,
        voice: voice || 'alloy',
        speed: Math.max(0.25, Math.min(4.0, Number(speed) || 1.0)),
        response_format: 'mp3',
      };
      applyCustomParams(openRouterBody, customParams);

      const response = await fetch(openRouterUrl, {
        method: 'POST',
        headers: openRouterHeaders,
        body: JSON.stringify(openRouterBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `OpenRouter Audio error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const rawBuffer = Buffer.from(await response.arrayBuffer());
      const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

      return NextResponse.json({
        success: true,
        provider: 'openrouter',
        mimeType: processed.mimeType,
        audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
        audioBase64: processed.base64Audio,
        voice: voice || 'alloy',
      });
    }

    // 5. OpenAI Audio (TTS)
    if (provider === 'openai') {
      const activeKey = clientApiKey || process.env.OPENAI_API_KEY;
      if (!activeKey) {
        return NextResponse.json({ error: 'OpenAI API Key is required for OpenAI TTS.' }, { status: 401 });
      }

      const openAiUrl = endpoint || 'https://api.openai.com/v1/audio/speech';
      const openAiHeaders: Record<string, string> = {
        Authorization: `Bearer ${activeKey}`,
        'Content-Type': 'application/json',
        ...userHeaders,
      };
      const openAiBody: Record<string, any> = {
        model: model || 'tts-1',
        input: cleanText,
        voice: voice || 'alloy',
        speed: Math.max(0.25, Math.min(4.0, Number(speed) || 1.0)),
        response_format: 'mp3',
      };
      applyCustomParams(openAiBody, customParams);

      const response = await fetch(openAiUrl, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify(openAiBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `OpenAI TTS error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const rawBuffer = Buffer.from(await response.arrayBuffer());
      const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

      return NextResponse.json({
        success: true,
        provider: 'openai',
        mimeType: processed.mimeType,
        audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
        audioBase64: processed.base64Audio,
        voice: voice || 'alloy',
      });
    }

    // 6. ElevenLabs Speech
    if (provider === 'elevenlabs') {
      const activeKey = clientApiKey || process.env.ELEVENLABS_API_KEY;
      if (!activeKey) {
        return NextResponse.json({ error: 'ElevenLabs API Key is required.' }, { status: 401 });
      }

      const voiceId = voice || '21m00Tcm4TlvDq8ikWAM'; // Rachel default
      const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
      const elevenHeaders: Record<string, string> = {
        'xi-api-key': activeKey,
        'Content-Type': 'application/json',
        ...userHeaders,
      };
      const elevenBody: Record<string, any> = {
        text: cleanText,
        model_id: model || 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      };
      applyCustomParams(elevenBody, customParams);

      const response = await fetch(elevenUrl, {
        method: 'POST',
        headers: elevenHeaders,
        body: JSON.stringify(elevenBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `ElevenLabs error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const rawBuffer = Buffer.from(await response.arrayBuffer());
      const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

      return NextResponse.json({
        success: true,
        provider: 'elevenlabs',
        mimeType: processed.mimeType,
        audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
        audioBase64: processed.base64Audio,
        voice: voiceId,
      });
    }

    // 7. Custom Configurable Audio Server (FastAPI, Kokoro, AllTalk, Localhost, or Cloud)
    if (provider === 'custom') {
      const activeKey = clientApiKey || '';
      const ttsUrl = endpoint || 'http://localhost:8000/v1/audio/speech';

      const userHeaders = parseCustomHeaders(customHeaders);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...userHeaders,
      };
      if (activeKey) {
        headers['Authorization'] = `Bearer ${activeKey}`;
      }

      // Build payload based on user's customFormat preference
      let requestBody: Record<string, any>;
      if (customFormat === 'json_base64') {
        requestBody = {
          text: cleanText,
          voice: voice || 'default',
          model: model || 'tts-1',
          speed: Number(speed) || 1.0,
        };
      } else {
        // Default OpenAI-compatible schema
        requestBody = {
          model: model || 'tts-1',
          input: cleanText,
          voice: voice || 'default',
          speed: Number(speed) || 1.0,
          response_format: 'mp3',
        };
      }
      applyCustomParams(requestBody, customParams);

      const response = await fetch(ttsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `Custom TTS error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const rawBuffer = Buffer.from(await response.arrayBuffer());
      const processed = processAudioResponse(rawBuffer, response.headers.get('content-type'));

      return NextResponse.json({
        success: true,
        provider: 'custom',
        mimeType: processed.mimeType,
        audioDataUrl: `data:${processed.mimeType};base64,${processed.base64Audio}`,
        audioBase64: processed.base64Audio,
        voice,
      });
    }

    return NextResponse.json({ error: `Unsupported TTS provider: ${provider}` }, { status: 400 });
  } catch (error: any) {
    console.error('Server TTS Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to synthesize speech on server.' },
      { status: 500 }
    );
  }
}

