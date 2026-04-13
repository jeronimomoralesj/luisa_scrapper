import type { NextRequest } from 'next/server';
import { productsToXlsx, distributorsToXlsx } from '@/lib/exporter';

export async function POST(request: NextRequest) {
  const { mode, data } = await request.json();

  if (!data || !Array.isArray(data) || data.length === 0) {
    return Response.json({ error: 'No hay datos para exportar' }, { status: 400 });
  }

  const buffer =
    mode === 'distributors'
      ? distributorsToXlsx(data)
      : productsToXlsx(data);

  const filename =
    mode === 'distributors'
      ? 'distribuidores.xlsx'
      : 'productos_precios.xlsx';

  return new Response(buffer.buffer as ArrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
