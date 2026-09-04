/**
 * Universal API Parameter & Header Resolution Utilities
 * 
 * Handles canonical parameter normalization, alias resolution, and seamless
 * field replacement for LLM, TTS, and STT requests across all supported providers.
 */

export interface ResolvedParamOverrides {
  model?: string;
  voice?: string;
  endpoint?: string;
  apiKey?: string;
  speed?: number;
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number;
  responseFormat?: string;
  sarvamLanguage?: string;
  prompt?: string;
  topP?: number;
  topK?: number;
}

/**
 * Parses user custom HTTP headers from multi-line text format:
 * "Header-Name: Value"
 */
export function parseCustomHeaders(headersStr?: string): Record<string, string> {
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
 * Parses user custom parameters from either JSON string or object.
 */
export function parseCustomParams(customParams?: string | Record<string, any> | null): Record<string, any> {
  if (!customParams) return {};
  if (typeof customParams === 'object' && customParams !== null) {
    return { ...customParams };
  }
  if (typeof customParams === 'string') {
    const trimmed = customParams.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Invalid JSON
      return {};
    }
  }
  return {};
}

/**
 * Extracts recognized semantic aliases from a parsed custom parameter object
 * and returns canonical overrides alongside remaining custom keys.
 */
export function resolveOverrides(customParams?: string | Record<string, any> | null): {
  overrides: ResolvedParamOverrides;
  rawParams: Record<string, any>;
  cleanParams: Record<string, any>;
} {
  const rawParams = parseCustomParams(customParams);
  const overrides: ResolvedParamOverrides = {};
  const cleanParams: Record<string, any> = {};

  // Alias sets to extract into canonical fields
  const modelAliases = ['model', 'model_name', 'modelName', 'model_id', 'modelId'];
  const voiceAliases = ['voice', 'voice_name', 'voiceName', 'speaker', 'voice_id', 'voiceId'];
  const endpointAliases = ['endpoint', 'url', 'endpoint_url', 'endpointUrl', 'base_url', 'baseUrl'];
  const apiKeyAliases = ['apiKey', 'api_key', 'key', 'auth_key', 'token'];
  const speedAliases = ['speed', 'pace', 'playback_speed', 'rate'];
  const tempAliases = ['temperature', 'temp'];
  const maxTokenAliases = ['max_tokens', 'maxTokens', 'max_output_tokens', 'maxOutputTokens'];
  const thinkingAliases = ['thinking_budget', 'thinkingBudget', 'reasoning_budget', 'reasoningBudget'];
  const formatAliases = ['response_format', 'responseFormat', 'output_audio_codec', 'format'];
  const langAliases = ['target_language_code', 'sarvamLanguage', 'language_code', 'language'];
  const promptAliases = ['prompt', 'input', 'text'];

  const allAliasKeys = new Set([
    ...modelAliases,
    ...voiceAliases,
    ...endpointAliases,
    ...apiKeyAliases,
    ...speedAliases,
    ...tempAliases,
    ...maxTokenAliases,
    ...thinkingAliases,
    ...formatAliases,
    ...langAliases,
    ...promptAliases,
  ]);

  // Extract canonical overrides
  for (const k of modelAliases) {
    if (rawParams[k] !== undefined && typeof rawParams[k] === 'string' && rawParams[k].trim()) {
      overrides.model = rawParams[k].trim();
      break;
    }
  }

  for (const k of voiceAliases) {
    if (rawParams[k] !== undefined && typeof rawParams[k] === 'string' && rawParams[k].trim()) {
      overrides.voice = rawParams[k].trim();
      break;
    }
  }

  for (const k of endpointAliases) {
    if (rawParams[k] !== undefined && typeof rawParams[k] === 'string' && rawParams[k].trim()) {
      overrides.endpoint = rawParams[k].trim();
      break;
    }
  }

  for (const k of apiKeyAliases) {
    if (rawParams[k] !== undefined && typeof rawParams[k] === 'string' && rawParams[k].trim()) {
      overrides.apiKey = rawParams[k].trim();
      break;
    }
  }

  for (const k of speedAliases) {
    if (rawParams[k] !== undefined) {
      const num = Number(rawParams[k]);
      if (!isNaN(num)) {
        overrides.speed = num;
        break;
      }
    }
  }

  for (const k of tempAliases) {
    if (rawParams[k] !== undefined) {
      const num = Number(rawParams[k]);
      if (!isNaN(num)) {
        overrides.temperature = num;
        break;
      }
    }
  }

  for (const k of maxTokenAliases) {
    if (rawParams[k] !== undefined) {
      const num = Number(rawParams[k]);
      if (!isNaN(num)) {
        overrides.maxTokens = num;
        break;
      }
    }
  }

  for (const k of thinkingAliases) {
    if (rawParams[k] !== undefined) {
      const num = Number(rawParams[k]);
      if (!isNaN(num)) {
        overrides.thinkingBudget = num;
        break;
      }
    }
  }

  for (const k of formatAliases) {
    if (rawParams[k] !== undefined && typeof rawParams[k] === 'string' && rawParams[k].trim()) {
      overrides.responseFormat = rawParams[k].trim();
      break;
    }
  }

  for (const k of langAliases) {
    if (rawParams[k] !== undefined && typeof rawParams[k] === 'string' && rawParams[k].trim()) {
      overrides.sarvamLanguage = rawParams[k].trim();
      break;
    }
  }

  for (const k of promptAliases) {
    if (rawParams[k] !== undefined && typeof rawParams[k] === 'string' && rawParams[k].trim()) {
      overrides.prompt = rawParams[k].trim();
      break;
    }
  }

  if (rawParams.top_p !== undefined || rawParams.topP !== undefined) {
    const num = Number(rawParams.top_p ?? rawParams.topP);
    if (!isNaN(num)) overrides.topP = num;
  }

  if (rawParams.top_k !== undefined || rawParams.topK !== undefined) {
    const num = Number(rawParams.top_k ?? rawParams.topK);
    if (!isNaN(num)) overrides.topK = num;
  }

  // Preserve non-alias parameters in cleanParams (e.g. specialized provider options)
  for (const [key, val] of Object.entries(rawParams)) {
    if (!allAliasKeys.has(key)) {
      cleanParams[key] = val;
    }
  }

  return { overrides, rawParams, cleanParams };
}

