import React, { useState } from 'react';
import { Send, Terminal, Code, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

interface EndpointInspectorProps {
  onEndpointsUpdated?: (endpoints: any) => void;
}

export const EndpointInspector: React.FC<EndpointInspectorProps> = () => {
  const [endpoints, setEndpoints] = useState({
    forYou: '/pinedrama/foryou',
    trending: '/pinedrama/trending',
    search: '/pinedrama/search',
    detail: '/pinedrama/detail',
    getEpisode: '/pinedrama/get-episode',
  });

  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('/pinedrama/foryou');
  const [queryParams, setQueryParams] = useState<string>('cursor=1&lang=id');
  const [testMode, setTestMode] = useState<'backend' | 'browser'>('backend');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  const handleRunTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    // Parse query params string into object
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
        // Direct Browser Fetch Test
        const queryString = new URLSearchParams(paramsObj).toString();
        const fullUrl = `https://api.sansekai.my.id/api${selectedEndpoint}?${queryString}`;
        const startTime = Date.now();

        try {
          const directRes = await fetch(fullUrl, {
            headers: {
              Accept: 'application/json',
            },
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
          // Fallback via lightweight proxy
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
            Endpoint Inspector &amp; Single Request Tester
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure PineDrama endpoint routes and test 1 request to inspect raw JSON response before running full sync.
          </p>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setTestMode('backend')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              testMode === 'backend' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Backend Axios
          </button>
          <button
            onClick={() => setTestMode('browser')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              testMode === 'browser' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Direct Browser Fetch
          </button>
        </div>
      </div>

      {/* Editable Endpoints Form */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
        <div>
          <label className="block text-slate-400 font-semibold mb-1">ForYou Route</label>
          <input
            type="text"
            value={endpoints.forYou}
            onChange={(e) => setEndpoints({ ...endpoints, forYou: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-slate-400 font-semibold mb-1">Trending Route</label>
          <input
            type="text"
            value={endpoints.trending}
            onChange={(e) => setEndpoints({ ...endpoints, trending: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-slate-400 font-semibold mb-1">Get Episode Route</label>
          <input
            type="text"
            value={endpoints.getEpisode}
            onChange={(e) => setEndpoints({ ...endpoints, getEpisode: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Test Execution Panel */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <label className="block text-xs text-slate-400 font-semibold mb-1">Endpoint to Test</label>
            <select
              value={selectedEndpoint}
              onChange={(e) => setSelectedEndpoint(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl px-3 py-2.5 font-mono focus:outline-none focus:border-amber-500 cursor-pointer"
            >
              <option value={endpoints.forYou}>ForYou ({endpoints.forYou})</option>
              <option value={endpoints.trending}>Trending ({endpoints.trending})</option>
              <option value={endpoints.search}>Search ({endpoints.search})</option>
              <option value={endpoints.detail}>Detail ({endpoints.detail})</option>
              <option value={endpoints.getEpisode}>Get Episode ({endpoints.getEpisode})</option>
            </select>
          </div>

          <div className="md:col-span-5">
            <label className="block text-xs text-slate-400 font-semibold mb-1">Query Parameters (URL encoded)</label>
            <input
              type="text"
              value={queryParams}
              onChange={(e) => setQueryParams(e.target.value)}
              placeholder="e.g. cursor=1&lang=id or collection_id=7690347898663539764&episodeNumber=1"
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

        {/* Test Output Inspection Box */}
        {testResult && (
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300 flex items-center gap-2">
                {testResult.success !== false ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                )}
                Response Output Status: <span className="font-mono text-amber-300">{testResult.status || 'N/A'}</span>
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
