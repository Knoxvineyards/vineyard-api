// Knox Vineyards Environmental Monitoring API
// Pulls data from Ecowitt Cloud

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ecowitt Cloud API Configuration
const ECOWITT_API_KEY = '8e74fa3e-a99c-4d76-b120-01d8fbb07169';
const ECOWITT_APPLICATION_KEY = '42E6BEB0769C1ACCB32E82787D13A78B';
const ECOWITT_MAC = '48:CA:43:E1:E5:08';

// In-memory data storage
const sensorData = [];
const MAX_READINGS = 10000;
let lastRawData = null;

// Function to fetch data from Ecowitt API
async function fetchEcowittData() {
  try {
    const macNoColons = ECOWITT_MAC.replace(/:/g, '');
    const macUpperCase = ECOWITT_MAC.toUpperCase();
    const macLowerCase = ECOWITT_MAC.toLowerCase();
    
    let url = `https://api.ecowitt.net/api/v3/device/real_time?application_key=${ECOWITT_APPLICATION_KEY}&api_key=${ECOWITT_API_KEY}&mac=${macNoColons}&call_back=all`;
    
    console.log('🌐 Fetching data from Ecowitt cloud...');
    
    let response = await fetch(url);
    let data = await response.json();
    
    if (data.code !== 0) {
      url = `https://api.ecowitt.net/api/v3/device/real_time?application_key=${ECOWITT_APPLICATION_KEY}&api_key=${ECOWITT_API_KEY}&mac=${macUpperCase}&call_back=all`;
      response = await fetch(url);
      data = await response.json();
    }
    
    if (data.code !== 0) {
      url = `https://api.ecowitt.net/api/v3/device/real_time?application_key=${ECOWITT_APPLICATION_KEY}&api_key=${ECOWITT_API_KEY}&mac=${macLowerCase}&call_back=all`;
      response = await fetch(url);
      data = await response.json();
    }
    
    if (data.code === 0 && data.data) {
      console.log('✅ Received Ecowitt cloud data');
      
      lastRawData = {
        timestamp: new Date().toISOString(),
        source: 'ecowitt-cloud',
        data: data.data
      };
      
      const parsed = parseEcowittCloudData(data.data);
      
      if (parsed.temperature !== undefined || 
          parsed.soilMoisture1 !== null || 
          parsed.soilMoisture2 !== null || 
          parsed.leafWetness !== null) {
        
        sensorData.push(parsed);
        
        if (sensorData.length > MAX_READINGS) {
          sensorData.shift();
        }
        
        console.log('💾 Stored reading from Ecowitt cloud:', {
          temp: parsed.temperature,
          soil1: parsed.soilMoisture1,
          soil2: parsed.soilMoisture2,
          leafWetness: parsed.leafWetness
        });
      }
    } else {
      console.error('❌ Ecowitt API error:', data.msg || data.message || 'Unknown error', 'Code:', data.code);
    }
  } catch (error) {
    console.error('❌ Error fetching from Ecowitt:', error.message);
  }
}

// Parse Ecowitt cloud data format
function parseEcowittCloudData(data) {
  const parsed = {
    timestamp: new Date().toISOString(),
    raw: data
  };

  if (data.indoor) {
    if (data.indoor.temperature && data.indoor.temperature.value) {
      // Temperature is already in Fahrenheit from Ecowitt - keep it
      parsed.temperature = parseFloat(parseFloat(data.indoor.temperature.value).toFixed(1));
    }
    if (data.indoor.humidity && data.indoor.humidity.value) {
      parsed.humidity = parseFloat(data.indoor.humidity.value);
    }
  }

  if (data.outdoor) {
    if (data.outdoor.temperature && data.outdoor.temperature.value) {
      // Temperature is already in Fahrenheit from Ecowitt - keep it
      parsed.temperature = parseFloat(parseFloat(data.outdoor.temperature.value).toFixed(1));
    }
    if (data.outdoor.humidity && data.outdoor.humidity.value) {
      parsed.humidity = parseFloat(data.outdoor.humidity.value);
    }
  }

  if (data.soil_ch1 && data.soil_ch1.soilmoisture && data.soil_ch1.soilmoisture.value) {
    parsed.soilMoisture1 = parseFloat(parseFloat(data.soil_ch1.soilmoisture.value).toFixed(1));
  }
  
  if (data.soil_ch2 && data.soil_ch2.soilmoisture && data.soil_ch2.soilmoisture.value) {
    parsed.soilMoisture2 = parseFloat(parseFloat(data.soil_ch2.soilmoisture.value).toFixed(1));
  }

  if (data.leaf_ch1 && data.leaf_ch1.leaf_wetness && data.leaf_ch1.leaf_wetness.value) {
    parsed.leafWetness = parseFloat(parseFloat(data.leaf_ch1.leaf_wetness.value).toFixed(1));
  }

  return parsed;
}

// Start fetching from Ecowitt cloud
setInterval(fetchEcowittData, 60000);
setTimeout(fetchEcowittData, 5000);

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

// Routes

