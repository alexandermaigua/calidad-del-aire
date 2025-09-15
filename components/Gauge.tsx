
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
    setDisplayValue(value);
  }, [value]);
  
  const t = clamp(displayValue / max, 0, 1);
  const trackLen = 157;
  const offset = trackLen * (1 - t);
  
  const start = Math.PI, end = 0;
  const angle = start + (end - start) * t;
  const r = 50, cx = 60, cy = 60;
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);

  let color = 'stroke-blue-500';
  if (max > 120 && max !== 100) {
    if (t < 0.33) color = 'stroke-green-500';
    else if (t < 0.66) color = 'stroke-yellow-500';
    else color = 'stroke-red-500';
  }

  return (
    <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 flex flex-col col-span-12 sm:col-span-6 md:col-span-4 lg:col-span-3 xl:col-span-2">
      <h4 className="m-0 mb-2 text-sm font-semibold text-slate-700">{label}</h4>
      <svg className="w-full h-auto" viewBox="0 0 120 70">
        <path className="fill-none stroke-slate-200" strokeWidth="10" strokeLinecap="round" d="M10,60 A50,50 0 1 1 110,60" />
        <path 
          className={`fill-none ${color} transition-all duration-700 ease-out`}
          strokeWidth="10" 
          strokeLinecap="round" 
          strokeDasharray="157" 
          strokeDashoffset={offset} 
          d="M10,60 A50,50 0 1 1 110,60" 
        />
        <circle className={`fill-current ${color.replace('stroke-', 'text-')} transition-all duration-700 ease-out`} cx={x.toFixed(2)} cy={y.toFixed(2)} r="4"/>
      </svg>
      <div className="mt-1.5 text-center font-bold text-lg text-slate-800">
        <span>{isNaN(value) ? '--' : value.toFixed(2)}</span>
        <span className="text-sm font-medium text-slate-500 ml-1">{unit}</span>
      </div>
    </div>
  );
};
