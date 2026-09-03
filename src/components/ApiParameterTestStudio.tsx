'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Code2,
  Save,
  Sliders,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Volume2,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  FileJson,
  Layers,
  Send,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

export interface ApiTestStudioProps {
  mode: 'llm' | 'tts' | 'stt';
  providerId: string;
  providerName: string;
  endpoint: string;
  model: string;
  apiKey: string;
  customHeaders?: string;
  customParams?: string;
  voice?: string;
  speed?: number;
  customFormat?: string;
  sarvamLanguage?: string;
  defaultTestPrompt?: string;
  onSaveParameters: (params: {
    endpoint?: string;
    model?: string;
    customHeaders: string;
    customParams: string;
    voice?: string;
    speed?: number;
    customFormat?: string;
    sarvamLanguage?: string;
  }) => void;
  className?: string;
}

export const ApiParameterTestStudio: React.FC<ApiTestStudioProps> = ({
  mode,
  providerId,
  providerName,
  endpoint,
  model,
  apiKey,
  customHeaders = '',
  customParams = '',
  voice = 'Puck',
  speed = 1.0,
  customFormat = 'auto',
  sarvamLanguage = 'en-IN',
  defaultTestPrompt,
  onSaveParameters,
  className = '',
}) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'docs'>('params');

  // Local editable test parameters
  const [testEndpoint, setTestEndpoint] = useState(endpoint);
  const [testModel, setTestModel] = useState(model);
  const [testHeaders, setTestHeaders] = useState(customHeaders);
  const [testParams, setTestParams] = useState(customParams);
  const [testPrompt, setTestPrompt] = useState(
    defaultTestPrompt ||
      (mode === 'tts'
        ? 'A 54-year-old patient presents with acute pleuritic chest pain. Let us evaluate cardiac biomarkers.'
        : mode === 'stt'
        ? 'Testing speech to text transcription connection.'
        : 'Respond with the single word "READY" to verify clinical AI readiness and connectivity.')
  );

  // Sync with prop updates when opened
  useEffect(() => {
    setTestEndpoint(endpoint);
    setTestModel(model);
    setTestHeaders(customHeaders);
    setTestParams(customParams);
  }, [endpoint, model, customHeaders, customParams]);

  // Test execution state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    httpStatus?: number;
    latencyMs?: number;
    modelUsed?: string;
    responseText?: string;
    reasoningText?: string;
    audioDataUrl?: string;
    mimeType?: string;
    requestDetails?: any;
    responseDetails?: any;
  } | null>(null);

  const [hasSaved, setHasSaved] = useState(false);
  const [hasCopiedCurl, setHasCopiedCurl] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Quick JSON Formatter
  const handleFormatJson = () => {
    try {
      if (!testParams.trim()) {
        const defaultObj = getDefaultParamsForProvider(mode, providerId, testModel);
        setTestParams(JSON.stringify(defaultObj, null, 2));
        return;
      }
      const parsed = JSON.parse(testParams);
      setTestParams(JSON.stringify(parsed, null, 2));
      toast({ title: 'JSON Formatted', description: 'Request parameters successfully formatted.' });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Invalid JSON Syntax',
        description: err.message || 'Please check for missing commas or mismatched brackets.',
      });
    }
  };

  // Reset to clean default parameters
  const handleResetDefaults = () => {
    const defaultObj = getDefaultParamsForProvider(mode, providerId, testModel);
    setTestParams(JSON.stringify(defaultObj, null, 2));
    const defaultHdrs = getDefaultHeadersForProvider(providerId);
    setTestHeaders(defaultHdrs);
    toast({ title: 'Parameters Reset', description: `Default parameters for ${providerName} restored.` });
  };

  // Run the live test with edited parameters
  const handleRunTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    setHasSaved(false);

    // Validate JSON before sending
    let parsedParamsObj: any = null;
    if (testParams.trim()) {
      try {
        parsedParamsObj = JSON.parse(testParams);
      } catch (err: any) {
        setIsTesting(false);
        toast({
          variant: 'destructive',
          title: 'Invalid JSON Parameters',
          description: `Cannot test: JSON syntax error in parameters (${err.message})`,
        });
        return;
      }
    }

    try {
      const resolvedModel = (parsedParamsObj?.model || parsedParamsObj?.model_id || testModel || '').trim();
      const resolvedEndpoint = (parsedParamsObj?.endpoint || parsedParamsObj?.url || testEndpoint || '').trim();
      const resolvedVoice = parsedParamsObj?.voice || parsedParamsObj?.speaker || voice;
      const resolvedSpeed = parsedParamsObj?.speed !== undefined ? parsedParamsObj?.speed : (parsedParamsObj?.pace !== undefined ? parsedParamsObj?.pace : speed);
      const resolvedFormat = parsedParamsObj?.response_format || parsedParamsObj?.output_audio_codec || customFormat;
      const resolvedSarvamLang = parsedParamsObj?.target_language_code || parsedParamsObj?.sarvamLanguage || sarvamLanguage;
      const resolvedPrompt = parsedParamsObj?.input || parsedParamsObj?.text || (Array.isArray(parsedParamsObj?.inputs) ? parsedParamsObj.inputs[0] : null) || testPrompt.trim();

      const payload: any = {
        mode,
        provider: providerId,
        endpoint: resolvedEndpoint,
        model: resolvedModel,
        apiKey: apiKey.trim(),
        customHeaders: testHeaders.trim(),
        customParams: testParams.trim(),
        prompt: resolvedPrompt,
        text: resolvedPrompt,
        voice: resolvedVoice,
        speed: resolvedSpeed,
        customFormat: resolvedFormat,
        sarvamLanguage: resolvedSarvamLang,
      };

      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setTestResult(data);

      if (data.success) {
        toast({
          title: 'Connection & Parameters Verified',
          description: `${providerName} responded successfully (${data.latencyMs || 0}ms). You can now save these parameters!`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Test Failed',
          description: data.message || 'The endpoint returned an error. Check parameters below.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Network error executing connection test.',
        httpStatus: 500,
      });
      toast({
        variant: 'destructive',
        title: 'Connection Test Error',
        description: err.message || 'Network failure.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Save the tested parameters to application settings
  const handleSaveToSettings = () => {
    let parsedObj: any = {};
    if (testParams.trim()) {
      try {
        parsedObj = JSON.parse(testParams.trim());
      } catch {}
    }

    const resolvedModel = (parsedObj.model || parsedObj.model_id || testModel || '').trim();
    const resolvedEndpoint = (parsedObj.endpoint || parsedObj.url || testEndpoint || '').trim();
    const resolvedVoice = parsedObj.voice || parsedObj.speaker || voice;
    const resolvedSpeed = parsedObj.speed !== undefined ? parsedObj.speed : (parsedObj.pace !== undefined ? parsedObj.pace : speed);
    const resolvedFormat = parsedObj.response_format || parsedObj.output_audio_codec || customFormat;
    const resolvedSarvamLang = parsedObj.target_language_code || parsedObj.sarvamLanguage || sarvamLanguage;

    onSaveParameters({
      endpoint: resolvedEndpoint,
      model: resolvedModel,
      customHeaders: testHeaders.trim(),
      customParams: testParams.trim(),
      voice: resolvedVoice,
      speed: resolvedSpeed,
      customFormat: resolvedFormat,
      sarvamLanguage: resolvedSarvamLang,
    });
    setHasSaved(true);
    toast({
      title: 'Parameters Saved to App',
      description: `Parameters for ${providerName} (Model: ${resolvedModel || 'default'}, Voice: ${resolvedVoice || 'default'}) saved! All future AI requests across the app will use these settings.`,
    });
  };

  // Toggle Audio Playback
  const handleToggleAudio = () => {
    if (!audioRef.current && testResult?.audioDataUrl) {
      audioRef.current = new Audio(testResult.audioDataUrl);
      audioRef.current.onended = () => setIsPlayingAudio(false);
      audioRef.current.onpause = () => setIsPlayingAudio(false);
    }

    if (audioRef.current) {
      if (isPlayingAudio) {
        audioRef.current.pause();
        setIsPlayingAudio(false);
      } else {
        audioRef.current.play().then(() => setIsPlayingAudio(true)).catch(() => setIsPlayingAudio(false));
      }
    }
  };

  // Copy cURL command for debugging in terminal
  const handleCopyCurl = () => {
    const authHeader = apiKey ? ` -H "Authorization: Bearer ${apiKey}"` : '';
    const customHdrs = testHeaders
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ` -H "${l}"`)
      .join('');
    const curl = `curl -X POST "${testEndpoint || 'https://api.openai.com/v1/chat/completions'}" \\
  -H "Content-Type: application/json"${authHeader}${customHdrs} \\
  -d '${testParams.trim() || '{"model":"' + testModel + '","messages":[{"role":"user","content":"READY"}]}'}'`;

    navigator.clipboard.writeText(curl);
    setHasCopiedCurl(true);
    setTimeout(() => setHasCopiedCurl(false), 2000);
    toast({ title: 'cURL Command Copied', description: 'Paste in your terminal to test directly via command line.' });
  };

  return (
    <div className={`rounded-xl border border-border/80 bg-background/95 shadow-2xs overflow-hidden transition-all ${className}`}>
      {/* Studio Header & Trigger Toggle */}
      <div className="p-3.5 bg-muted/25 border-b border-border/70 flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold">
            <Sliders className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">
                Request Parameters &amp; Connection Inspector
              </span>
              <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-primary/10 text-primary font-semibold">
                {providerName}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Inspect, customize, and test the exact HTTP payload &amp; headers sent to {providerName}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRunTest}
            disabled={isTesting}
            className="h-8 text-xs font-bold gap-1.5 rounded-lg border-primary/30 text-primary hover:bg-primary/10"
          >
            {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-primary" />}
            <span>Test Connection</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            className="h-8 text-xs font-medium gap-1 px-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <span>{isOpen ? 'Hide Parameters' : 'Edit Parameters'}</span>
            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Test Result Mini Banner (Visible even when collapsed) */}
      {testResult && !isOpen && (
        <div
          className={`px-4 py-2.5 text-xs flex items-center justify-between gap-3 border-b ${
            testResult.success
              ? 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-300 border-emerald-500/20'
              : 'bg-red-500/10 text-red-900 dark:text-red-300 border-red-500/20'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {testResult.success ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
            )}
            <span className="font-semibold truncate">{testResult.message}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {testResult.latencyMs && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-background/60 border border-border">
                {testResult.latencyMs}ms
              </span>
            )}
            {testResult.audioDataUrl && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleToggleAudio}
                className="h-6 text-[11px] px-2 rounded gap-1 border-emerald-600/30 text-emerald-700 dark:text-emerald-300"
              >
                <Volume2 className="h-3 w-3" />
                <span>{isPlayingAudio ? 'Pause Voice' : 'Play Voice Sample'}</span>
              </Button>
            )}
            {testResult.success && !hasSaved && (
              <Button
                type="button"
                size="sm"
                onClick={handleSaveToSettings}
                className="h-6 text-[11px] px-2.5 rounded gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-2xs"
              >
                <Save className="h-3 w-3" />
                <span>Save to Settings</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Expanded Parameter Studio Inspector */}
      {isOpen && (
        <div className="p-4 sm:p-5 space-y-4 bg-muted/10">
          {/* Target Endpoint & Model Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                  <Send className="h-3 w-3 text-primary" />
                  Target Endpoint URL
                </Label>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                  POST / GET
                </span>
              </div>
              <Input
                value={testEndpoint}
                onChange={(e) => setTestEndpoint(e.target.value)}
                placeholder="https://api.groq.com/openai/v1/chat/completions"
                className="h-8 text-xs font-mono bg-background"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-primary" />
                Model ID
              </Label>
              <Input
                value={testModel}
                onChange={(e) => setTestModel(e.target.value)}
                placeholder="e.g. llama-3.3-70b-versatile"
                className="h-8 text-xs font-mono bg-background"
              />
            </div>
          </div>

          {/* Studio Navigation Tabs */}
          <div className="flex items-center justify-between border-b border-border/70 pb-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab('params')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  activeTab === 'params'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                <FileJson className="h-3.5 w-3.5" />
                <span>Request Body / Parameters (JSON)</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('headers')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  activeTab === 'headers'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>Custom HTTP Headers</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('docs')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  activeTab === 'docs'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>Docs &amp; Presets</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleFormatJson}
                className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                title="Format JSON indentation"
              >
                Format JSON
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetDefaults}
                className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground gap-1"
                title="Reset to provider defaults"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Defaults</span>
              </Button>
            </div>
          </div>

          {/* Tab 1: JSON Request Parameters */}
          {activeTab === 'params' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Edit or add custom parameters (e.g. <code>temperature</code>, <code>max_tokens</code>, <code>top_p</code>, <code>reasoning_effort</code>, <code>voice</code>, <code>speaker</code>).
                </span>
                <span className="font-mono text-[10px]">Valid JSON format</span>
              </div>
              <Textarea
                value={testParams}
                onChange={(e) => setTestParams(e.target.value)}
                placeholder={`{\n  "temperature": 0.2,\n  "max_tokens": 2048\n}`}
                className="font-mono text-xs min-h-[140px] bg-background leading-relaxed resize-y"
              />

              {/* Quick Parameter Injection Chips */}
              <div className="flex items-center flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Quick Add:
                </span>
                {[
                  { label: 'temperature: 0.2', key: 'temperature', val: 0.2 },
                  { label: 'max_tokens: 4096', key: 'max_tokens', val: 4096 },
                  { label: 'top_p: 0.95', key: 'top_p', val: 0.95 },
                  { label: 'stream: true', key: 'stream', val: true },
                  { label: 'reasoning_effort: "low"', key: 'reasoning_effort', val: 'low' },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => {
                      try {
                        const current = testParams.trim() ? JSON.parse(testParams) : {};
                        current[chip.key] = chip.val;
                        setTestParams(JSON.stringify(current, null, 2));
                      } catch {
                        setTestParams(`{\n  "${chip.key}": ${JSON.stringify(chip.val)}\n}`);
                      }
                    }}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-border/80 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    + {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tab 2: Custom HTTP Headers */}
          {activeTab === 'headers' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Enter custom HTTP headers (one per line: <code>Header-Name: Value</code>).
                </span>
                <span className="font-mono text-[10px]">Header-Name: Value</span>
              </div>
              <Textarea
                value={testHeaders}
                onChange={(e) => setTestHeaders(e.target.value)}
                placeholder={`Authorization: Bearer YOUR_KEY\napi-subscription-key: YOUR_SARVAM_KEY\nHTTP-Referer: https://medigen.app\nX-Title: MediGen AI`}
                className="font-mono text-xs min-h-[120px] bg-background leading-relaxed resize-y"
              />

              {/* Quick Header Chips */}
              <div className="flex items-center flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Quick Add:
                </span>
                {[
                  { label: 'Sarvam Key Header', text: 'api-subscription-key: YOUR_KEY' },
                  { label: 'OpenRouter Headers', text: 'HTTP-Referer: https://medigen.app\nX-Title: MediGen AI' },
                  { label: 'Anthropic Version', text: 'anthropic-version: 2023-06-01' },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => {
                      const trimmed = testHeaders.trim();
                      setTestHeaders(trimmed ? `${trimmed}\n${chip.text}` : chip.text);
                    }}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-border/80 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    + {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: Documentation & Presets */}
          {activeTab === 'docs' && (
            <div className="space-y-3 p-3.5 rounded-xl bg-background border border-border/70 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground flex items-center gap-1.5">
                  <HelpCircle className="h-4 w-4 text-primary" />
                  Provider Integration Guide: {providerName}
                </span>
                <a
                  href={getProviderDocUrl(providerId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-primary hover:underline flex items-center gap-1 font-semibold"
                >
                  Official Documentation <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                If an API changes its schema or requires newer headers/parameters, simply update them in the tabs above, click <strong>&quot;Test Connection&quot;</strong>, and then click <strong>&quot;Save to Settings&quot;</strong> to persist them forever.
              </p>
              <div className="p-2.5 rounded-lg bg-muted/40 font-mono text-[11px] space-y-1">
                <div className="text-muted-foreground">Standard Endpoint:</div>
                <div className="text-foreground select-all">{getStandardEndpoint(providerId, mode)}</div>
              </div>
            </div>
          )}

          {/* Test Prompt / Message Input */}
          <div className="space-y-1.5 pt-1">
            <Label className="text-[11px] font-semibold text-foreground flex items-center justify-between">
              <span>Test Prompt / Input Text</span>
              <span className="text-[10px] font-mono text-muted-foreground">{testPrompt.length} chars</span>
            </Label>
            <Input
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Enter message to test..."
              className="h-8 text-xs bg-background"
            />
          </div>

          {/* Action Bar: Run Test & Save to App */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border/70">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleRunTest}
                disabled={isTesting}
                className="h-9 text-xs font-bold gap-2 rounded-xl shadow-2xs"
              >
                {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                <span>{isTesting ? 'Sending Request...' : 'Run Test with Parameters'}</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyCurl}
                className="h-9 text-xs rounded-xl gap-1.5 text-muted-foreground hover:text-foreground"
                title="Copy as cURL command"
              >
                {hasCopiedCurl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>cURL</span>
              </Button>
            </div>

            {/* Save Button (Highlighted upon successful test or whenever parameters changed) */}
            <div className="flex items-center gap-2">
              {hasSaved ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Saved to App Settings</span>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  onClick={handleSaveToSettings}
                  className="h-9 text-xs font-bold gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save These Parameters to Settings</span>
                </Button>
              )}
            </div>
          </div>

          {/* Detailed Test Diagnostics & Response Console */}
          {testResult && (
            <div
              className={`p-4 rounded-xl border space-y-3 transition-all ${
                testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-200'
                  : 'bg-red-500/10 border-red-500/30 text-red-950 dark:text-red-200'
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <span className="font-bold text-xs">
                    {testResult.success ? 'Request Succeeded & Verified' : 'API Request Failed'}
                  </span>
                  {testResult.httpStatus && (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-background/80 border border-border">
                      HTTP {testResult.httpStatus}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {testResult.latencyMs && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-background/80 border border-border">
                      {testResult.latencyMs}ms
                    </span>
                  )}
                  {testResult.modelUsed && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-background/80 border border-border">
                      {testResult.modelUsed}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-xs leading-relaxed opacity-95">
                {testResult.message}
              </p>

              {/* TTS Audio Player Control */}
              {testResult.audioDataUrl && (
                <div className="p-3 rounded-lg bg-background/90 border border-emerald-500/30 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleToggleAudio}
                      className="h-8 px-3 rounded-lg gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                      <span>{isPlayingAudio ? 'Pause Voice' : 'Play Voice Audio'}</span>
                    </Button>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {testResult.mimeType || 'audio/wav'}
                    </span>
                  </div>
                  <a
                    href={testResult.audioDataUrl}
                    download="tts_test_audio.wav"
                    className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    Download Audio
                  </a>
                </div>
              )}

              {/* LLM Generated Content Preview */}
              {testResult.responseText && (
                <div className="p-3 rounded-lg bg-background/90 border border-border/60 space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Model Response Output:
                  </span>
                  <p className="text-xs font-mono whitespace-pre-wrap text-foreground leading-relaxed">
                    {testResult.responseText}
                  </p>
                  {testResult.reasoningText && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Thinking / Reasoning:
                      </span>
                      <p className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap line-clamp-4">
                        {testResult.reasoningText}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Sent Request Payload Inspection */}
              {testResult.requestDetails && (
                <details className="text-[11px] pt-1">
                  <summary className="cursor-pointer font-semibold opacity-80 hover:opacity-100">
                    View Exact JSON Request Sent to API
                  </summary>
                  <pre className="mt-2 p-3 rounded-lg bg-background font-mono text-[10px] overflow-x-auto border border-border/60">
                    {JSON.stringify(testResult.requestDetails, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function getDefaultParamsForProvider(mode: string, providerId: string, model: string): Record<string, any> {
  if (mode === 'tts') {
    if (providerId === 'sarvam') {
      return {
        target_language_code: 'en-IN',
        speaker: 'meera',
        model: 'bulbul:v3',
        enable_preprocessing: true,
      };
    }
    if (providerId === 'groq') {
      return {
        model: model || 'canopylabs/orpheus-v1-english',
        voice: 'autumn',
        response_format: 'wav',
        speed: 1.0,
      };
    }
    if (providerId === 'openrouter') {
      return {
        model: model || 'hexgrad/kokoro-82m',
        voice: 'alloy',
        response_format: 'mp3',
      };
    }
    return {
      voice: 'Puck',
      speed: 1.0,
    };
  }

  if (mode === 'stt') {
    return {
      model: model || 'whisper-large-v3-turbo',
      response_format: 'json',
      temperature: 0.0,
    };
  }

  // LLM default parameters
  return {
    temperature: 0.2,
    max_tokens: 2048,
    top_p: 0.95,
  };
}

function getDefaultHeadersForProvider(providerId: string): string {
  if (providerId === 'sarvam') {
    return 'api-subscription-key: YOUR_SARVAM_KEY';
  }
  if (providerId === 'openrouter') {
    return 'HTTP-Referer: https://medigen.app\nX-Title: MediGen AI';
  }
  if (providerId === 'anthropic') {
    return 'anthropic-version: 2023-06-01';
  }
  return '';
}

function getStandardEndpoint(providerId: string, mode: string): string {
  if (mode === 'tts') {
    if (providerId === 'sarvam') return 'https://api.sarvam.ai/text-to-speech';
    if (providerId === 'groq') return 'https://api.groq.com/openai/v1/audio/speech';
    if (providerId === 'openrouter') return 'https://openrouter.ai/api/v1/audio/speech';
    return 'https://generativelanguage.googleapis.com';
  }
  if (mode === 'stt') {
    if (providerId === 'groq') return 'https://api.groq.com/openai/v1/audio/transcriptions';
    if (providerId === 'openai') return 'https://api.openai.com/v1/audio/transcriptions';
    return 'https://generativelanguage.googleapis.com';
  }
  if (providerId === 'groq') return 'https://api.groq.com/openai/v1/chat/completions';
  if (providerId === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  if (providerId === 'openai') return 'https://api.openai.com/v1/chat/completions';
  if (providerId === 'deepseek') return 'https://api.deepseek.com/v1/chat/completions';
  if (providerId === 'anthropic') return 'https://api.anthropic.com/v1/messages';
  return 'https://generativelanguage.googleapis.com';
}

function getProviderDocUrl(providerId: string): string {
  const map: Record<string, string> = {
    gemini: 'https://ai.google.dev/gemini-api/docs',
    groq: 'https://console.groq.com/docs/quickstart',
    sarvam: 'https://docs.sarvam.ai/products/text-to-speech',
    openrouter: 'https://openrouter.ai/docs',
    openai: 'https://platform.openai.com/docs/api-reference',
    deepseek: 'https://api-docs.deepseek.com',
    anthropic: 'https://docs.anthropic.com/en/api/getting-started',
    cerebras: 'https://inference-docs.cerebras.ai',
    ollama: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
  };
  return map[providerId] || 'https://ai.google.dev';
}
