import React, { useState } from 'react';
import { Send, Terminal, Code, CheckCircle2, AlertCircle, RefreshCw, Globe } from 'lucide-react';

export const EndpointInspector: React.FC = () => {
  const [provider, setProvider] = useState<'melolo' | 'pinedrama'>('melolo');
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('/melolo/foryou');
  const [queryParams, setQueryParams] = useState<string>('offset=20&lang=id');
  const [testMode, setTestMode] = useState<'backend' | 'browser'>('browser');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  const meloloEndpoints = [
    { label: 'ForYou / Rekomendasi', path: '/melolo/foryou', defaultParams: 'offset=20&lang=id' },
    { label: 'Trending', path: '/melolo/trending', defaultParams: 'lang=id' },
    { label: 'Latest / Terbaru', path: '/melolo/get-latest', defaultParams: 'lang=id' },
    { label: 'Anime', path: '/melolo/anime', defaultParams: 'offset=20&lang=id' },
    { label: 'Search Keyword', path: '/melolo/search', defaultParams: 'query=pewaris&limit=10&lang=id' },
    { label: 'Detail Drama', path: '/melolo/detail', defaultParams: 'book_id=7583531888644459525&lang=id' },
    { label: 'Get Episode Stream', path: '/melolo/get-episode', defaultParams: 'videoId=7583564321033030661' },
  ];

  const pinedramaEndpoints = [
    { label: 'ForYou', path: '/pinedrama/foryou', defaultParams: 'cursor=1&lang=id' },
    { label: 'Trending', path: '/pinedrama/trending', defaultParams: 'cursor=1&lang=id' },
    { label: 'Search Keyword', path: '/pinedrama/search', defaultParams: 'query=CEO&lang=id' },
    { label: 'Detail Drama', path: '/pinedrama/detail', defaultParams: 'collection_id=7690347898663539764&lang=id' },
    { label: 'Get Episode Stream', path: '/pinedrama/get-episode', defaultParams: 'collection_id=7690347898663539764&episodeNumber=1&lang=id' },
  ];

  const currentEndpointList = provider === 'melolo' ? meloloEndpoints : pinedramaEndpoints;

  const handleSelectEndpoint = (path: string) => {
    setSelectedEndpoint(path);
    const found = currentEndpointList.find((e) => e.path === path);
    if (found) {
      setQueryParams(found.defaultParams);
    }
  };

  const handleRunTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    const paramsObj: Record<string, string> = {};
    if (queryParams.trim()) {
      queryParams.split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        if (k) paramsObj[k.trim()] = v ? decodeURIComponent(v.trim()) : '';
      });
    }

    try {
      if (testMode === 'backend') {
        const res = await fetch('/api/test-endpoint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpointPath: selectedEndpoint,
            params: paramsObj,
          }),
        });
        const data = await res.json();
        setTestResult(data);
      } else {
        const queryString = new URLSearchParams(paramsObj).toString();
        const fullUrl = `https://api.sansekai.my.id/api${selectedEndpoint}?${queryString}`;
        const startTime = Date.now();

        try {
          const directRes = await fetch(fullUrl, {
            headers: { Accept: 'application/json' },
          });
          const elapsed = Date.now() - startTime;
          const json = await directRes.json();

          setTestResult({
            success: directRes.ok,
            status: directRes.status,
            fullUrl,
            elapsedMs: elapsed,
            data: json,
          });
        } catch (clientErr: any) {
          const proxyUrl = `/api/proxy?targetUrl=${encodeURIComponent(selectedEndpoint)}&${queryString}`;
          const proxyRes = await fetch(proxyUrl);
          const proxyJson = await proxyRes.json();

          setTestResult({
            success: proxyRes.ok,
            status: proxyRes.status,
            fullUrl: `Browser (Proxy Fallback) -> ${selectedEndpoint}`,
            data: proxyJson,
          });
        }
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
      <div className="border-b border-slate-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Code className="w-5 h-5 text-amber-400" />
            Endpoint Inspector &amp; Single Request Tester (Melolo &amp; PineDrama)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Test 1 request to inspect raw JSON output from Melolo and PineDrama endpoints before running sync.
          </p>
        </div>

        {/* Provider Toggle */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => {
              setProvider('melolo');
              handleSelectEndpoint('/melolo/foryou');
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              provider === 'melolo' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            🍈 Melolo
          </button>
          <button
            onClick={() => {
              setProvider('pinedrama');
              handleSelectEndpoint('/pinedrama/foryou');
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              provider === 'pinedrama' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            🌲 PineDrama
          </button>
        </div>
      </div>

      {/* Test Execution Panel */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <label className="block text-xs text-slate-400 font-semibold mb-1">
              Select {provider.toUpperCase()} Endpoint
            </label>
            <select
              value={selectedEndpoint}
              onChange={(e) => handleSelectEndpoint(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl px-3 py-2.5 font-mono focus:outline-none focus:border-amber-500 cursor-pointer"
            >
              {currentEndpointList.map((ep) => (
                <option key={ep.path} value={ep.path}>
                  {ep.label} ({ep.path})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-5">
            <label className="block text-xs text-slate-400 font-semibold mb-1">Query Parameters</label>
            <input
              type="text"
              value={queryParams}
              onChange={(e) => setQueryParams(e.target.value)}
              placeholder="e.g. videoId=7583564321033030661 or book_id=..."
              className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl px-3 py-2.5 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="md:col-span-2">
            <button
              onClick={handleRunTest}
              disabled={isTesting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all cursor-pointer disabled:opacity-50"
            >
              {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>Test 1 Req</span>
            </button>
          </div>
        </div>

        {/* Output Inspection Box */}
        {testResult && (
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300 flex items-center gap-2">
                {testResult.success !== false ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                )}
                Status: <span className="font-mono text-amber-300">{testResult.status || '200 OK'}</span>
              </span>
              <span className="text-slate-500 font-mono text-[11px] truncate max-w-md">{testResult.fullUrl}</span>
            </div>

            <pre className="p-4 bg-slate-900 rounded-xl border border-slate-800 font-mono text-xs text-slate-200 overflow-x-auto max-h-72 text-left select-text">
              {JSON.stringify(testResult.data || testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
