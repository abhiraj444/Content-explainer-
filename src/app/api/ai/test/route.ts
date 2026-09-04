import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { resolveOverrides, applyCustomParamsToPayload } from '@/lib/api-param-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

function applyCustomParams(target: Record<string, any>, customParams?: string | Record<string, any>): void {
  if (!customParams) return;
  let parsed: Record<string, any> | null = null;
  if (typeof customParams === 'string') {
    const trimmed = customParams.trim();
    if (!trimmed) return;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
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

function maskApiKey(key?: string): string {
  if (!key) return '';
  const clean = key.trim();
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower.includes('auth') || lower.includes('key') || lower.includes('token') || lower.includes('secret')) {
      if (v.startsWith('Bearer ')) {
        masked[k] = `Bearer ${maskApiKey(v.slice(7))}`;
      } else {
        masked[k] = maskApiKey(v);
      }
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await req.json();
    const {
      mode = 'llm', // 'llm' | 'tts' | 'stt' | 'custom_http'
      config = {},
      endpoint: directEndpoint,
      model: directModel,
      apiKey: directApiKey,
      customHeaders: directHeaders,
      customParams: directParams,
      customBody: directBody,
      prompt: rawPrompt,
      text: rawText,
      voice: directVoice,
      speed: directSpeed,
      sarvamLanguage: directSarvamLanguage,
    } = body;

    // Resolve overrides from customParams
    const { overrides } = resolveOverrides(directParams);

    // =========================================================================
    // 1. TTS Testing Mode
    // =========================================================================
    if (mode === 'tts' || config.ttsSettings) {
      const ttsSettings = config.ttsSettings || {};
      const provider = overrides.voice && body.provider ? body.provider : (ttsSettings.provider || body.provider || 'gemini');
      const key = directApiKey || ttsSettings.apiKey || config.apiKey || (provider === 'gemini' ? (process.env.GEMINI_API_KEY || '') : (provider === 'groq' ? (process.env.GROQ_API_KEY || '') : ''));
      const endpoint = overrides.endpoint || directEndpoint || ttsSettings.endpoint || '';
      const model = overrides.model || directModel || ttsSettings.model || '';
      const voice = overrides.voice || directVoice || ttsSettings.voice || 'Puck';
      const speed = overrides.speed !== undefined ? overrides.speed : (directSpeed !== undefined ? directSpeed : (ttsSettings.speed || 1.0));
      const textToSpeak = (overrides.prompt || rawText || rawPrompt || 'Testing neural voice synthesis connectivity and audio quality.').trim();
      const customHeadersStr = directHeaders || ttsSettings.customHeaders || '';
      const customParamsStr = directParams || ttsSettings.customParams || '';

      // Direct forward to internal TTS route
      const ttsPayload: Record<string, any> = {
        text: textToSpeak,
        provider,
        voice,
        speed,
        model,
        endpoint,
        apiKey: key,
        customFormat: ttsSettings.customFormat || body.customFormat || 'auto',
        customHeaders: customHeadersStr,
        customParams: customParamsStr,
        sarvamLanguage: directSarvamLanguage || ttsSettings.sarvamLanguage || 'en-IN',
        audioPreference: ttsSettings.audioPreference || 'english_indian',
      };

      if (directBody && typeof directBody === 'object') {
        Object.assign(ttsPayload, directBody);
      }

      const host = req.headers.get('host') || 'localhost:3000';
      const protocol = req.headers.get('x-forwarded-proto') || 'http';
      const ttsUrl = `${protocol}://${host}/api/ai/tts`;

      try {
        const ttsRes = await fetch(ttsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsPayload),
        });

        const latencyMs = Date.now() - startTime;
        const resJson = await ttsRes.json();

        const headersObj = parseCustomHeaders(customHeadersStr);
        if (key) {
          if (provider === 'sarvam') {
            headersObj['api-subscription-key'] = key;
          } else if (provider === 'elevenlabs') {
            headersObj['xi-api-key'] = key;
          } else {
            headersObj['Authorization'] = `Bearer ${key}`;
          }
        }

        const requestDetails = resJson.requestDetails || {
          url: endpoint || (provider === 'groq' ? 'https://api.groq.com/openai/v1/audio/speech' : provider === 'sarvam' ? 'https://api.sarvam.ai/text-to-speech' : 'https://generativelanguage.googleapis.com'),
          method: 'POST',
          headers: maskHeaders(headersObj),
          body: {
            model: model || provider,
            voice: voice,
            input: textToSpeak,
            speed: speed,
          },
        };

        if (!ttsRes.ok || !resJson.success) {
          return NextResponse.json({
            success: false,
            message: resJson.error || `TTS request failed with HTTP ${ttsRes.status}`,
            httpStatus: ttsRes.status,
            latencyMs,
            modelUsed: model || provider,
            requestDetails,
            responseDetails: {
              status: ttsRes.status,
              statusText: ttsRes.statusText,
              data: resJson,
            },
          });
        }

        return NextResponse.json({
          success: true,
          message: `TTS synthesized audio successfully in ${latencyMs}ms (${resJson.mimeType || 'audio/wav'}).`,
          httpStatus: 200,
          latencyMs,
          audioDataUrl: resJson.audioDataUrl,
          audioBase64: resJson.audioBase64,
          mimeType: resJson.mimeType || 'audio/wav',
          sampleRate: resJson.sampleRate || 24000,
          voiceUsed: resJson.voice || voice,
          modelUsed: model || provider,
          requestDetails,
          responseDetails: {
            status: 200,
            statusText: 'OK',
            mimeType: resJson.mimeType,
            hasAudio: Boolean(resJson.audioBase64),
          },
        });
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        return NextResponse.json({
          success: false,
          message: `TTS connection test failed: ${err?.message || 'Network error'}`,
          latencyMs,
          httpStatus: 500,
          modelUsed: model || provider,
        });
      }
    }

    // =========================================================================
    // 2. STT Testing Mode
    // =========================================================================
    if (mode === 'stt' || config.sttConfig) {
      const sttConfig = config.sttConfig || {};
      const provider = sttConfig.provider || body.provider || 'groq';
      const key = directApiKey || sttConfig.apiKey || config.apiKey || (provider === 'groq' ? (process.env.GROQ_API_KEY || '') : (provider === 'openai' ? (process.env.OPENAI_API_KEY || '') : ''));
      const endpoint = directEndpoint || sttConfig.endpoint || (provider === 'groq' ? 'https://api.groq.com/openai/v1' : provider === 'openai' ? 'https://api.openai.com/v1' : '');
      const model = directModel || sttConfig.model || (provider === 'openai' ? 'whisper-1' : 'whisper-large-v3-turbo');
      const customHeadersStr = directHeaders || sttConfig.customHeaders || '';
      const customParamsStr = directParams || sttConfig.customParams || '';

      const host = req.headers.get('host') || 'localhost:3000';
      const protocol = req.headers.get('x-forwarded-proto') || 'http';
      const transcribeUrl = `${protocol}://${host}/api/ai/transcribe`;

      try {
        const transcribeRes = await fetch(transcribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isTest: true,
            sttConfig: {
              provider,
              apiKey: key,
              endpoint,
              model,
              customHeaders: customHeadersStr,
              customParams: customParamsStr,
            },
          }),
        });

        const latencyMs = Date.now() - startTime;
        const resJson = await transcribeRes.json();

        const headersObj = parseCustomHeaders(customHeadersStr);
        if (key) headersObj['Authorization'] = `Bearer ${key}`;

        const requestDetails = {
          url: endpoint ? `${endpoint.replace(/\/+$/, '')}/models` : 'https://api.groq.com/openai/v1/models',
          method: 'GET',
          headers: maskHeaders(headersObj),
          body: { isTest: true, provider, model },
        };

        if (!transcribeRes.ok || !resJson.success) {
          return NextResponse.json({
            success: false,
            message: resJson.error || `STT endpoint responded with HTTP ${transcribeRes.status}`,
            httpStatus: transcribeRes.status,
            latencyMs,
            modelUsed: model,
            requestDetails,
            responseDetails: {
              status: transcribeRes.status,
              statusText: transcribeRes.statusText,
              data: resJson,
            },
          });
        }

        return NextResponse.json({
          success: true,
          message: resJson.message || `STT connection verified in ${latencyMs}ms with ${model}.`,
          httpStatus: 200,
          latencyMs,
          modelUsed: model,
          requestDetails,
          responseDetails: {
            status: 200,
            statusText: 'OK',
            data: resJson,
          },
        });
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        return NextResponse.json({
          success: false,
          message: `STT connection test failed: ${err?.message || 'Network error'}`,
          latencyMs,
          httpStatus: 500,
          modelUsed: model,
        });
      }
    }

    // =========================================================================
    // 3. Main LLM / Content Generation Testing Mode
    // =========================================================================
    const provider = config.provider || body.provider || (directEndpoint ? 'custom' : 'gemini');
    const userPrompt = (overrides.prompt || rawPrompt || rawText || config.prompt || 'Respond with the single word "READY" to verify AI readiness.').trim();

    // 3A. Custom Endpoint or Third-party OpenAI-compatible LLM
    if (provider === 'custom' || directEndpoint) {
      let endpoint = (directEndpoint || config.customEndpoint || '').trim();
      if (!endpoint) {
        return NextResponse.json({
          success: false,
          message: 'Custom LLM endpoint URL is empty. Please enter your endpoint URL (e.g. https://api.groq.com/openai/v1).',
          latencyMs: Date.now() - startTime,
          httpStatus: 400,
        });
      }

      if (!endpoint.endsWith('/chat/completions') && !endpoint.includes('/messages') && !endpoint.includes('/generateContent')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
      }

      const key = directApiKey || config.customApiKey || config.apiKey || '';
      let modelName = directModel || config.customModel || 'gpt-4o';
      const customHeadersStr = directHeaders || config.customHeaders || '';
      const customParamsStr = directParams || config.customParams || '';

      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (key) {
        const lowerEp = endpoint.toLowerCase();
        if (lowerEp.includes('anthropic.com')) {
          reqHeaders['x-api-key'] = key;
          reqHeaders['anthropic-version'] = '2023-06-01';
        } else if (lowerEp.includes('openrouter.ai')) {
          reqHeaders['Authorization'] = `Bearer ${key}`;
          reqHeaders['HTTP-Referer'] = 'https://medigen.app';
          reqHeaders['X-Title'] = 'MediGen Clinical AI';
        } else {
          reqHeaders['Authorization'] = `Bearer ${key}`;
        }
      }

      // Merge user custom headers
      const userCustomHeaders = parseCustomHeaders(customHeadersStr);
      Object.assign(reqHeaders, userCustomHeaders);

      // Construct default payload
      let reqPayload: Record<string, any> = {
        model: modelName,
        messages: [
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 150,
      };

      // Merge user custom parameters with alias and canonical resolution
      applyCustomParamsToPayload(reqPayload, customParamsStr, 'llm');
      if (reqPayload.model) {
        modelName = reqPayload.model;
      }

      // If user passed explicit directBody, merge or replace
      if (directBody && typeof directBody === 'object') {
        reqPayload = { ...reqPayload, ...directBody };
      }

      const requestDetails = {
        url: endpoint,
        method: 'POST',
        headers: maskHeaders(reqHeaders),
        body: reqPayload,
      };

      try {
        const fetchRes = await fetch(endpoint, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(reqPayload),
        });

        const latencyMs = Date.now() - startTime;
        const resText = await fetchRes.text();
        let resJson: any = null;
        try {
          resJson = JSON.parse(resText);
        } catch {
          // not JSON
        }

        if (!fetchRes.ok) {
          const errMsg = resJson?.error?.message || resJson?.message || resText.slice(0, 300) || `HTTP ${fetchRes.status}`;
          return NextResponse.json({
            success: false,
            message: `Endpoint returned HTTP ${fetchRes.status}: ${errMsg}`,
            httpStatus: fetchRes.status,
            latencyMs,
            modelUsed: modelName,
            requestDetails,
            responseDetails: {
              status: fetchRes.status,
              statusText: fetchRes.statusText,
              rawBody: resText.slice(0, 1000),
            },
          });
        }

        let replyContent = '';
        let reasoningContent = '';

        if (resJson) {
          const choice = resJson.choices?.[0];
          replyContent = choice?.message?.content || choice?.text || (typeof resJson === 'string' ? resJson : JSON.stringify(resJson).slice(0, 200));
          reasoningContent = choice?.message?.reasoning_content || choice?.reasoning || choice?.thinking || '';
        } else {
          replyContent = resText.slice(0, 200);
        }

        return NextResponse.json({
          success: true,
          message: `Connected successfully (${latencyMs}ms): ${replyContent.trim().slice(0, 100)}`,
          httpStatus: 200,
          latencyMs,
          modelUsed: resJson?.model || modelName,
          responseText: replyContent,
          reasoningText: reasoningContent || undefined,
          requestDetails,
          responseDetails: {
            status: 200,
            statusText: 'OK',
            rawSnippet: resText.slice(0, 800),
          },
        });
      } catch (fetchErr: any) {
        const latencyMs = Date.now() - startTime;
        return NextResponse.json({
          success: false,
          message: `Network failure reaching endpoint (${endpoint}): ${fetchErr?.message || 'Connection refused'}`,
          httpStatus: 502,
          latencyMs,
          modelUsed: modelName,
          requestDetails,
        });
      }
    }

    // 3B. Google Gemini Engine
    const apiKey = directApiKey || config.geminiApiKey || config.apiKey || process.env.GEMINI_API_KEY || '';
    let requestedModel = directModel || config.geminiModel || 'gemini-3.7-flash';
    const customHeadersStr = directHeaders || config.customHeaders || '';
    const customParamsStr = directParams || config.customParams || '';

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        message: 'Google Gemini API key is missing. Please add your key in Settings or input field.',
        httpStatus: 400,
        latencyMs: Date.now() - startTime,
        modelUsed: requestedModel,
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const { overrides: geminiOverrides } = resolveOverrides(customParamsStr);
    if (geminiOverrides.model) {
      requestedModel = geminiOverrides.model;
    }

    const genConfig: any = {};
    applyCustomParamsToPayload(genConfig, customParamsStr, 'llm');
    delete genConfig.model;

    const requestDetails = {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent`,
      method: 'POST',
      headers: maskHeaders({
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        ...parseCustomHeaders(customHeadersStr),
      }),
      body: {
        model: requestedModel,
        contents: userPrompt,
        config: genConfig,
      },
    };

    try {
      const response = await ai.models.generateContent({
        model: requestedModel,
        contents: userPrompt,
        config: Object.keys(genConfig).length > 0 ? genConfig : undefined,
      });

      const latencyMs = Date.now() - startTime;
      const responseText = response.text?.trim() || 'READY';

      return NextResponse.json({
        success: true,
        message: `Gemini connected successfully (${latencyMs}ms): ${responseText.slice(0, 100)}`,
        httpStatus: 200,
        latencyMs,
        modelUsed: requestedModel,
        responseText,
        requestDetails,
        responseDetails: {
          status: 200,
          statusText: 'OK',
          textLength: responseText.length,
        },
      });
    } catch (gemErr: any) {
      const latencyMs = Date.now() - startTime;
      const rawMsg = gemErr?.message || String(gemErr || '');
      return NextResponse.json({
        success: false,
        message: `Gemini test failed (${requestedModel}): ${rawMsg}`,
        httpStatus: 400,
        latencyMs,
        modelUsed: requestedModel,
        requestDetails,
        responseDetails: {
          error: rawMsg,
        },
      });
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return NextResponse.json({
      success: false,
      message: err?.message || 'Connection test encountered an unexpected error.',
      httpStatus: 500,
      latencyMs,
      modelUsed: 'Unknown',
    });
  }
}
