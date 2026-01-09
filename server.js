// Ecowitt Vineyard Environmental Monitoring API
// Optimized for GW1200B Gateway with WH51L and WN35 sensors
// Deploy to Render.com
// v7

const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for now
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Ecowitt sends form data

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// In-memory data storage
const sensorData = [];
const MAX_READINGS = 10000;

// Store last received raw data for debugging
let lastRawData = null;

// Parse Ecowitt/Wunderground data format
function parseEcowittData(data) {
  const parsed = {
    timestamp: new Date().toISOString(),
    raw: data
  };

  // Temperature - try multiple field names
  // Ecowitt sends temp in Fahrenheit, convert to Celsius
  if (data.tempf) {
    parsed.temperature = ((parseFloat(data.tempf) - 32) * 5/9);
  } else if (data.temp1f) {
    parsed.temperature = ((parseFloat(data.temp1f) - 32) * 5/9);
  } else if (data.tempinf) {
    parsed.temperature = ((parseFloat(data.tempinf) - 32) * 5/9);
  } else if (data.temp) {
    // Some send in Celsius directly
    parsed.temperature = parseFloat(data.temp);
  }

  // Humidity
  if (data.humidity) {
    parsed.humidity = parseFloat(data.humidity);
  } else if (data.humidity1) {
    parsed.humidity = parseFloat(data.humidity1);
  } else if (data.humidityin) {
    parsed.humidity = parseFloat(data.humidityin);
  }

  // Soil Moisture Sensors - try multiple field names
  parsed.soilMoisture1 = data.soilmoisture1 ? parseFloat(data.soilmoisture1) : 
                          data.soilhum1 ? parseFloat(data.soilhum1) : null;
  parsed.soilMoisture2 = data.soilmoisture2 ? parseFloat(data.soilmoisture2) : 
                          data.soilhum2 ? parseFloat(data.soilhum2) : null;

  // Leaf Wetness - try multiple field names
  parsed.leafWetness = data.leafwetness_ch1 ? parseFloat(data.leafwetness_ch1) : 
                       data.leafwetness1 ? parseFloat(data.leafwetness1) :
                       data.leafwet_ch1 ? parseFloat(data.leafwet_ch1) : null;

  // Additional useful fields
  parsed.stationtype = data.stationtype || 'Unknown';
  parsed.passkey = data.PASSKEY || data.passkey || data.ID || 'Unknown';
  parsed.dateutc = data.dateutc;

  return parsed;
}

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'Ecowitt Vineyard Monitoring API',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    totalReadings: sensorData.length,
    lastUpdate: sensorData.length > 0 ? sensorData[sensorData.length - 1].timestamp : null,
    endpoints: {
      health: 'GET /',
      ecowittWebhook: 'POST /api/ecowitt',
      latestData: 'GET /api/data/latest',
      history: 'GET /api/data/history',
      stats: 'GET /api/data/stats',
      debug: 'GET /api/debug'
    }
  });
});

// Catch-all for debugging - put this BEFORE other routes
app.all('*', (req, res, next) => {
  if (!req.path.includes('/api/') && 
      !req.path.includes('/weatherstation/') && 
      req.path !== '/' &&
      !req.path.includes('favicon')) {
    console.log('🔍 UNKNOWN PATH HIT:', req.method, req.path);
    console.log('Query:', JSON.stringify(req.query));
    console.log('Body:', JSON.stringify(req.body));
  }
  next();
});

// Test endpoint - captures everything
app.all('/weatherstation/updateweatherstation.php', (req, res) => {
  console.log('📡 Wunderground endpoint hit!');
  console.log('Method:', req.method);
  console.log('Query:', JSON.stringify(req.query));
  console.log('Body:', JSON.stringify(req.body));
  
  lastRawData = {
    timestamp: new Date().toISOString(),
    data: req.method === 'GET' ? req.query : req.body
  };
  
  const parsed = parseEcowittData(req.method === 'GET' ? req.query : req.body);
  
  if (parsed.temperature !== undefined || 
      parsed.soilMoisture1 !== null || 
      parsed.soilMoisture2 !== null || 
      parsed.leafWetness !== null) {
    
    sensorData.push(parsed);
    
    if (sensorData.length > MAX_READINGS) {
      sensorData.shift();
    }
    
    console.log('✅ Stored reading from Wunderground endpoint');
  }
  
  res.status(200).send('success');
});

