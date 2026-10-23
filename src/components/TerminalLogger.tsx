import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Terminal as TerminalIcon,
  X,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Info,
  AlertTriangle,
  ArrowDownCircle,
  Search,
} from 'lucide-react';
import { useTerminal, LogLevel } from '../context/TerminalContext';

export const TerminalLogger: React.FC = () => {
  const {
    logs,
    clearLogs,
    isOpen,
    setIsOpen,
    toggleOpen,
    heightMode,
    setHeightMode,
    copyAllLogs,
    errorCount,
  } = useTerminal();

  const [activeFilter, setActiveFilter] = useState<'all' | LogLevel>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [copiedDetailId, setCopiedDetailId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

  const logsEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && isOpen && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  // Expand error details automatically when a new error occurs
  useEffect(() => {
    const lastLog = logs[logs.length - 1];
    if (lastLog && lastLog.level === 'error' && lastLog.details) {
      setExpandedDetails((prev) => ({ ...prev, [lastLog.id]: true }));
    }
  }, [logs]);

  // Filter logs based on category and search query
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchFilter = activeFilter === 'all' || log.level === activeFilter;
      const matchSearch =
        !searchQuery.trim() ||
        log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (log.details && log.details.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchFilter && matchSearch;
    });
  }, [logs, activeFilter, searchQuery]);

  const handleCopyAll = async () => {
    const success = await copyAllLogs();
    if (success) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleCopyDetail = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedDetailId(id);
      setTimeout(() => setCopiedDetailId(null), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleDetail = (id: string) => {
    setExpandedDetails((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const successCount = logs.filter((l) => l.level === 'success').length;
  const infoCount = logs.filter((l) => l.level === 'info').length;

  // Minimized floating trigger pill
  if (!isOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <button
          onClick={toggleOpen}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full font-mono text-xs font-bold shadow-2xl transition-all cursor-pointer border ${
            errorCount > 0
              ? 'bg-rose-950/90 text-rose-200 border-rose-600/80 hover:bg-rose-900 animate-pulse'
              : 'bg-slate-900/90 text-slate-200 border-slate-700 hover:bg-slate-800'
          }`}
          title="Klik untuk membuka Live Web Terminal Log"
        >
          <TerminalIcon className="w-4 h-4 text-cyan-400" />
          <span>🖥️ Terminal</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-950 text-[10px] text-slate-300 font-semibold border border-slate-800">
            {logs.length}
          </span>
          {errorCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black">
              {errorCount} Error{errorCount > 1 ? 's' : ''}
            </span>
          )}
        </button>
      </div>
    );
  }

  const heightClass = heightMode === 'expanded' ? 'h-[480px]' : 'h-[270px]';

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 bg-[#090d16]/95 backdrop-blur-md border-t border-slate-800 shadow-2xl flex flex-col transition-all duration-200 ${heightClass}`}
    >
      {/* Terminal Top Bar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-950/90 border-b border-slate-800/80 text-xs select-none gap-2">
        {/* Left: Branding & Status Badge */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 font-mono font-bold text-slate-200">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <TerminalIcon className="w-4 h-4 text-cyan-400" />
            <span className="tracking-tight text-white font-black">LIVE WEB TERMINAL</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 font-mono text-[11px]">
            <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
              Total: <strong className="text-white">{logs.length}</strong>
            </span>
            {errorCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">
                🔴 {errorCount} Error{errorCount > 1 ? 's' : ''}
              </span>
            )}
            {successCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                🟢 {successCount} OK
              </span>
            )}
          </div>
        </div>

        {/* Center: Filter Tabs & Search */}
        <div className="flex items-center gap-2">
          {/* Level Filter Buttons */}
          <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800 font-mono text-[10px]">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer font-bold ${
                activeFilter === 'all' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({logs.length})
            </button>
            <button
              onClick={() => setActiveFilter('error')}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer font-bold ${
                activeFilter === 'error' ? 'bg-rose-500 text-white' : 'text-rose-400 hover:text-rose-200'
              }`}
            >
              Errors ({errorCount})
            </button>
            <button
              onClick={() => setActiveFilter('success')}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer font-bold ${
                activeFilter === 'success' ? 'bg-emerald-500 text-slate-950' : 'text-emerald-400 hover:text-emerald-200'
              }`}
            >
              Success ({successCount})
            </button>
            <button
              onClick={() => setActiveFilter('info')}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer font-bold ${
                activeFilter === 'info' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Info ({infoCount})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative hidden md:block">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Cari log / error..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-6 pr-2 py-0.5 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500 w-36"
            />
          </div>
        </div>

        {/* Right: Actions (Copy All, Clear, Height, Minimize) */}
        <div className="flex items-center gap-1.5 font-mono">
          {/* Copy All Logs Button */}
          <button
            onClick={handleCopyAll}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer border ${
              isCopied
                ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
            }`}
            title="Salin seluruh isi log terminal ke clipboard"
          >
            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{isCopied ? 'Tersalin!' : '📋 Copy All Logs'}</span>
          </button>

          {/* Clear Logs */}
          <button
            onClick={clearLogs}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 transition-all cursor-pointer"
            title="Bersihkan seluruh log"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>

          {/* Auto Scroll Toggle */}
          <button
            onClick={() => setAutoScroll((prev) => !prev)}
            className={`p-1 rounded-lg border transition-all cursor-pointer ${
              autoScroll
                ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
            title={autoScroll ? 'Auto-scroll Aktif (klik untuk matikan)' : 'Auto-scroll Nonaktif'}
          >
            <ArrowDownCircle className="w-3.5 h-3.5" />
          </button>

          {/* Expand / Shrink Height */}
          <button
            onClick={() => setHeightMode(heightMode === 'normal' ? 'expanded' : 'normal')}
            className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-all cursor-pointer"
            title={heightMode === 'normal' ? 'Perbesar terminal' : 'Perkecil terminal'}
          >
            {heightMode === 'normal' ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Minimize Terminal */}
          <button
            onClick={toggleOpen}
            className="p-1 rounded-lg bg-slate-900 hover:bg-rose-950 hover:text-rose-400 text-slate-400 border border-slate-800 transition-all cursor-pointer"
            title="Tutup / Minimize Terminal"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Log Output Body */}
      <div
        ref={logContainerRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 bg-[#070a10]"
      >
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-600 space-y-1 select-none">
            <TerminalIcon className="w-8 h-8 mx-auto opacity-30" />
            <div className="font-semibold text-slate-500">Tidak ada log yang sesuai filter</div>
            <div className="text-[11px] text-slate-600">Aktivitas baru akan otomatis dicatat di sini.</div>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isError = log.level === 'error';
            const isSuccess = log.level === 'success';
            const isWarn = log.level === 'warn';
            const hasDetails = Boolean(log.details);
            const isDetailExpanded = expandedDetails[log.id] || false;

            return (
              <div
                key={log.id}
                className={`rounded-lg p-2 border transition-all ${
                  isError
                    ? 'bg-rose-950/30 border-rose-900/60 text-rose-200'
                    : isSuccess
                    ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-200'
                    : isWarn
                    ? 'bg-amber-950/20 border-amber-900/40 text-amber-200'
                    : 'bg-slate-900/40 border-slate-800/60 text-slate-300'
                }`}
              >
                {/* Main Log Header Line */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 break-all">
                    {/* Timestamp */}
                    <span className="text-[11px] text-slate-500 select-none shrink-0">
                      [{log.time}]
                    </span>

                    {/* Level Badge */}
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-black uppercase tracking-wider shrink-0 ${
                        isError
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                          : isSuccess
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : isWarn
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                          : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                      }`}
                    >
                      {log.level}
                    </span>

                    {/* Message Content */}
                    <span className="font-medium whitespace-pre-wrap">{log.message}</span>
                  </div>

                  {/* Actions for this specific log */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasDetails && (
                      <button
                        onClick={() => toggleDetail(log.id)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
                          isDetailExpanded
                            ? 'bg-slate-800 text-slate-200 border-slate-700'
                            : 'bg-slate-900/80 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20'
                        }`}
                      >
                        {isDetailExpanded ? (
                          <>
                            <ChevronUp className="w-3 h-3" />
                            <span>Tutup Stack</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3 h-3" />
                            <span>Detail Stack</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      onClick={() => handleCopyDetail(log.id, `${log.message}\n${log.details || ''}`)}
                      className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
                      title="Salin baris log ini"
                    >
                      {copiedDetailId === log.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Collapsible Details / Error Stack Trace Box */}
                {hasDetails && isDetailExpanded && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between pb-1.5 text-[10px] text-slate-400 uppercase font-bold">
                      <div className="flex items-center gap-1 text-rose-400">
                        <AlertCircle className="w-3 h-3" />
                        <span>Backend Error Stack / Response Details:</span>
                      </div>
                      <button
                        onClick={() => handleCopyDetail(`${log.id}-stack`, log.details || '')}
                        className="text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {copiedDetailId === `${log.id}-stack` ? (
                          <span className="text-emerald-400 font-bold">Tersalin!</span>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Stack Only</span>
                          </>
                        )}
                      </button>
                    </div>

                    <pre className="p-2.5 bg-black/60 rounded-lg border border-slate-800/80 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-48 scrollbar-thin">
                      {log.details}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};
