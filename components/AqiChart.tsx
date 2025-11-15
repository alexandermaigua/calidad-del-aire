import React from 'react';
import { AreaChart, Area, Tooltip, ResponsiveContainer, YAxis, XAxis, CartesianGrid, ReferenceArea } from 'recharts';
import { HistoricalData } from '../types';
import { useTheme } from './ThemeProvider';

interface AqiChartProps {
  data: HistoricalData[];
}

export const AqiChart: React.FC<AqiChartProps> = ({ data }) => {
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[250px] text-slate-500 dark:text-slate-400">
        Loading chart data...
      </div>
    );
  }

  const chartData = data.map(d => ({ name: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), aqi: d.aqi }));

  const yAxisTicks = [0, 50, 100, 150, 200, 300, 500];

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={chartData} margin={{ top: 5, right: 20, left: -15, bottom: 5 }}>
        <defs>
          <linearGradient id="aqiGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4}/>
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#475569' : '#e0e0e0'} />

        <XAxis dataKey="name" 
            tick={{ fontSize: 12, fill: isDarkMode ? '#cbd5e1' : '#64748b' }} 
            axisLine={{ stroke: isDarkMode ? '#475569' : '#cbd5e1' }} 
            tickLine={{ stroke: isDarkMode ? '#475569' : '#cbd5e1' }} />
        <YAxis 
          domain={[0, (dataMax: number) => Math.max(dataMax + 25, 300)]}
          ticks={yAxisTicks}
          tick={{ fontSize: 12, fill: isDarkMode ? '#cbd5e1' : '#64748b' }} 
          axisLine={{ stroke: isDarkMode ? '#475569' : '#cbd5e1' }} 
          tickLine={{ stroke: isDarkMode ? '#475569' : '#cbd5e1' }}
        />
        
        <Tooltip
          contentStyle={{
            backgroundColor: isDarkMode ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)',
            border: isDarkMode ? '1px solid #475569' : '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
          }}
          labelStyle={{ fontWeight: 'bold', color: isDarkMode ? '#f8fafc' : '#1e293b' }}
        />

        {/* Reference areas for AQI levels */}
        <ReferenceArea y1={0} y2={50} fill="rgba(34, 197, 94, 0.1)" stroke="rgba(34, 197, 94, 0.15)" strokeDasharray="2 2" />
        <ReferenceArea y1={50} y2={100} fill="rgba(234, 179, 8, 0.1)" stroke="rgba(234, 179, 8, 0.15)" strokeDasharray="2 2" />
        <ReferenceArea y1={100} y2={150} fill="rgba(249, 115, 22, 0.1)" stroke="rgba(249, 115, 22, 0.15)" strokeDasharray="2 2" />
        <ReferenceArea y1={150} y2={200} fill="rgba(239, 68, 68, 0.1)" stroke="rgba(239, 68, 68, 0.15)" strokeDasharray="2 2" />
        <ReferenceArea y1={200} y2={300} fill="rgba(168, 85, 247, 0.1)" stroke="rgba(168, 85, 247, 0.15)" strokeDasharray="2 2" />
        <ReferenceArea y1={300} y2={500} fill="rgba(136, 19, 55, 0.1)" stroke="rgba(136, 19, 55, 0.15)" strokeDasharray="2 2" />
        
        <Area
          type="monotone"
          dataKey="aqi"
          stroke="#2563eb"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#aqiGradient)"
          dot={{ r: 2, fill: '#2563eb' }}
          activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};