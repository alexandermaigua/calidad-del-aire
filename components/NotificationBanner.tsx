import React from 'react';

interface NotificationBannerProps {
  onAllow: () => void;
  onBlock: () => void;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({ onAllow, onBlock }) => {
  return (
    <div className="fixed bottom-4 right-4 w-full max-w-sm bg-white dark:bg-slate-800 shadow-2xl rounded-lg p-4 border border-slate-200 dark:border-slate-700">
      <h3 className="font-bold text-slate-800 dark:text-slate-200">Enable Notifications</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
        Get notified when air quality changes.
      </p>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onAllow}
          className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md font-semibold text-sm hover:bg-blue-600 transition"
        >
          Allow
        </button>
        <button
          onClick={onBlock}
          className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md font-semibold text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition"
        >
          Block
        </button>
      </div>
    </div>
  );
};