app.get('/', (req, res) => {
  res.json({
    service: 'Knox Vineyards Sensor API',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    totalReadings: sensorData.length,
    lastUpdate: sensorData.length > 0 ? sensorData[sensorData.length - 1].timestamp : null,
    endpoints: {
      health: 'GET /',
      latestData: 'GET /api/data/latest',
      history: 'GET /api/data/history',
      stats: 'GET /api/data/stats',
      alerts: 'GET /api/alerts',
      debug: 'GET /api/debug'
    }
  });
});

app.get('/api/data/latest', (req, res) => {
  if (sensorData.length === 0) {
    return res.json({ 
      success: false, 
      message: 'No data available yet. Waiting for Ecowitt cloud sync.' 
    });
  }
  
  const latest = sensorData[sensorData.length - 1];
  
  res.json({
    success: true,
    reading: latest
  });
});

app.get('/api/data/history', (req, res) => {
  const { limit = 100, hours } = req.query;
  
  let filtered = [...sensorData];
  
  if (hours) {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    filtered = filtered.filter(r => new Date(r.timestamp) >= cutoffTime);
  }
  
  const limitNum = parseInt(limit);
  filtered = filtered.slice(-limitNum);
  
  res.json({
    success: true,
    count: filtered.length,
    readings: filtered
  });
});

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
  
  const ranges = {
    temperature: { min: 18, max: 25, critical: { min: 10, max: 35 } },
    soilMoisture: { min: 30, max: 60, critical: { min: 20, max: 80 } },
    leafWetness: { max: 70, critical: { max: 85 } }
  };
  
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

app.get('/api/insights', async (req, res) => {
  try {
    if (sensorData.length < 10) {
      return res.json({
        success: true,
        insights: 'Need more data for insights. Collecting readings... Check back in a few minutes.'
      });
    }

    const latest = sensorData[sensorData.length - 1];
    const recentData = sensorData.slice(-50);
    const temps = recentData.map(d => d.temperature).filter(v => v);
    const soil1 = recentData.map(d => d.soilMoisture1).filter(v => v);
    const soil2 = recentData.map(d => d.soilMoisture2).filter(v => v);
    const leaf = recentData.map(d => d.leafWetness).filter(v => v);

    const stats = {
      tempAvg: temps.reduce((a, b) => a + b, 0) / temps.length,
      tempTrend: temps[temps.length - 1] - temps[0],
      soil1Avg: soil1.reduce((a, b) => a + b, 0) / soil1.length,
      soil1Trend: soil1[soil1.length - 1] - soil1[0],
      soil2Avg: soil2.reduce((a, b) => a + b, 0) / soil2.length,
      soil2Trend: soil2[soil2.length - 1] - soil2[0],
      leafAvg: leaf.reduce((a, b) => a + b, 0) / leaf.length,
      highLeafCount: leaf.filter(v => v > 70).length
    };

    const alertsList = await fetch(`${req.protocol}://${req.get('host')}/api/alerts`).then(r => r.json());

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `You are an expert viticulturist analyzing Knox Vineyards sensor data. Provide actionable insights.

Current Conditions:
- Temperature: ${latest.temperature?.toFixed(1)}°F
- Soil Moisture #1: ${latest.soilMoisture1?.toFixed(1)}%
- Soil Moisture #2: ${latest.soilMoisture2?.toFixed(1)}%
- Leaf Wetness: ${latest.leafWetness?.toFixed(1)}%

Recent Trends (last ${recentData.length} readings):
- Avg Temperature: ${stats.tempAvg.toFixed(1)}°F (${stats.tempTrend > 0 ? '+' : ''}${stats.tempTrend.toFixed(1)}°F trend)
- Avg Soil #1: ${stats.soil1Avg.toFixed(1)}% (${stats.soil1Trend > 0 ? '+' : ''}${stats.soil1Trend.toFixed(1)}% trend)
- Avg Soil #2: ${stats.soil2Avg.toFixed(1)}% (${stats.soil2Trend > 0 ? '+' : ''}${stats.soil2Trend.toFixed(1)}% trend)
- Avg Leaf Wetness: ${stats.leafAvg.toFixed(1)}% (${stats.highLeafCount} high readings)

Active Alerts: ${alertsList.alerts?.length > 0 ? alertsList.alerts.map(a => a.message).join('; ') : 'None'}

Provide:
1. Current conditions assessment
2. Key trends and what they mean
3. Disease risk evaluation (especially fungal diseases)
4. Irrigation recommendations
5. Action items for next 24-48 hours
6. Any concerning patterns

Be specific and actionable. Focus on premium wine grape production.`
        }]
      })
    });

    const data = await response.json();
    const insights = data.content.filter(i => i.type === 'text').map(i => i.text).join('\n');
    
    res.json({
      success: true,
      insights: insights
    });
  } catch (error) {
    console.error('AI insights error:', error);
    res.json({
      success: false,
      insights: `AI analysis temporarily unavailable: ${error.message}`
    });
  }
});

app.get('/api/debug', (req, res) => {
  res.json({
    success: true,
    lastRawData: lastRawData,
    totalReadings: sensorData.length,
    latestParsed: sensorData.length > 0 ? sensorData[sensorData.length - 1] : null
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍇 Knox Vineyards API running on port ${PORT}`);
  console.log(`📡 Fetching from Ecowitt cloud every 60 seconds`);
});

module.exports = app;
