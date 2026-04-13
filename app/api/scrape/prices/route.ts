import type { NextRequest } from 'next/server';
import { scrapePrices } from '@/lib/priceScraper';

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
        const products = await scrapePrices(url, (evt) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        }, undefined, limit);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'done', data: products })}\n\n`,
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
