import { createContext, useCallback, useContext, useState } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(() => {});
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const toast = useCallback((message, { tone = 'info', duration = 4000 } = {}) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    if (duration) setTimeout(() => dismiss(id), duration);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-fade-up pointer-events-auto flex max-w-md items-center gap-3 rounded-full border bg-night-2/90 py-2.5 pr-3 pl-5 text-sm text-vellum shadow-[0_20px_50px_-20px_rgba(0,0,0,.8)] backdrop-blur-xl ${
              t.tone === 'error' ? 'border-danger/60' : t.tone === 'success' ? 'border-brand-300/60' : 'border-vellum/10'
            }`}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${t.tone === 'error' ? 'bg-red-400' : 'bg-brand-300'}`} />
            <span>{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="opacity-70 hover:opacity-100" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
