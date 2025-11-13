import React, { useState, useEffect, useCallback, useRef, PropsWithChildren } from 'react';
// FIX: Use a namespace import for react-router-dom to resolve module resolution errors. This is more robust against CJS/ESM inconsistencies.
import * as ReactRouterDOM from 'react-router-dom';
// FIX: Import firebase to make firebase types available in this file.
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { db } from './services/firebase';
import { SensorData, WeatherData, AlertRecord, AqiLevel, HistoricalData, DeviceData } from './types';
import { DashboardIcon, SensorIcon, AlertIcon, HistoryIcon, MenuIcon, CloseIcon } from './components/Icons';
import { Gauge } from './components/Gauge';
import { AqiChart } from './components/AqiChart';
import { NotificationBanner } from './components/NotificationBanner';

// --- CONSTANTS & HELPERS ---
const POLLUTANT_THRESH = { pm25: { warn: 35.5, bad: 55.5 }, o3: { warn: 125, bad: 200 } };
const AQI_LEVELS = ['Bueno', 'Moderado', 'Sensibles', 'Malo', 'Muy Malo', 'Peligroso'];
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

const getAqiLevel = (v: number): AqiLevel => {
  if (v <= 50) return { text: 'Bueno', cls: 'good', className: 'bg-green-100 text-green-800 border-green-300' };
  if (v <= 100) return { text: 'Moderado', cls: 'mod', className: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
  if (v <= 150) return { text: 'Sensibles', cls: 'warn', className: 'bg-orange-100 text-orange-800 border-orange-300' };
  if (v <= 200) return { text: 'Malo', cls: 'bad', className: 'bg-red-100 text-red-800 border-red-300' };
  if (v <= 300) return { text: 'Muy Malo', cls: 'bad', className: 'bg-purple-100 text-purple-800 border-purple-300' };
  return { text: 'Peligroso', cls: 'bad', className: 'bg-maroon-100 text-maroon-800 border-maroon-300' };
};

// --- AQI Calculation based on EPA AQI Standard 2018 ---
// Reference: Technical Assistance Document for the Reporting of Daily Air Quality – the Air Quality Index (AQI) - EPA-454/B-18-007
interface AqiBreakpoint {
  aqi_low: number;
  aqi_high: number;
  c_low: number;
  c_high: number;
}

// PM2.5 (24-hour) Breakpoints based on EPA Standard (units: µg/m³)
const PM25_BREAKPOINTS: AqiBreakpoint[] = [
    { aqi_low: 0, aqi_high: 50, c_low: 0.0, c_high: 12.0 },
    { aqi_low: 51, aqi_high: 100, c_low: 12.1, c_high: 35.4 },
    { aqi_low: 101, aqi_high: 150, c_low: 35.5, c_high: 55.4 },
    { aqi_low: 151, aqi_high: 200, c_low: 55.5, c_high: 150.4 },
    { aqi_low: 201, aqi_high: 300, c_low: 150.5, c_high: 250.4 },
    { aqi_low: 301, aqi_high: 400, c_low: 250.5, c_high: 350.4 },
    { aqi_low: 401, aqi_high: 500, c_low: 350.5, c_high: 500.4 },
];

// O3 (8-hour) Breakpoints based on EPA Standard (units: ppm)
const O3_BREAKPOINTS: AqiBreakpoint[] = [
    { aqi_low: 0, aqi_high: 50, c_low: 0.000, c_high: 0.054 },
    { aqi_low: 51, aqi_high: 100, c_low: 0.055, c_high: 0.070 },
    { aqi_low: 101, aqi_high: 150, c_low: 0.071, c_high: 0.085 },
    { aqi_low: 151, aqi_high: 200, c_low: 0.086, c_high: 0.105 },
    { aqi_low: 201, aqi_high: 300, c_low: 0.106, c_high: 0.200 },
];

// CO (8-hour) Breakpoints based on EPA Standard (units: ppm)
const CO_BREAKPOINTS: AqiBreakpoint[] = [
    { aqi_low: 0, aqi_high: 50, c_low: 0.0, c_high: 4.4 },
    { aqi_low: 51, aqi_high: 100, c_low: 4.5, c_high: 9.4 },
    { aqi_low: 101, aqi_high: 150, c_low: 9.5, c_high: 12.4 },
    { aqi_low: 151, aqi_high: 200, c_low: 12.5, c_high: 15.4 },
    { aqi_low: 201, aqi_high: 300, c_low: 15.5, c_high: 30.4 },
    { aqi_low: 301, aqi_high: 400, c_low: 30.5, c_high: 40.4 },
    { aqi_low: 401, aqi_high: 500, c_low: 40.5, c_high: 50.4 },
];

const calculateIndividualAqi = (concentration: number, breakpoints: AqiBreakpoint[]): number => {
  if (isNaN(concentration) || concentration < 0) return 0;

  const bp = breakpoints.find(b => concentration >= b.c_low && concentration <= b.c_high);
  
  if (!bp) {
      const lastBp = breakpoints[breakpoints.length - 1];
      if (concentration > lastBp.c_high) return 500;
      return 0; 
  }

  if (bp.c_high === bp.c_low) return bp.aqi_low;

  const aqi = ((bp.aqi_high - bp.aqi_low) / (bp.c_high - bp.c_low)) * (concentration - bp.c_low) + bp.aqi_low;
  return Math.round(aqi);
};

const calculateOverallAqi = (pm25_ugm3: number, o3_ppm: number, co_ppm: number): number => {
  // Concentrations are truncated as per EPA guidelines (page 13 of document)
  const truncatedPm25 = Math.trunc(pm25_ugm3 * 10) / 10; // Truncate to 1 decimal place
  const truncatedO3 = Math.trunc(o3_ppm * 1000) / 1000; // Truncate to 3 decimal places
  const truncatedCo = Math.trunc(co_ppm * 10) / 10;     // Truncate to 1 decimal place

  // Calculate individual AQIs using EPA standard breakpoints
  const aqiPm25 = calculateIndividualAqi(truncatedPm25, PM25_BREAKPOINTS);
  const aqiO3 = calculateIndividualAqi(truncatedO3, O3_BREAKPOINTS);
  const aqiCo = calculateIndividualAqi(truncatedCo, CO_BREAKPOINTS);

  // The final AQI is the highest of the individual pollutant AQIs
  return Math.max(aqiPm25, aqiO3, aqiCo);
};


// --- AQI DETAILS CONSTANT & HELPER ---
interface AqiInfoDetails {
  concernLevel: string;
  valueRange: string;
  meaning: string;
  cardClassName: string;
}

const AQI_LEVELS_DETAILS: AqiInfoDetails[] = [
  {
    concernLevel: 'Bueno',
    valueRange: '0 - 50',
    meaning: 'La calidad del aire se considera satisfactoria y la contaminación atmosférica presenta un riesgo escaso o nulo.',
    cardClassName: 'bg-green-500 text-white',
  },
  {
    concernLevel: 'Moderado',
    valueRange: '51 - 100',
    meaning: 'La calidad del aire es aceptable pero para algunos contaminantes podría existir una preocupación moderada para la salud de un grupo muy pequeño de personas excepcionalmente sensibles a la contaminación ambiental.',
    cardClassName: 'bg-yellow-400 text-slate-800',
  },
  {
    concernLevel: 'Insalubre para grupos sensibles',
    valueRange: '101 - 150',
    meaning: 'Los miembros de grupos sensibles pueden padecer efectos en la salud. Probablemente no afectará a las personas en general.',
    cardClassName: 'bg-orange-500 text-white',
  },
  {
    concernLevel: 'Insalubre',
    valueRange: '151 - 200',
    meaning: 'Todos pueden comenzar a padecer efectos en la salud y los miembros de grupos sensibles pueden padecer efectos más graves.',
    cardClassName: 'bg-red-500 text-white',
  },
  {
    concernLevel: 'Muy insalubre',
    valueRange: '201 - 300',
    meaning: 'Advertencias sanitarias de condiciones de emergencia. Son mayores las probabilidades de que toda la población esté afectada.',
    cardClassName: 'bg-purple-500 text-white',
  },
  {
    concernLevel: 'Peligroso',
    valueRange: '301 y superior',
    meaning: 'Alerta sanitaria: todos pueden padecer efectos sanitarios más graves.',
    cardClassName: 'bg-rose-900 text-white',
  }
];

const getAqiInfoDetails = (aqi: number): AqiInfoDetails => {
  if (isNaN(aqi)) aqi = 0;
  if (aqi <= 50) return AQI_LEVELS_DETAILS[0];
  if (aqi <= 100) return AQI_LEVELS_DETAILS[1];
  if (aqi <= 150) return AQI_LEVELS_DETAILS[2];
  if (aqi <= 200) return AQI_LEVELS_DETAILS[3];
  if (aqi <= 300) return AQI_LEVELS_DETAILS[4];
  return AQI_LEVELS_DETAILS[5];
}


// --- DATA HOOK ---
const useRealtimeData = () => {
    const [latestReadings, setLatestReadings] = useState<SensorData | null>(null);
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [alerts, setAlerts] = useState<AlertRecord[]>([]);
    const [history, setHistory] = useState<HistoricalData[]>([]);
    const [loading, setLoading] = useState(true);

    const transformDeviceData = (data: DeviceData): { sensorData: SensorData, weatherData: WeatherData } => {
        const pm25 = data.particulates?.pm25_mgm3 ?? 0;
        // The sensor reports o3 in ppb, but the firebase key is misnamed 'o3_ppm'.
        // The EPA calculation requires ppm, so we convert. 1 ppm = 1000 ppb.
        const o3_ppb = data.gases?.o3_ppm ?? 0;
        const o3_ppm = o3_ppb / 1000;
        const co_ppm = data.gases?.co_ppm ?? 0;
        
        const aqi = calculateOverallAqi(pm25, o3_ppm, co_ppm);
        const tempC = data.environment?.temperature ?? 0;

        const sensorData: SensorData = {
            aqi: aqi,
            co2: data.gases?.air_quality_ppm ?? 0,
            o3: o3_ppb, // The gauge displays ppb
            co: data.gases?.co_ppm ?? 0,
            glp: data.gases?.lpg ?? 0,
            naturalGas: data.gases?.natural_gas ?? 0,
            pm1: data.particulates?.pm1_ugm3 ?? 0,
            pm25: pm25,
            rh: data.environment?.humidity ?? 0,
            timestamp: new Date(data.timestamp).getTime(),
        };

        const weatherData: WeatherData = {
            tempC: tempC,
            aqi: aqi,
            humidity: data.environment?.humidity ?? 0,
            pressure: `${(data.environment?.pressure ?? 0).toFixed(1)} hPa`,
        };
        return { sensorData, weatherData };
    };

    useEffect(() => {
        const alertsRef = db.ref('alerts');
        // FIX: Replaced `any` with `firebase.database.DataSnapshot` for type safety.
        const onAlerts = (snap: firebase.database.DataSnapshot) => {
            const data = snap.val() || {};
            const alertsArray = Object.entries(data).map(([id, value]) => ({ id, ...(value as Omit<AlertRecord, 'id'>) })).sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
            setAlerts(alertsArray);
        };
        alertsRef.on('value', onAlerts);

        let latestTimeRef: firebase.database.Query | null = null;
        let onTimeChangeCallback: ((snapshot: firebase.database.DataSnapshot) => void) | null = null;

        const sensorDataRef = db.ref('sensor_data').orderByKey().limitToLast(1);
        
        const onDateChange = (dateSnap: firebase.database.DataSnapshot) => {
            if (!dateSnap.exists()) {
                setLoading(false);
                return;
            }
            const latestDateKey = Object.keys(dateSnap.val())[0];

            if (latestTimeRef && onTimeChangeCallback) {
                latestTimeRef.off('value', onTimeChangeCallback);
            }

            latestTimeRef = db.ref(`sensor_data/${latestDateKey}`).orderByKey().limitToLast(1);
            
            onTimeChangeCallback = (timeSnap: firebase.database.DataSnapshot) => {
                 if (!timeSnap.exists()) return;
                 const latestTimeKey = Object.keys(timeSnap.val())[0];
                 const rawData: DeviceData = timeSnap.val()[latestTimeKey];
                 
                 if (rawData) {
                     const { sensorData, weatherData } = transformDeviceData(rawData);
                     setLatestReadings(sensorData);
                     setWeather(weatherData);
                     if (loading) setLoading(false);
                 }
            };
            latestTimeRef.on('value', onTimeChangeCallback);

            db.ref(`sensor_data/${latestDateKey}`).limitToLast(72).once('value', (historySnap) => {
                if(!historySnap.exists()) return;
                const historyData = historySnap.val();
                const historyArray = Object.values(historyData as {[key: string]: DeviceData})
                  .map(d => {
                      // The sensor reports o3 in ppb; convert to ppm for AQI calculation.
                      const o3_ppb = d.gases?.o3_ppm ?? 0;
                      const o3_ppm = o3_ppb / 1000;
                      return {
                          timestamp: new Date(d.timestamp).getTime(),
                          aqi: calculateOverallAqi(
                            d.particulates?.pm25_mgm3 ?? 0,
                            o3_ppm,
                            d.gases?.co_ppm ?? 0
                          )
                      };
                  })
                  .sort((a,b) => a.timestamp - b.timestamp);
                setHistory(historyArray);
            });
        };

        sensorDataRef.on('value', onDateChange);

        return () => {
            alertsRef.off('value', onAlerts);
            sensorDataRef.off('value', onDateChange);
            if (latestTimeRef && onTimeChangeCallback) {
               latestTimeRef.off('value', onTimeChangeCallback); 
            }
        };
    }, []);

    return { latestReadings, weather, alerts, history, loading };
};


// --- DASHBOARD PAGE ---
const DashboardPage: React.FC = () => {
  const { latestReadings, weather, history, loading } = useRealtimeData();
  const lastAqiLevel = useRef<string | null>(null);
  const lastPollutantFlags = useRef<{ [key: string]: boolean }>({ pm25: false, o3: false });

  const logAlert = useCallback((alertData: Omit<AlertRecord, 'id' | 'ts'>) => {
    const newAlertRef = db.ref('alerts').push();
    newAlertRef.set({
      ...alertData,
      ts: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    if (!latestReadings) return;
    
    const currentAqi = getAqiLevel(latestReadings.aqi);
    if (lastAqiLevel.current && lastAqiLevel.current !== currentAqi.text) {
      const prevIdx = AQI_LEVELS.indexOf(lastAqiLevel.current);
      const currIdx = AQI_LEVELS.indexOf(currentAqi.text);
      if (currIdx > 1 && prevIdx <= 1) {
        logAlert({ type: 'AQI', level: currentAqi.text, value: latestReadings.aqi, message: `AQI cambió a ${currentAqi.text}`, cls: currentAqi.cls });
      } else if (currIdx <= 1 && prevIdx > 1) {
        logAlert({ type: 'AQI', level: currentAqi.text, value: latestReadings.aqi, message: 'AQI volvió a niveles aceptables', cls: currentAqi.cls });
      }
    }
    lastAqiLevel.current = currentAqi.text;

    Object.entries(POLLUTANT_THRESH).forEach(([key, thresholds]) => {
      const value = latestReadings[key as keyof SensorData] as number;
      if (value >= thresholds.warn) {
        if (!lastPollutantFlags.current[key]) {
          const level = value >= thresholds.bad ? 'Malo' : 'Sensibles';
          logAlert({ type: key.toUpperCase(), level, value, message: `${key.toUpperCase()} elevado (${value} µg/m³)`, cls: level === 'Malo' ? 'bad' : 'warn' });
          lastPollutantFlags.current[key] = true;
        }
      } else if (lastPollutantFlags.current[key]) {
        logAlert({ type: key.toUpperCase(), level: 'Moderado', value, message: `${key.toUpperCase()} volvió a niveles aceptables`, cls: 'mod' });
        lastPollutantFlags.current[key] = false;
      }
    });
  }, [latestReadings, logAlert]);

  if (loading) return <div className="p-8 text-center text-slate-500">Waiting for live sensor data...</div>;
  if (!latestReadings || !weather) return <div className="p-8 text-center text-red-500">Could not load sensor data. Check device connection.</div>;

  const aqiInfo = getAqiLevel(latestReadings.aqi);
  const aqiDetails = getAqiInfoDetails(latestReadings.aqi);

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 flex flex-col justify-between col-span-12 lg:col-span-4">
        <div>
            <h3 className="font-bold text-slate-800">Índice AQI (Calculado)</h3>
            <div className="text-6xl font-extrabold bg-gradient-to-r from-orange-400 to-red-500 text-transparent bg-clip-text">{latestReadings.aqi}</div>
        </div>
        <div className={`text-sm font-bold px-3 py-1 rounded-full self-start ${aqiInfo.className}`}>{aqiInfo.text}</div>
      </div>

      <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 col-span-12 lg:col-span-8">
        <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
            <div className="text-5xl">⛅</div>
            <div className="flex-grow">
                <div className="text-4xl font-bold text-slate-800">{weather.tempC.toFixed(1)}°C</div>
            </div>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center my-2 text-sm">
            <div>AQI:</div>
            <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500" style={{ width: `${clamp(weather.aqi, 0, 300) / 3}%`}}></div>
            </div>
            <div className="font-bold">{weather.aqi}</div>
        </div>
        <ul className="text-xs text-slate-600 space-y-1 mt-2">
            <li>Humedad: <strong className="text-slate-800">{weather.humidity.toFixed(2)}%</strong></li>
            <li>Presión: <strong className="text-slate-800">{weather.pressure}</strong></li>
        </ul>
      </div>

      <Gauge value={latestReadings.co2} max={2000} label="Calidad del aire" unit="ppm" />
      <Gauge value={latestReadings.o3} max={500} label="Ozono (O₃)" unit="ppb" />
      <Gauge value={latestReadings.co} max={150} label="Monóxido (CO)" unit="ppm" />
      <Gauge value={latestReadings.pm25} max={100} label="PM₂.₅" unit="µg/m³" />

      <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 col-span-12">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <div className="flex justify-between items-baseline mb-2">
                <h3 className="font-bold text-slate-800">Calidad del Aire – AQI (Últimas lecturas)</h3>
                <small className="text-slate-500">AQI (0–500)</small>
            </div>
            <AqiChart data={history} />
          </div>
          <div className="flex flex-col justify-center">
             <h3 className="font-bold text-slate-800 mb-2">Conceptos básicos de AQI</h3>
             <div className={`p-4 rounded-lg shadow-inner ${aqiDetails.cardClassName}`}>
                <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-lg">{aqiDetails.concernLevel}</span>
                    <span className="font-mono text-sm opacity-90">AQI: {aqiDetails.valueRange}</span>
                </div>
                <p className="text-sm opacity-95">
                    {aqiDetails.meaning}
                </p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- ALERTS PAGE ---
const AlertsPage = () => {
    const { alerts, loading } = useRealtimeData();

    const exportToCsv = () => {
        if (!alerts.length) return alert('No alerts to export.');
        const headers = ['Timestamp', 'Type', 'Level', 'Value', 'Message'];
        const csvRows = [
            headers.join(','),
            ...alerts.map(a => [
                `"${new Date(a.ts).toLocaleString()}"`, 
                `"${a.type}"`, 
                `"${a.level}"`, 
                a.value,
                `"${a.message}"`
            ].join(','))
        ];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'air_quality_alerts.csv'; a.click();
        URL.revokeObjectURL(url);
    };

    const clearAlerts = async () => {
        if (window.confirm('Are you sure you want to delete ALL alerts? This cannot be undone.')) {
            try {
                await db.ref('alerts').remove();
                alert('Alerts cleared successfully.');
            } catch (error) {
                console.error("Error clearing alerts: ", error);
                alert('Failed to clear alerts.');
            }
        }
    };

    const pillClasses: { [key: string]: string } = {
      good: 'bg-green-100 text-green-800 border-green-200',
      mod: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      warn: 'bg-orange-100 text-orange-800 border-orange-200',
      bad: 'bg-red-100 text-red-800 border-red-200',
    };

    return (
        <>
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-4">
                <h3 className="text-xl font-bold text-slate-800">Alerts Log</h3>
                <div className="flex flex-col sm:flex-row gap-2">
                    <button onClick={exportToCsv} className="px-4 py-2 bg-white border border-slate-300 rounded-lg font-semibold text-sm text-slate-700 hover:bg-slate-50 transition">Export CSV</button>
                    <button onClick={clearAlerts} className="px-4 py-2 bg-red-500 text-white rounded-lg font-semibold text-sm hover:bg-red-600 transition">Clear Log</button>
                </div>
            </div>
            <div className="bg-white border border-slate-200 shadow-lg rounded-2xl">
              {/* Mobile Card View */}
              <div className="md:hidden">
                {loading ? (
                    <div className="text-center p-8 text-slate-500">Loading alerts...</div>
                ) : alerts.length === 0 ? (
                    <div className="text-center p-8 text-slate-500">No alerts recorded yet.</div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {alerts.map(alert => (
                      <div key={alert.id} className="p-4">
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <span className="font-semibold text-slate-800">{alert.message}</span>
                          <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold border ${pillClasses[alert.cls] || 'bg-slate-100 text-slate-800 border-slate-200'}`}>{alert.level}</span>
                        </div>
                        <div className="text-xs text-slate-500 flex justify-between items-center">
                          <span>{new Date(alert.ts).toLocaleString()}</span>
                          <span className="font-mono">{alert.type}: <strong>{alert.value}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Desktop Table View */}
              <div className="overflow-x-auto hidden md:block">
                  <table className="w-full text-sm text-left text-slate-500">
                      <thead className="text-xs text-slate-700 uppercase bg-slate-50">
                          <tr>
                              <th scope="col" className="px-6 py-3">Date & Time</th>
                              <th scope="col" className="px-6 py-3">Type</th>
                              <th scope="col" className="px-6 py-3">Level</th>
                              <th scope="col" className="px-6 py-3">Value</th>
                              <th scope="col" className="px-6 py-3">Message</th>
                          </tr>
                      </thead>
                      <tbody>
                          {loading ? (
                              <tr><td colSpan={5} className="text-center p-8">Loading alerts...</td></tr>
                          ) : alerts.length === 0 ? (
                              <tr><td colSpan={5} className="text-center p-8">No alerts recorded yet.</td></tr>
                          ) : (
                              alerts.map(alert => (
                                  <tr key={alert.id} className="bg-white border-b hover:bg-slate-50">
                                      <td className="px-6 py-4 font-medium text-slate-900 whitespace-nowrap">{new Date(alert.ts).toLocaleString()}</td>
                                      <td className="px-6 py-4">{alert.type}</td>
                                      <td className="px-6 py-4"><span className={`px-2 py-0.5 rounded-full font-semibold border ${pillClasses[alert.cls] || 'bg-slate-100 text-slate-800 border-slate-200'}`}>{alert.level}</span></td>
                                      <td className="px-6 py-4">{alert.value}</td>
                                      <td className="px-6 py-4">{alert.message}</td>
                                  </tr>
                              ))
                          )}
                      </tbody>
                  </table>
              </div>
            </div>
        </>
    );
};


// --- SENSORS PAGE ---
const SensorCard: React.FC<{ name: string, description: string}> = ({ name, description}) => (
    <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 col-span-12">
        <div>
            <h3 className="text-xl font-bold text-slate-800 mb-1">{name}</h3>
            <p className="text-slate-600">{description}</p>
        </div>
    </div>
);

const SENSORS_LIST = [
    { name: 'MQ-7 (Sensor de Monóxido de Carbono)', description: 'El MQ-7 es un sensor semiconductor diseñado para detectar monóxido de carbono (CO). Utiliza óxido de estaño (SnO2) en un tubo calentado que modifica su resistencia eléctrica en presencia de CO, haciéndolo ideal para detección rápida y económica de este gas peligroso, inodoro y tóxico. El sensor tiene una salida analógica proporcional a la concentración de CO y una salida digital mediante comparador para niveles umbral. Es ampliamente usado en aplicaciones domésticas y industriales para seguridad ambiental.' },
    { name: 'MQ-131 (Sensor de Ozono O3)', description: 'El MQ-131 detecta ozono (O3) en rangos típicos de 10 a 1000 ppm. Es un sensor basado en óxido de estaño que modula su resistencia conforme varían concentraciones de ozono, con alta sensibilidad en entornos industriales y urbanos. Su uso incluye monitoreo ambiental para calidad del aire, ayudando a detectar contaminantes oxidantes peligrosos.' },
    { name: 'MQ-135 (Sensor de Calidad del Aire)', description: 'El MQ-135 es un sensor polivalente para detectar gases nocivos y contaminantes en aire como NH3, NOx, alcohol, benceno, y humo. También se usa para medir calidad del aire en interiores y exteriores. Opera mediante variaciones en resistencia de un semiconductor de óxido de estaño según la concentración de gases. Utilizado en sistemas de monitoreo ambiental para advertencias tempranas.' },
    { name: 'BME280 (Sensor Ambiental Digital)', description: 'El BME280 es un sensor ambiental digital que mide humedad relativa, presión barométrica y temperatura con alta precisión. Basado en tecnología MEMS y con interfaces I2C y SPI, es compacto y consume poca energía, ideal para dispositivos portátiles, domótica, estaciones climáticas y sistemas IoT. Ofrece modos de operación configurables para balancear precisión y consumo.' },
    { name: 'DSM501A (Sensor de Polvo/Partículas)', description: 'DSM501A es un sensor óptico para detectar partículas de polvo y calidad del aire. Utiliza un LED infrarrojo y un fotodiodo para medir la concentración de polvo en suspensión mediante dispersión de luz. Proporciona una salida digital proporcional a la densidad de partículas, útil en sistemas de monitoreo de contaminación ambiental y sistemas HVAC.' },
];

const SensorsPage = () => (
    <div className="grid grid-cols-12 gap-4">
        <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 col-span-12">
            <p className="text-slate-600">El sistema de monitoreo de calidad del aire en la parroquia Patricia Pilar integra sensores de gases, material particulado y variables ambientales. La combinación de estos dispositivos permite generar indicadores como el AQI y brindar soporte a decisiones de salud y ambiente.</p>
        </div>
        {SENSORS_LIST.map(sensor => <SensorCard key={sensor.name} name={sensor.name} description={sensor.description} />)}
    </div>
);

// --- HISTORY PAGE ---
const VARIABLE_OPTIONS = [
  { key: 'co', path: 'gases.co_ppm', label: 'Monóxido (CO)', unit: 'ppm' },
  { key: 'o3', path: 'gases.o3_ppm', label: 'Ozono (O₃)', unit: 'ppb' },
  { key: 'pm25', path: 'particulates.pm25_mgm3', label: 'PM₂.₅', unit: 'µg/m³' },
  { key: 'co2', path: 'gases.air_quality_ppm', label: 'Calidad del aire (NH3/CO2)', unit: 'ppm' },
  { key: 'temperature', path: 'environment.temperature', label: 'Temperatura', unit: '°C' },
  { key: 'humidity', path: 'environment.humidity', label: 'Humedad', unit: '%' },
  { key: 'pressure', path: 'environment.pressure', label: 'Presión', unit: 'hPa' },
];

// Helper to get nested property value
const getNestedValue = (obj: any, path: string): number | undefined => {
    const value = path.split('.').reduce((acc, part) => acc && acc[part], obj);
    return typeof value === 'number' ? value : undefined;
};

const HistoryChart: React.FC<{data: any[], variable: {label: string, unit: string}}> = ({ data, variable }) => {
    if (!data || data.length === 0) return null;

    const tickInterval = Math.ceil(data.length / 24);

    return (
        <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
                <defs>
                    <linearGradient id="historyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    axisLine={{ stroke: '#cbd5e1' }} 
                    tickLine={{ stroke: '#cbd5e1' }}
                    interval={tickInterval > 0 ? tickInterval -1 : 0}
                />
                <YAxis 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    axisLine={{ stroke: '#cbd5e1' }} 
                    tickLine={{ stroke: '#cbd5e1' }}
                    label={{ value: variable.unit, angle: -90, position: 'insideLeft', offset: -5, fill: '#64748b', fontSize: 12 }}
                />
                <Tooltip
                    contentStyle={{
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                    }}
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
                    formatter={(value: number) => [`${value.toFixed(2)} ${variable.unit}`, null]}
                />
                <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: '20px' }} />
                <Area 
                    type="monotone" 
                    dataKey="value" 
                    name={variable.label}
                    stroke="#2563eb" 
                    fillOpacity={1} 
                    fill="url(#historyGradient)" 
                    strokeWidth={2}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
};

const HistoryPage = () => {
    const [selectedVariable, setSelectedVariable] = useState(VARIABLE_OPTIONS[0].key);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [chartData, setChartData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('Seleccione una variable y fecha para generar un gráfico.');

    const handleGenerateChart = async () => {
        setLoading(true);
        setMessage('');
        setChartData([]);

        try {
            const snapshot = await db.ref(`sensor_data/${selectedDate}`).once('value');
            if (snapshot.exists()) {
                const data = snapshot.val();
                const variableInfo = VARIABLE_OPTIONS.find(v => v.key === selectedVariable)!;

                const processedData = Object.entries(data as Record<string, DeviceData>)
                    .map(([time, record]) => {
                        const fullTimestamp = `${selectedDate}T${time.replace(/-/g, ':')}`;
                        return {
                            time: time.substring(0, 5), // 'HH-MM' for chart label
                            fullTimestamp, // full timestamp for CSV
                            value: getNestedValue(record, variableInfo.path)
                        };
                    })
                    .filter(item => item.value !== undefined && !isNaN(item.value))
                    .sort((a, b) => a.time.localeCompare(b.time));

                if (processedData.length > 0) {
                    setChartData(processedData);
                } else {
                    setMessage(`No hay datos para la variable '${variableInfo.label}' en la fecha seleccionada.`);
                }
            } else {
                setMessage('No se encontraron datos para la fecha seleccionada.');
            }
        } catch (error) {
            console.error("Error fetching historical data:", error);
            setMessage('Ocurrió un error al cargar los datos.');
        } finally {
            setLoading(false);
        }
    };
    
    const exportHistoryToCsv = () => {
        if (!chartData.length) {
            alert('No hay datos para exportar. Por favor, genere un gráfico primero.');
            return;
        }

        const variableInfo = VARIABLE_OPTIONS.find(v => v.key === selectedVariable)!;
        const fileName = `historico_${selectedDate}_${variableInfo.key}.csv`;

        const headers = ['Timestamp', variableInfo.label];
        const csvRows = [
            headers.join(','),
            ...chartData.map(d => [
                `"${new Date(d.fullTimestamp).toLocaleString()}"`, 
                d.value
            ].join(','))
        ];
        
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    const currentVariableInfo = VARIABLE_OPTIONS.find(v => v.key === selectedVariable)!;

    return (
         <>
            <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 mb-4">
                <div className="flex flex-col sm:flex-row flex-wrap items-end gap-4">
                    <div className="flex-grow w-full sm:w-auto min-w-[200px]">
                        <label htmlFor="variable-select" className="block text-sm font-medium text-slate-700 mb-1">Variable</label>
                        <select 
                            id="variable-select" 
                            value={selectedVariable}
                            onChange={(e) => setSelectedVariable(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-800 text-white border border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-brand"
                        >
                            {VARIABLE_OPTIONS.map(option => (
                                <option key={option.key} value={option.key} className="bg-slate-800 text-white">{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex-grow w-full sm:w-auto min-w-[150px]">
                        <label htmlFor="date-picker" className="block text-sm font-medium text-slate-700 mb-1">Fecha</label>
                        <input 
                            type="date" 
                            id="date-picker"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-800 text-white border border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-brand"
                            style={{ colorScheme: 'dark' }}
                        />
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                        <button
                            onClick={handleGenerateChart}
                            disabled={loading}
                            className="px-6 py-2 bg-brand text-white font-semibold rounded-md shadow-sm hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand disabled:bg-slate-400 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Generando...' : 'Generar Gráfico'}
                        </button>
                        <button
                            onClick={exportHistoryToCsv}
                            disabled={loading || chartData.length === 0}
                            className="px-4 py-2 bg-white border border-slate-300 rounded-md font-semibold text-sm text-slate-700 hover:bg-slate-50 transition disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                            Exportar CSV
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 min-h-[468px] flex items-center justify-center">
                {loading ? (
                    <p className="text-slate-500">Cargando datos del gráfico...</p>
                ) : chartData.length > 0 ? (
                    <HistoryChart data={chartData} variable={{label: currentVariableInfo.label, unit: currentVariableInfo.unit}} />
                ) : (
                    <p className="text-slate-500">{message}</p>
                )}
            </div>
        </>
    )
};


// --- LAYOUT & APP ---
interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}
const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen }) => {
  const navLinkClass = "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white";
  const activeNavLinkClass = "bg-brand-dark text-white";

  const closeSidebar = () => setIsOpen(false);
  
  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/50 z-10 lg:hidden transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closeSidebar}
        aria-hidden="true"
      ></div>
      <aside className={`fixed top-0 left-0 bottom-0 w-64 bg-slate-800 text-white p-4 flex-flex-col z-20 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between p-2 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center bg-gradient-to-br from-brand to-cyan-400 text-white font-bold text-lg">
              PP
            </div>
            <span className="font-bold text-lg">Aire Patricia Pilar</span>
          </div>
          <button onClick={closeSidebar} className="lg:hidden p-1 text-slate-400 hover:text-white">
            <CloseIcon />
          </button>
        </div>
        <nav className="flex flex-col gap-1">
          <ReactRouterDOM.NavLink to="/" end onClick={closeSidebar} className={({isActive}) => isActive ? `${navLinkClass} ${activeNavLinkClass}`: navLinkClass}><DashboardIcon /><span>Monitoreo</span></ReactRouterDOM.NavLink>
          <ReactRouterDOM.NavLink to="/sensors" onClick={closeSidebar} className={({isActive}) => isActive ? `${navLinkClass} ${activeNavLinkClass}`: navLinkClass}><SensorIcon /><span>Sensores</span></ReactRouterDOM.NavLink>
          <ReactRouterDOM.NavLink to="/alerts" onClick={closeSidebar} className={({isActive}) => isActive ? `${navLinkClass} ${activeNavLinkClass}`: navLinkClass}><AlertIcon /><span>Alertas</span></ReactRouterDOM.NavLink>
          <ReactRouterDOM.NavLink to="/history" onClick={closeSidebar} className={({isActive}) => isActive ? `${navLinkClass} ${activeNavLinkClass}`: navLinkClass}><HistoryIcon /><span>Histórico</span></ReactRouterDOM.NavLink>
        </nav>
        <div className="mt-auto p-3 flex items-center gap-3 bg-slate-900/50 rounded-lg">
            <img src="https://picsum.photos/seed/user/40/40" alt="User" className="w-10 h-10 rounded-full" />
            <div>
                <div className="font-semibold text-white">Alexander Maigua</div>
                <div className="text-xs text-slate-400">Admin</div>
            </div>
        </div>
      </aside>
    </>
  );
};

interface HeaderProps {
    title: string;
    onMenuClick: () => void;
}
const Header: React.FC<HeaderProps> = ({ title, onMenuClick }) => {
    return (
        <header className="sticky top-0 bg-slate-100/80 backdrop-blur-md z-5 p-4 border-b border-slate-200 flex items-center h-16">
            <button onClick={onMenuClick} className="lg:hidden mr-4 text-slate-600 hover:text-slate-900" aria-label="Open menu">
                <MenuIcon />
            </button>
            <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        </header>
    );
};

const Layout: React.FC<PropsWithChildren> = ({ children }) => {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = ReactRouterDOM.useLocation();

    useEffect(() => {
        setSidebarOpen(false);
    }, [location.pathname]);

    const getPageTitle = (pathname: string) => {
        switch (pathname) {
            case '/': return 'Monitoring Dashboard';
            case '/sensors': return 'Informacion de Sensores';
            case '/alerts': return 'Registro de Alertas';
            case '/history': return 'Histórico de Datos';
            default: return 'Air Quality';
        }
    };
    
    return (
        <div className="flex">
            <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
            <div className="flex-1 lg:ml-64 w-full min-h-screen bg-slate-100">
                <Header title={getPageTitle(location.pathname)} onMenuClick={() => setSidebarOpen(true)} />
                <main className="p-4">{children}</main>
            </div>
        </div>
    );
};

function App() {
  const [showNotificationBanner, setShowNotificationBanner] = useState(false);

  useEffect(() => {
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        setShowNotificationBanner(true);
      }
    }
  }, []);

  const handleAllowNotifications = () => {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        console.log('Notification permission granted.');
      }
      setShowNotificationBanner(false);
    });
  };

  const handleBlockNotifications = () => {
    setShowNotificationBanner(false);
  };

  return (
    <ReactRouterDOM.HashRouter>
      <Layout>
        <ReactRouterDOM.Routes>
          <ReactRouterDOM.Route path="/" element={<DashboardPage />} />
          <ReactRouterDOM.Route path="/sensors" element={<SensorsPage />} />
          <ReactRouterDOM.Route path="/alerts" element={<AlertsPage />} />
          <ReactRouterDOM.Route path="/history" element={<HistoryPage />} />
        </ReactRouterDOM.Routes>
      </Layout>
      {showNotificationBanner && (
        <NotificationBanner
          onAllow={handleAllowNotifications}
          onBlock={handleBlockNotifications}
        />
      )}
    </ReactRouterDOM.HashRouter>
  );
}

export default App;