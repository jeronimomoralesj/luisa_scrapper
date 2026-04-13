import type { NextRequest } from 'next/server';
import { scrapeDistributors } from '@/lib/distributorScraper';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { url, maxItems } = await request.json();
  if (!url || typeof url !== 'string') {
    return Response.json({ error: 'URL requerida' }, { status: 400 });
  }
  const limit = typeof maxItems === 'number' && maxItems > 0 ? maxItems : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const distributors = await scrapeDistributors(url, (evt) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        }, undefined, limit);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'done', data: distributors })}\n\n`,
          ),
        );
      } catch (e: any) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
