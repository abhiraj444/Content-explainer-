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
    } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Text content is required for speech synthesis.' }, { status: 400 });
    }

    const cleanText = text.trim();

    // 1. Google Gemini Native TTS
    if (provider === 'gemini') {
      const activeGeminiKey = clientApiKey || process.env.GEMINI_API_KEY;
      if (!activeGeminiKey) {
        return NextResponse.json(
          { error: 'Gemini API Key is required. Please add your key in Settings or server environment.' },
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

      const spokenPrompt =
        language === 'hinglish'
          ? `Speak this teaching explanation in a clear, natural Indian-accented teacher cadence:\n\n${cleanText}`
          : cleanText;

      const response = await ai.models.generateContent({
        model: model || 'gemini-3.1-flash-tts-preview',
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

      const audioPart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!audioPart || !audioPart.data) {
        return NextResponse.json(
          { error: 'Gemini TTS did not return audio data. Please try again.' },
          { status: 500 }
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

    // 2. OpenAI Audio (TTS)
    if (provider === 'openai') {
      const activeKey = clientApiKey || process.env.OPENAI_API_KEY;
      if (!activeKey) {
        return NextResponse.json({ error: 'OpenAI API Key is required for OpenAI TTS.' }, { status: 401 });
      }

      const openAiUrl = endpoint || 'https://api.openai.com/v1/audio/speech';
      const response = await fetch(openAiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model || 'tts-1',
          input: cleanText,
          voice: voice || 'alloy',
          speed: Math.max(0.25, Math.min(4.0, Number(speed) || 1.0)),
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `OpenAI TTS error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const base64Audio = audioBuffer.toString('base64');

      return NextResponse.json({
        success: true,
        provider: 'openai',
        mimeType: 'audio/mp3',
        audioDataUrl: `data:audio/mp3;base64,${base64Audio}`,
        audioBase64: base64Audio,
        voice: voice || 'alloy',
      });
    }

    // 3. OpenRouter Audio / Custom OpenRouter TTS proxy
    if (provider === 'openrouter') {
      const activeKey = clientApiKey || process.env.OPENROUTER_API_KEY;
      if (!activeKey) {
        return NextResponse.json({ error: 'OpenRouter API Key is required for OpenRouter audio.' }, { status: 401 });
      }

      const openRouterUrl = endpoint || 'https://openrouter.ai/api/v1/audio/speech';
      const response = await fetch(openRouterUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://medigen.app',
          'X-Title': 'MediGen Voice AI',
        },
        body: JSON.stringify({
          model: model || 'openai/tts-1',
          input: cleanText,
          voice: voice || 'alloy',
          speed: Math.max(0.25, Math.min(4.0, Number(speed) || 1.0)),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `OpenRouter Audio error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const base64Audio = audioBuffer.toString('base64');

      return NextResponse.json({
        success: true,
        provider: 'openrouter',
        mimeType: 'audio/mp3',
        audioDataUrl: `data:audio/mp3;base64,${base64Audio}`,
        audioBase64: base64Audio,
        voice: voice || 'alloy',
      });
    }

    // 4. ElevenLabs Speech
    if (provider === 'elevenlabs') {
      const activeKey = clientApiKey || process.env.ELEVENLABS_API_KEY;
      if (!activeKey) {
        return NextResponse.json({ error: 'ElevenLabs API Key is required.' }, { status: 401 });
      }

      const voiceId = voice || '21m00Tcm4TlvDq8ikWAM'; // Rachel default
      const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

      const response = await fetch(elevenUrl, {
        method: 'POST',
        headers: {
          'xi-api-key': activeKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: model || 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `ElevenLabs error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const base64Audio = audioBuffer.toString('base64');

      return NextResponse.json({
        success: true,
        provider: 'elevenlabs',
        mimeType: 'audio/mp3',
        audioDataUrl: `data:audio/mp3;base64,${base64Audio}`,
        audioBase64: base64Audio,
        voice: voiceId,
      });
    }

    // 5. Groq / Custom OpenAI-Compatible TTS Endpoint
    if (provider === 'groq' || provider === 'custom') {
      const activeKey = clientApiKey || (provider === 'groq' ? process.env.GROQ_API_KEY : '');
      const ttsUrl =
        endpoint ||
        (provider === 'groq' ? 'https://api.groq.com/openai/v1/audio/speech' : 'http://localhost:8000/v1/audio/speech');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (activeKey) {
        headers['Authorization'] = `Bearer ${activeKey}`;
      }

      const response = await fetch(ttsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || (provider === 'groq' ? 'kokoro' : 'tts-1'),
          input: cleanText,
          voice: voice || 'default',
          speed: Number(speed) || 1.0,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `${provider.toUpperCase()} TTS error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const base64Audio = audioBuffer.toString('base64');

      return NextResponse.json({
        success: true,
        provider,
        mimeType: 'audio/mp3',
        audioDataUrl: `data:audio/mp3;base64,${base64Audio}`,
        audioBase64: base64Audio,
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