// Ecowitt Gateway webhook endpoint (supports both Ecowitt and Wunderground protocols)
app.post('/api/ecowitt', (req, res) => {
  try {
    console.log('Received data:', JSON.stringify(req.body));
    
    lastRawData = {
      timestamp: new Date().toISOString(),
      data: req.body
    };

    const parsed = parseEcowittData(req.body);
    
    // Only store if we have actual sensor data
    if (parsed.temperature !== undefined || 
        parsed.soilMoisture1 !== null || 
        parsed.soilMoisture2 !== null || 
        parsed.leafWetness !== null) {
      
      sensorData.push(parsed);
      
      // Maintain data limit
      if (sensorData.length > MAX_READINGS) {
        sensorData.shift();
      }
      
      console.log('✅ Stored reading:', {
        temp: parsed.temperature,
        soil1: parsed.soilMoisture1,
        soil2: parsed.soilMoisture2,
        leafWetness: parsed.leafWetness
      });
    } else {
      console.log('⚠️ Received data but no sensor values found');
    }
    
    // Return success response (works for both Ecowitt and Wunderground)
    res.status(200).send('success');
  } catch (error) {
    console.error('❌ Error processing data:', error);
    res.status(500).send('error');
  }
});

// Also accept GET requests (some gateways send data via GET)
app.get('/api/ecowitt', (req, res) => {
  try {
    console.log('Received GET data:', JSON.stringify(req.query));
    
    lastRawData = {
      timestamp: new Date().toISOString(),
      data: req.query
    };

    const parsed = parseEcowittData(req.query);
    
    if (parsed.temperature !== undefined || 
        parsed.soilMoisture1 !== null || 
        parsed.soilMoisture2 !== null || 
        parsed.leafWetness !== null) {
      
      sensorData.push(parsed);
      
      if (sensorData.length > MAX_READINGS) {
        sensorData.shift();
      }
      
      console.log('✅ Stored reading from GET:', {
        temp: parsed.temperature,
        soil1: parsed.soilMoisture1,
        soil2: parsed.soilMoisture2,
        leafWetness: parsed.leafWetness
      });
    }
    
    res.status(200).send('success');
  } catch (error) {
    console.error('❌ Error processing GET data:', error);
    res.status(500).send('error');
  }
});

// Get latest reading
app.get('/api/data/latest', (req, res) => {
  if (sensorData.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'No data available yet. Waiting for first sensor reading.'
    });
  }

  const latest = sensorData[sensorData.length - 1];
  
  res.json({
    success: true,
    reading: latest
  });
});

// Get historical data
app.get('/api/data/history', (req, res) => {
  const { limit = 100, hours } = req.query;
  
  let filtered = [...sensorData];
  
  // Filter by time if hours specified
  if (hours) {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    filtered = filtered.filter(r => new Date(r.timestamp) >= cutoffTime);
  }
  
  // Apply limit (most recent)
  const limitNum = parseInt(limit);
  filtered = filtered.slice(-limitNum);
  
  res.json({
    success: true,
    count: filtered.length,
    readings: filtered
  });
});

// Get statistics
app.get('/api/data/stats', (req, res) => {
  const { hours = 24 } = req.query;
  
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  const filtered = sensorData.filter(r => new Date(r.timestamp) >= cutoffTime);
  
  if (filtered.length === 0) {
    return res.json({
      success: true,
      message: 'No data available for this period',
      stats: null
    });
  }

  const stats = {
    temperature: calculateStats(filtered.map(r => r.temperature).filter(v => v !== undefined)),
    soilMoisture1: calculateStats(filtered.map(r => r.soilMoisture1).filter(v => v !== null)),
    soilMoisture2: calculateStats(filtered.map(r => r.soilMoisture2).filter(v => v !== null)),
    leafWetness: calculateStats(filtered.map(r => r.leafWetness).filter(v => v !== null)),
    count: filtered.length,
    timeRange: {
      start: filtered[0].timestamp,
      end: filtered[filtered.length - 1].timestamp
    }
  };
  
  res.json({ success: true, stats });
});

