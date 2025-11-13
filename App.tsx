




import React, { useState, useEffect, useCallback, useRef, createContext, useContext, PropsWithChildren } from 'react';
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
import { DashboardIcon, SensorIcon, AlertIcon, HistoryIcon } from './components/Icons';
import { NotificationBanner } from './components/NotificationBanner';
import { Gauge } from './components/Gauge';
import { AqiChart } from './components/AqiChart';

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
            glp: data.gases?.lpg_ppm ?? 0,
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


const Sidebar: React.FC<{ isOpen: boolean; toggle: () => void }> = ({ isOpen, toggle }) => {
  const navLinkClass = "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white";
  const activeNavLinkClass = "bg-brand-dark text-white";
  
  return (
    <aside className={`fixed top-0 left-0 bottom-0 bg-slate-800 text-white p-4 flex flex-col z-20 transition-all duration-300 ${isOpen ? 'w-56 md:w-64' : 'w-0 p-0 overflow-hidden'}`}>
      <div className={`flex items-center gap-3 p-2 mb-4 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-gradient-to-br from-brand to-cyan-400 text-white font-bold text-lg">
          PP
        </div>
        <span className="font-bold text-lg">Aire Patricia Pilar</span>
      </div>
      <nav className={`flex flex-col gap-1 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
        <ReactRouterDOM.NavLink to="/" end className={({isActive}) => isActive ? `${navLinkClass} ${activeNavLinkClass}`: navLinkClass}><DashboardIcon /><span>Monitoreo</span></ReactRouterDOM.NavLink>
        <ReactRouterDOM.NavLink to="/sensors" className={({isActive}) => isActive ? `${navLinkClass} ${activeNavLinkClass}`: navLinkClass}><SensorIcon /><span>Sensores</span></ReactRouterDOM.NavLink>
        <ReactRouterDOM.NavLink to="/alerts" className={({isActive}) => isActive ? `${navLinkClass} ${activeNavLinkClass}`: navLinkClass}><AlertIcon /><span>Alertas</span></ReactRouterDOM.NavLink>
        <ReactRouterDOM.NavLink to="/history" className={({isActive}) => isActive ? `${navLinkClass} ${activeNavLinkClass}`: navLinkClass}><HistoryIcon /><span>Histórico</span></ReactRouterDOM.NavLink>
      </nav>
      <div className={`mt-auto p-3 flex items-center gap-3 bg-slate-900/50 rounded-lg transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
          <img src="https://picsum.photos/seed/user/40/40" alt="User" className="w-10 h-10 rounded-full" />
          <div>
              <div className="font-semibold text-white">Alexander Maigua</div>
              <div className="text-xs text-slate-400">Admin</div>
          </div>
      </div>
    </aside>
  );
};

const Layout: React.FC<PropsWithChildren> = ({ children }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);

  const toggleSidebar = () => {
    setSidebarOpen(!isSidebarOpen);
  };

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setSidebarOpen(true);
      } else {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex">
      <Sidebar isOpen={isSidebarOpen} toggle={toggleSidebar} />
      <div className={`min-h-screen bg-slate-100 transition-all duration-300 ${isSidebarOpen ? 'ml-56 md:ml-64' : 'ml-0 w-full'}`}>
        <header className="md:hidden p-4 bg-slate-800 text-white flex justify-between items-center fixed top-0 left-0 w-full z-10">
          <button onClick={toggleSidebar}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold">Monitoring Dashboard</h1>
        </header>
        <div className="md:pt-0 pt-16">
          {children}
        </div>
      </div>
    </div>
  );
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

    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('Alerta de Calidad del Aire', {
        body: alertData.message,
        icon: '/imagenes/logo.png',
      });
    }
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
    <>
      <header className="p-6 hidden md:block">
        <h2 className="text-2xl font-bold text-slate-800">Panel de Monitoreo</h2>
      </header>
      <main className="px-4 pb-6 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 flex flex-col justify-between col-span-1">
            <div>
                <h3 className="font-bold text-slate-800">Índice AQI (Calculado)</h3>
                <div className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-orange-400 to-red-500 text-transparent bg-clip-text">{latestReadings.aqi}</div>
            </div>
            <div className={`text-sm font-bold px-3 py-1 rounded-full self-start ${aqiInfo.className}`}>{aqiInfo.text}</div>
          </div>

          <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 col-span-full flex flex-col md:flex-row items-center gap-6">
            <div className="flex items-center gap-4">
                <div className="text-4xl">⛅</div>
                <div className="text-3xl sm:text-4xl font-bold text-slate-800">{weather.tempC.toFixed(1)}°C</div>
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

          <Gauge value={latestReadings.glp} max={2000} label="Gas Licuado de Petróleo (GLP)" unit="ppm" />
          <Gauge value={latestReadings.o3} max={500} label="Ozono (O₃)" unit="ppb" />
          <Gauge value={latestReadings.co} max={150} label="Monóxido (CO)" unit="ppm" />
          <Gauge value={latestReadings.pm25} max={100} label="PM₂.₅" unit="µg/m³" />

          <div className="bg-white border border-slate-200 shadow-lg rounded-2xl p-4 col-span-1 md:col-span-2 lg:col-span-4">
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
      </main>
    </>
  );
};

// FIX: Refactored App to use react-router-dom v6/v7 components like Routes and the `element` prop on Route.
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