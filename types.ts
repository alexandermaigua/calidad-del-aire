
export interface SensorData {
  aqi: number;
  co2: number;
  o3: number;
  co: number;
  glp: number;
  naturalGas: number;
  pm1: number;
  pm25: number;
  rh: number;
  timestamp: number;
}

export interface WeatherData {
  tempC: number;
  aqi: number;
  humidity: number;
  pressure: string;
}

export interface AlertRecord {
  id: string;
  ts: string;
  type: string;
  level: string;
  value: number;
  message: string;
  cls: string;
}

export interface AqiLevel {
  text: string;
  cls: 'good' | 'mod' | 'warn' | 'bad';
  className: string;
}

export interface HistoricalData {
  timestamp: number;
  aqi: number;
}


// New types matching the ESP32's data structure
export interface DeviceData {
  timestamp: string;
  device_id: string;
  firmware_version: string;
  uptime_ms: number;
  location: {
    lat: number;
    lng: number;
  };
  environment: {
    temperature: number;
    humidity: number;
    pressure: number;
    bme280_status: string;
  };
  system: {
    wifi_connected: boolean;
    free_heap: number;
    wifi_rssi: number;
  };
  gases: {
    glp: number;
    glp_raw: number;
    glp_status: string;
    natural_gas: number;
    natural_gas_raw: number;
    natural_gas_status: string;
    co_ppm: number;
    co_raw: number;
    co_status: string;
    air_quality_ppm: number; // This will map to our CO2 gauge
    nh3_co2_raw: number;
    nh3_co2_status: string;
    o3_ppm: number;
    o3_raw: number;
    o3_status: string;
  };
  particulates: {
    pm1_ugm3: number;
    pm25_mgm3: number;
    pm1_ratio: number;
    pm25_ratio: number;
    status: string;
    pm25_quality: string;
  };
}