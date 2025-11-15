import React from 'react';

interface NotificationBannerProps {
  onAllow: () => void;
  onBlock: () => void;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({ onAllow, onBlock }) => {
  return (
    <div className="fixed bottom-0 left-0 w-full bg-slate-800 text-white p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center text-center sm:text-left z-50">
      <p className="mb-2 sm:mb-0">¿Desea recibir notificaciones cuando la calidad del aire sea mala?</p>
      <div>
        <button onClick={onAllow} className="px-4 py-2 bg-green-500 text-white rounded-lg font-semibold text-sm hover:bg-green-600 transition mr-2">
          Permitir
        </button>
        <button onClick={onBlock} className="px-4 py-2 bg-red-500 text-white rounded-lg font-semibold text-sm hover:bg-red-600 transition">
          Bloquear
        </button>
      </div>
    </div>
  );
};
