import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type LogLevel = 'info' | 'error' | 'success' | 'warn';

export interface LogEntry {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
  details?: string;
}

interface TerminalContextType {
  logs: LogEntry[];
  addLog: (level: LogLevel, message: string, details?: string | any) => void;
  clearLogs: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  heightMode: 'normal' | 'expanded';
  setHeightMode: (mode: 'normal' | 'expanded') => void;
  copyAllLogs: () => Promise<boolean>;
  errorCount: number;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    const initialTime = new Date().toLocaleTimeString('id-ID', { hour12: false });
    return [
      {
        id: 'init-1',
        time: initialTime,
        level: 'info',
        message: '🖥️ Live Web Terminal Log diinisialisasi. Siap merekam aktivitas & error backend/frontend.',
      },
    ];
  });
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [heightMode, setHeightMode] = useState<'normal' | 'expanded'>('normal');

  const addLog = useCallback((level: LogLevel, message: string, details?: string | any) => {
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    let formattedDetails: string | undefined = undefined;

    if (details) {
      if (typeof details === 'string') {
        formattedDetails = details;
      } else {
        try {
          formattedDetails = JSON.stringify(details, null, 2);
        } catch {
          formattedDetails = String(details);
        }
      }
    }

    const newEntry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      time,
      level,
      message,
      details: formattedDetails,
    };

    setLogs((prev) => [...prev.slice(-300), newEntry]); // keep up to 300 logs

    // If an error occurs, automatically ensure terminal is visible or alert user
    if (level === 'error') {
      console.error(`[TerminalLogger] ${message}`, details);
    }
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const copyAllLogs = useCallback(async (): Promise<boolean> => {
    try {
      if (logs.length === 0) return false;
      const text = logs
        .map((l) => {
          let line = `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`;
          if (l.details) {
            line += `\n--- DETAILS / STACK TRACE ---\n${l.details}\n-----------------------------`;
          }
          return line;
        })
        .join('\n\n');

      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to copy logs:', err);
      return false;
    }
  }, [logs]);

  const errorCount = logs.filter((l) => l.level === 'error').length;

  // Expose global helper for non-react or window access if needed
  useEffect(() => {
    (window as any).__terminalLogger = { addLog, clearLogs };
  }, [addLog, clearLogs]);

  return (
    <TerminalContext.Provider
      value={{
        logs,
        addLog,
        clearLogs,
        isOpen,
        setIsOpen,
        toggleOpen,
        heightMode,
        setHeightMode,
        copyAllLogs,
        errorCount,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
};

export const useTerminal = (): TerminalContextType => {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
};
