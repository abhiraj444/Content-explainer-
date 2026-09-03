import { NextRequest } from 'next/server';
import { performTtsSynthesis } from '../route';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Server-side speech chunk splitter for streaming TTS.
 */
function splitTextIntoSpeechChunks(text: string, targetMaxChars = 140): string[] {
  if (!text) return [];
  const clean = text
    .replace(/[*#`_~\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length <= targetMaxChars) {
    return [clean];
  }

  const sentences: string[] = [];
  const rawParts = clean.split(/(?<=[.!?;\n])\s+/);

  let currentSentence = '';
  for (const part of rawParts) {
    if (!part) continue;
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

  return finalChunks.filter((c) => c.trim().length > 0);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return new Response(JSON.stringify({ error: 'Text is required for TTS streaming.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const chunks = splitTextIntoSpeechChunks(text, 130);
    const totalChunks = chunks.length;

    const encoder = new TextEncoder();
    const startTime = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial metadata event
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'init',
                totalChunks,
                chunks: chunks.map((c, idx) => ({ index: idx, text: c })),
              })}\n\n`
            )
          );

          // Synthesize each chunk in pipelined order and stream immediately
          for (let i = 0; i < totalChunks; i++) {
            const chunkText = chunks[i];
            const chunkStart = Date.now();

            try {
              const synthesisResult = await performTtsSynthesis({
                ...body,
                text: chunkText,
              });

              const latencyMs = Date.now() - chunkStart;

              const eventData = {
                type: 'chunk',
                index: i,
                totalChunks,
                text: chunkText,
                audioBase64: synthesisResult.audioBase64,
                audioDataUrl: synthesisResult.audioDataUrl,
                mimeType: synthesisResult.mimeType,
                voice: synthesisResult.voice,
                latencyMs,
                isLast: i === totalChunks - 1,
              };

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventData)}\n\n`));
            } catch (chunkErr: any) {
              console.warn(`TTS Stream Chunk ${i} error:`, chunkErr);
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'chunk_error',
                    index: i,
                    totalChunks,
                    text: chunkText,
                    error: chunkErr?.message || 'Chunk synthesis failed',
                    isLast: i === totalChunks - 1,
                  })}\n\n`
                )
              );
            }
          }

          // Send stream completion event
          const totalDurationMs = Date.now() - startTime;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'done',
                totalChunks,
                totalDurationMs,
              })}\n\n`
            )
          );
        } catch (streamErr: any) {
          console.error('Fatal TTS stream error:', streamErr);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: streamErr?.message || 'TTS Stream encountered a fatal error.',
              })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('TTS Stream route handler error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Server error initiating TTS stream' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
