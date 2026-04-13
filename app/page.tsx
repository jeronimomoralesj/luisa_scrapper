'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

type Mode = 'prices' | 'distributors';

export default function Home() {
  const [mode, setMode] = useState<Mode>('prices');
  const [url, setUrl] = useState('');
  const [maxItems, setMaxItems] = useState<number | ''>('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [count, setCount] = useState(0);
  const [data, setData] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  const startScrape = async () => {
    if (!url.trim()) return;
    setRunning(true);
    setLogs([]);
    setProgress({ current: 0, total: 0 });
    setCount(0);
    setData(null);
    setError('');

    const endpoint =
      mode === 'prices'
        ? '/api/scrape/prices'
        : '/api/scrape/distributors';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), maxItems: maxItems || undefined }),
      });

      if (!res.ok || !res.body) {
        setError(`Error: ${res.status} ${res.statusText}`);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.replace(/^data:\s*/, '').trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            if (evt.type === 'log') addLog(evt.message);
            else if (evt.type === 'progress')
              setProgress({ current: evt.current, total: evt.total });
            else if (evt.type === 'count') setCount(evt.count);
            else if (evt.type === 'done') setData(evt.data);
            else if (evt.type === 'error') setError(evt.message);
          } catch {}
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const downloadXlsx = async () => {
    if (!data?.length) return;
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode === 'prices' ? 'prices' : 'distributors', data }),
      });
      if (!res.ok) {
        setError('Error al exportar');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download =
        mode === 'prices' ? 'productos_precios.xlsx' : 'distribuidores.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const pct =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-zinc-950 font-sans">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          Luisa Scrapper
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Extrae precios de productos o información de distribuidores
        </p>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8 space-y-6">
        {/* Mode selector */}
        <div className="flex gap-2">
          <button
            onClick={() => { setMode('prices'); setData(null); setLogs([]); setError(''); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'prices'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            Precios de productos
          </button>
          <button
            onClick={() => { setMode('distributors'); setData(null); setLogs([]); setError(''); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'distributors'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            Distribuidores
          </button>
        </div>

        {/* URL input */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {mode === 'prices'
              ? 'URL de la página de productos'
              : 'URL de la página de distribuidores'}
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                mode === 'prices'
                  ? 'https://interllantas.com/categoria-producto/llantas/'
                  : 'https://tiendaredllantas.co/distribuidores'
              }
              disabled={running}
              className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !running) startScrape();
              }}
            />
            <button
              onClick={startScrape}
              disabled={running || !url.trim()}
              className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {running ? 'Scraping...' : 'Iniciar'}
            </button>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <label className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
              Máximo de resultados
            </label>
            <input
              type="number"
              min={1}
              value={maxItems}
              onChange={(e) => setMaxItems(e.target.value ? parseInt(e.target.value, 10) : '')}
              placeholder="Sin límite"
              disabled={running}
              className="w-32 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Progress bar */}
        {running && progress.total > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                Página {progress.current} / {progress.total}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            {count > 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {count} {mode === 'prices' ? 'productos' : 'distribuidores'}{' '}
                encontrados
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Log
            </h2>
            <div className="bg-zinc-900 text-zinc-300 rounded-lg p-4 max-h-64 overflow-y-auto text-xs font-mono space-y-0.5">
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* Results */}
        {data && data.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Resultados: {data.length}{' '}
                {mode === 'prices' ? 'productos' : 'distribuidores'}
              </h2>
              <button
                onClick={downloadXlsx}
                className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
              >
                Descargar XLSX
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800">
                    {mode === 'prices' ? (
                      <>
                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                          Nombre
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                          Precio
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                          Marca
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                          SKU
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                          Nombre
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                          Teléfono
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                          Email
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                          Ciudad
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 50).map((item: any, i: number) => (
                    <tr
                      key={i}
                      className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      {mode === 'prices' ? (
                        <>
                          <td className="px-3 py-2 text-zinc-900 dark:text-zinc-200 max-w-xs truncate">
                            {item.name}
                          </td>
                          <td className="px-3 py-2 text-zinc-900 dark:text-zinc-200 whitespace-nowrap">
                            {item.currency}
                            {item.price}
                          </td>
                          <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                            {item.brand}
                          </td>
                          <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                            {item.sku}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-zinc-900 dark:text-zinc-200 max-w-xs truncate">
                            {item.name}
                          </td>
                          <td className="px-3 py-2 text-zinc-900 dark:text-zinc-200 whitespace-nowrap">
                            {item.phone}
                          </td>
                          <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                            {item.email}
                          </td>
                          <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                            {item.city}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.length > 50 && (
                <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
                  Mostrando 50 de {data.length} resultados. Descarga el XLSX
                  para ver todos.
                </div>
              )}
            </div>
          </div>
        )}

        {data && data.length === 0 && !running && (
          <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400 text-sm">
            No se encontraron resultados. Verifica que la URL sea correcta y que
            la página tenga el contenido esperado.
          </div>
        )}
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-3 text-center text-xs text-zinc-400">
        Luisa Scrapper &mdash; Extractor de datos web
      </footer>
    </div>
  );
}
