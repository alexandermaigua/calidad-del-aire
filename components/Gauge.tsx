import React, { useState, useEffect } from 'react';

interface GaugeProps {
  value: number;
  max: number;
  label: string;
  unit: string;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export const Gauge: React.FC<GaugeProps> = ({ value, max, label, unit }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    // Basic spring animation
    const animationFrame = requestAnimationFrame(() => {
      const diff = value - displayValue;
      if (Math.abs(diff) < 0.01) {
        setDisplayValue(value);
      } else {
        setDisplayValue(displayValue + diff * 0.1);
      }
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [value, displayValue]);

  const t = clamp(displayValue / max, 0, 1);
  const trackLen = 157.08; // Circumference of a semicircle with r=50 is PI * 50
  const offset = trackLen * (1 - t);

  // Calculate knob position
  const angle = Math.PI * (1 - t); // Angle from PI (left) to 0 (right)
  const r = 50, cx = 60, cy = 60;
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle); // Use subtraction for upper semicircle

  let colorClass = 'stroke-blue-500';
  let colorValue = '#3b82f6';
  
  if (t < 0.33) {
    colorClass = 'stroke-green-500';
    colorValue = '#22c55e';
  } else if (t < 0.66) {
    colorClass = 'stroke-yellow-500';
    colorValue = '#eab308';
  } else {
    colorClass = 'stroke-red-500';
    colorValue = '#ef4444';
  }

  // Hide the progress bar track if the value is zero to prevent rendering artifacts.
  const isValueZero = t <= 0.001;
  
  return (
    <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 flex flex-col col-span-6 md:col-span-3 dark:bg-slate-800 dark:border-slate-700">
      <h4 className="m-0 mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</h4>
      <svg className="w-full h-auto" viewBox="0 0 120 75">
        {/* Background track */}
        <path
          className="fill-none stroke-slate-200 dark:stroke-slate-600"
          strokeWidth="10"
          strokeLinecap="round"
          d="M10,60 A50,50 0 0 1 110,60"
        />
        {/* Progress track */}
        {!isValueZero && (
            <path
              className={`fill-none ${colorClass} transition-colors duration-300`}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={trackLen}
              strokeDashoffset={offset}
              d="M10,60 A50,50 0 0 1 110,60"
            />
        )}
        {/* Knob */}
        <circle
          cx={x}
          cy={y}
          r="8"
          fill={colorValue}
          stroke="#fff"
          strokeWidth="3"
          style={{ transition: 'cx 0.1s ease, cy 0.1s ease' }}
        />
      </svg>
      <div className="mt-1.5 text-center font-bold text-lg text-slate-800 dark:text-white">
        <span>{isNaN(value) ? '--' : value.toFixed(2)}</span>
        <span className="text-sm font-medium text-slate-500 ml-1 dark:text-slate-400">{unit}</span>
      </div>
    </div>
  );
};