/**
 * Applies custom parameters to a target request payload, resolving all aliases
 * and replacing the canonical fields directly (e.g. replacing model, voice, speed)
 * rather than nesting them as unrecognized custom keys that would break API endpoints.
 */
export function applyCustomParamsToPayload(
  targetPayload: Record<string, any>,
  customParams?: string | Record<string, any> | null,
  options: {
    provider?: string;
    mode?: 'llm' | 'tts' | 'stt';
  } = {}
): ResolvedParamOverrides {
  const { overrides, cleanParams } = resolveOverrides(customParams);
  const provider = (options.provider || '').toLowerCase();
  const mode = options.mode || 'llm';

  // 1. Apply overrides according to mode and provider
  if (mode === 'tts') {
    if (provider === 'sarvam') {
      if (overrides.voice) targetPayload.speaker = overrides.voice;
      if (overrides.model) targetPayload.model = overrides.model;
      if (overrides.speed !== undefined) targetPayload.pace = overrides.speed;
      if (overrides.sarvamLanguage) targetPayload.target_language_code = overrides.sarvamLanguage;
      if (overrides.responseFormat) targetPayload.output_audio_codec = overrides.responseFormat;
      if (overrides.prompt) targetPayload.inputs = [overrides.prompt];
    } else if (provider === 'elevenlabs') {
      if (overrides.voice) targetPayload.voice_id = overrides.voice;
      if (overrides.model) targetPayload.model_id = overrides.model;
      if (overrides.prompt) targetPayload.text = overrides.prompt;
    } else {
      // Groq, OpenAI, OpenRouter, Custom HTTP
      if (overrides.voice) targetPayload.voice = overrides.voice;
      if (overrides.model) targetPayload.model = overrides.model;
      if (overrides.speed !== undefined) targetPayload.speed = overrides.speed;
      if (overrides.responseFormat) targetPayload.response_format = overrides.responseFormat;
      if (overrides.prompt) targetPayload.input = overrides.prompt;
    }
  } else if (mode === 'stt') {
    if (overrides.model) targetPayload.model = overrides.model;
    if (overrides.temperature !== undefined) targetPayload.temperature = overrides.temperature;
    if (overrides.responseFormat) targetPayload.response_format = overrides.responseFormat;
  } else {
    // LLM mode (OpenAI-compatible / Anthropic / Gemini config)
    if (overrides.model) targetPayload.model = overrides.model;
    if (overrides.temperature !== undefined) targetPayload.temperature = overrides.temperature;
    if (overrides.maxTokens !== undefined) targetPayload.max_tokens = overrides.maxTokens;
    if (overrides.topP !== undefined) targetPayload.top_p = overrides.topP;
    if (overrides.topK !== undefined) targetPayload.top_k = overrides.topK;
  }

  // 2. Merge additional custom parameters
  for (const [key, val] of Object.entries(cleanParams)) {
    if (val === null || val === undefined) {
      delete targetPayload[key];
    } else {
      targetPayload[key] = val;
    }
  }

  return overrides;
}

/**
 * Masks sensitive API keys for safe display in UI / logs.
 */
export function maskApiKey(key?: string): string {
  if (!key) return '';
  const clean = key.trim();
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
}

/**
 * Masks sensitive headers for request inspection.
 */
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
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