// Get alerts based on ideal vineyard conditions
app.get('/api/alerts', (req, res) => {
  if (sensorData.length === 0) {
    return res.json({
      success: true,
      alertCount: 0,
      alerts: [],
      message: 'No data available yet'
    });
  }

  const latest = sensorData[sensorData.length - 1];
  const alerts = [];
  
  // Ideal ranges for wine grapes
  const ranges = {
    temperature: { min: 18, max: 25, critical: { min: 10, max: 35 } },
    soilMoisture: { min: 30, max: 60, critical: { min: 20, max: 80 } },
    leafWetness: { max: 70, critical: { max: 85 } } // High leaf wetness = disease risk
  };
  
  // Check temperature
  if (latest.temperature !== undefined) {
    const temp = latest.temperature;
    if (temp < ranges.temperature.critical.min || temp > ranges.temperature.critical.max) {
      alerts.push({
        metric: 'temperature',
        value: temp,
        severity: 'critical',
        message: `Temperature critically ${temp < ranges.temperature.critical.min ? 'low' : 'high'} at ${temp.toFixed(1)}°C`
      });
    } else if (temp < ranges.temperature.min || temp > ranges.temperature.max) {
      alerts.push({
        metric: 'temperature',
        value: temp,
        severity: 'warning',
        message: `Temperature outside ideal range at ${temp.toFixed(1)}°C`
      });
    }
  }
  
  // Check soil moisture sensors
  [1, 2].forEach(num => {
    const moisture = latest[`soilMoisture${num}`];
    if (moisture !== null && moisture !== undefined) {
      if (moisture < ranges.soilMoisture.critical.min || moisture > ranges.soilMoisture.critical.max) {
        alerts.push({
          metric: `soilMoisture${num}`,
          value: moisture,
          severity: 'critical',
          message: `Soil sensor ${num} critically ${moisture < ranges.soilMoisture.critical.min ? 'dry' : 'wet'} at ${moisture.toFixed(1)}%`
        });
      } else if (moisture < ranges.soilMoisture.min || moisture > ranges.soilMoisture.max) {
        alerts.push({
          metric: `soilMoisture${num}`,
          value: moisture,
          severity: 'warning',
          message: `Soil sensor ${num} outside ideal range at ${moisture.toFixed(1)}%`
        });
      }
    }
  });
  
  // Check leaf wetness (high = disease risk)
  if (latest.leafWetness !== null && latest.leafWetness !== undefined) {
    if (latest.leafWetness > ranges.leafWetness.critical.max) {
      alerts.push({
        metric: 'leafWetness',
        value: latest.leafWetness,
        severity: 'critical',
        message: `High leaf wetness (${latest.leafWetness.toFixed(1)}%) - disease risk!`
      });
    } else if (latest.leafWetness > ranges.leafWetness.max) {
      alerts.push({
        metric: 'leafWetness',
        value: latest.leafWetness,
        severity: 'warning',
        message: `Elevated leaf wetness at ${latest.leafWetness.toFixed(1)}%`
      });
    }
  }
  
  res.json({
    success: true,
    alertCount: alerts.length,
    alerts: alerts.sort((a, b) => 
      a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : 0
    ),
    timestamp: latest.timestamp
  });
});

// Debug endpoint to see raw Ecowitt data
app.get('/api/debug', (req, res) => {
  res.json({
    success: true,
    lastRawData: lastRawData,
    totalReadings: sensorData.length,
    latestParsed: sensorData.length > 0 ? sensorData[sensorData.length - 1] : null
  });
});

// Helper function for statistics
function calculateStats(values) {
  if (values.length === 0) return null;
  
  const sorted = values.sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    count: values.length
  };
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍇 Ecowitt Vineyard API running on port ${PORT}`);
  console.log(`📡 Ready to receive data from GW1200B!`);
  console.log(`🔗 Ecowitt webhook: POST /api/ecowitt`);
});

module.exports = app;