const { startBot, getQRPage, getQRCode, requestPairingCode, clearPairingCode, getUptimeString } = require('./config/WhatsappConnection.js');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

// ✅ Express server setup
const app = express();
const port = process.env.PORT || 8000;

app.use(bodyParser.json());
app.use(express.static('public'));

// Global variables to track bot state
global.botStatus = 'starting';
global.whatsappBot = null;
global.connectionTime = null;
global.lastActivity = new Date();

// Rate limiting for API endpoints
const apiRequests = new Map();
const MAX_REQUESTS_PER_MINUTE = 60;

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - 60000; // 1 minute window
  
  if (!apiRequests.has(ip)) {
    apiRequests.set(ip, []);
  }
  
  const requests = apiRequests.get(ip).filter(time => time > windowStart);
  apiRequests.set(ip, requests);
  
  if (requests.length >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  requests.push(now);
  return true;
}

// Helper function to get session information
function getSessionInfo() {
  const sock = global.whatsappBot;
  
  if (!sock) {
    return {
      connected: false,
      message: 'Bot not initialized'
    };
  }

  const creds = sock.authState?.creds || {};
  const sessionId = creds.me?.id;
  
  return {
    connected: global.botStatus === 'connected',
    hasSession: !!sessionId,
    registered: creds.registered || false,
    platform: sock.user?.platform || 'Unknown',
    sessionId: sessionId ? `${sessionId.substring(0, 8)}...` : 'Not authenticated',
    phone: creds.me?.phone ? `${creds.me.phone.substring(0, 4)}...` : null,
    connectionTime: global.connectionTime,
    lastActivity: global.lastActivity
  };
}

// Get pairing code status
function getPairingStatus() {
  const { pairingCode, pairingPhoneNumber } = getQRCode();
  return {
    hasPairingCode: !!pairingCode,
    phoneNumber: pairingPhoneNumber,
    code: pairingCode
  };
}

// Platform detection and optimization
function configureForPlatform() {
  const platform = process.env.PLATFORM || 'unknown';
  
  console.log(`🏗️ Configuring for platform: ${platform}`);
  
  switch(platform) {
    case 'koyeb':
      console.log('✅ Koyeb: Continuous operation enabled');
      console.log('🌐 Region:', process.env.KOYEB_REGION || 'unknown');
      console.log('🔧 Service:', process.env.KOYEB_SERVICE_NAME || 'unknown');
      break;
      
    case 'render':
      console.log('⚠️ Render: Free tier - consider WebSocket service for 24/7');
      break;
      
    default:
      console.log('🔧 Local/unknown platform - basic configuration');
  }
  
  return platform;
}

// ✅ Enhanced Landing Page with Modern UI
app.get('/', (req, res) => {
  global.lastActivity = new Date();
  const sessionInfo = getSessionInfo();
  const { qrCode, qrCodeImage, isConnected, reconnectCount, uptime } = getQRCode();
  const pairingStatus = getPairingStatus();
  const platform = configureForPlatform();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Desire-eXe V1.0 - WhatsApp Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { 
                margin: 0; 
                padding: 0; 
                box-sizing: border-box; 
            }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 20px;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                color: white;
            }
            .container {
                background: rgba(255,255,255,0.1);
                padding: 40px;
                border-radius: 20px;
                backdrop-filter: blur(10px);
                max-width: 900px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                border: 1px solid rgba(255,255,255,0.2);
            }
            .logo {
                font-size: 4em;
                margin-bottom: 10px;
                animation: float 3s ease-in-out infinite;
            }
            @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-10px); }
            }
            .title {
                font-size: 2.8em;
                margin-bottom: 10px;
                background: linear-gradient(45deg, #fff, #e0e0e0);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                font-weight: 800;
            }
            .subtitle {
                color: #ccc;
                margin-bottom: 30px;
                font-size: 1.3em;
            }
            .status-badge {
                display: inline-block;
                padding: 12px 25px;
                border-radius: 25px;
                font-weight: bold;
                margin: 15px 0;
                font-size: 1.1em;
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            }
            .status-connected { 
                background: linear-gradient(45deg, #4CAF50, #45a049);
                animation: pulse 2s infinite;
            }
            .status-disconnected { background: #f44336; }
            .status-waiting { 
                background: linear-gradient(45deg, #ff9800, #e68900);
            }
            .status-pairing { 
                background: linear-gradient(45deg, #2196F3, #0b7dda);
            }
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 25px 0;
            }
            .stat-card {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 15px;
                border: 1px solid rgba(255,255,255,0.1);
                transition: transform 0.3s ease;
            }
            .stat-card:hover {
                transform: translateY(-5px);
                background: rgba(255,255,255,0.15);
            }
            .stat-value {
                font-size: 1.8em;
                font-weight: bold;
                margin-bottom: 5px;
            }
            .stat-label {
                font-size: 0.9em;
                color: #ccc;
            }
            .card-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 20px;
                margin: 30px 0;
            }
            .card {
                background: rgba(255,255,255,0.1);
                padding: 25px;
                border-radius: 15px;
                transition: all 0.3s ease;
                cursor: pointer;
                border: 1px solid rgba(255,255,255,0.1);
                text-decoration: none;
                color: white;
                display: block;
            }
            .card:hover {
                transform: translateY(-8px);
                background: rgba(255,255,255,0.15);
                box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            }
            .card h3 {
                margin-bottom: 10px;
                color: #fff;
                font-size: 1.3em;
            }
            .card p {
                color: #ccc;
                font-size: 0.9em;
                line-height: 1.5;
            }
            .btn {
                display: inline-block;
                padding: 12px 24px;
                background: #007bff;
                color: white;
                text-decoration: none;
                border-radius: 8px;
                margin: 5px;
                transition: all 0.3s ease;
                border: none;
                cursor: pointer;
                font-size: 1em;
                font-weight: 600;
            }
            .btn:hover {
                background: #0056b3;
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            }
            .btn-success { 
                background: linear-gradient(45deg, #28a745, #20c997);
            }
            .btn-success:hover { 
                background: linear-gradient(45deg, #1e7e34, #1a9360);
            }
            .btn-warning { 
                background: linear-gradient(45deg, #ffc107, #ffb300);
                color: #000;
            }
            .btn-warning:hover { 
                background: linear-gradient(45deg, #e0a800, #e6ac00);
            }
            .btn-info { 
                background: linear-gradient(45deg, #17a2b8, #138496);
            }
            .btn-info:hover { 
                background: linear-gradient(45deg, #138496, #117a8b);
            }
            .btn-danger { 
                background: linear-gradient(45deg, #dc3545, #c82333);
            }
            .btn-danger:hover { 
                background: linear-gradient(45deg, #c82333, #bd2130);
            }
            .pairing-alert {
                background: rgba(33, 150, 243, 0.2);
                border: 2px solid #2196F3;
                padding: 20px;
                border-radius: 15px;
                margin: 25px 0;
                backdrop-filter: blur(10px);
            }
            .pairing-code {
                font-size: 2.5em;
                font-weight: bold;
                color: #4CAF50;
                margin: 15px 0;
                padding: 20px;
                background: rgba(255,255,255,0.1);
                border-radius: 10px;
                border: 2px dashed #4CAF50;
                font-family: 'Courier New', monospace;
            }
            .feature-list {
                text-align: left;
                background: rgba(255,255,255,0.05);
                padding: 20px;
                border-radius: 10px;
                margin: 20px 0;
            }
            .feature-list ul {
                list-style: none;
                padding: 0;
            }
            .feature-list li {
                padding: 8px 0;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .feature-list li:before {
                content: "✅ ";
                margin-right: 10px;
            }
            .platform-badge {
                display: inline-block;
                padding: 5px 10px;
                background: rgba(255,255,255,0.2);
                border-radius: 5px;
                font-size: 0.8em;
                margin-left: 10px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">🤖</div>
            <h1 class="title">Desire-eXe V1.0</h1>
            <p class="subtitle">Advanced WhatsApp Bot with AI Capabilities</p>
            
            ${pairingStatus.hasPairingCode ? `
            <div class="pairing-alert">
                <h3>🔢 Active Pairing Code</h3>
                <p>Phone: ${pairingStatus.phoneNumber}</p>
                <div class="pairing-code">${pairingStatus.code}</div>
                <p>Enter this code in WhatsApp under "Linked Devices" → "Link with code"</p>
                <a href="/pairing" class="btn btn-info">View Pairing Instructions</a>
            </div>
            ` : ''}
            
            <div class="status-badge ${isConnected ? 'status-connected' : (pairingStatus.hasPairingCode ? 'status-pairing' : 'status-waiting')}">
                ${isConnected ? '✅ CONNECTED & READY' : (pairingStatus.hasPairingCode ? '🔢 WAITING FOR PAIRING' : '⏳ WAITING FOR AUTHENTICATION')}
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${isConnected ? 'Online' : 'Offline'}</div>
                    <div class="stat-label">Status</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${uptime}</div>
                    <div class="stat-label">Uptime</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${reconnectCount}</div>
                    <div class="stat-label">Reconnects</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${platform.toUpperCase()}</div>
                    <div class="stat-label">Platform</div>
                </div>
            </div>
            
            <div class="card-grid">
                <a href="/qr" class="card">
                    <h3>📱 QR Code</h3>
                    <p>Authenticate with QR code scanning - Fast and secure</p>
                    <div class="btn" style="margin-top: 15px;">Get QR Code</div>
                </a>
                <a href="/pairing" class="card">
                    <h3>🔢 Pairing Code</h3>
                    <p>Use phone number for authentication - No camera needed</p>
                    <div class="btn btn-warning" style="margin-top: 15px;">Pairing Code</div>
                </a>
                <a href="/status" class="card">
                    <h3>📊 Status</h3>
                    <p>Check bot status and detailed connection information</p>
                    <div class="btn" style="margin-top: 15px;">View Status</div>
                </a>
                <a href="/health" class="card">
                    <h3>🛠️ Health</h3>
                    <p>System health check and performance metrics</p>
                    <div class="btn btn-success" style="margin-top: 15px;">Health Check</div>
                </a>
            </div>
            
            <div class="feature-list">
                <h3>🚀 Advanced Features:</h3>
                <ul>
                    <li>AI-Powered Message Responses</li>
                    <li>Group Management Tools</li>
                    <li>Media Download & Processing</li>
                    <li>Security & Anti-Spam Protection</li>
                    <li>Multi-Device Support</li>
                    <li>Auto-Reconnect & Recovery</li>
                </ul>
            </div>
            
            <div style="margin-top: 30px;">
                <p style="color: #ccc; font-size: 0.9em;">
                    🤖 Powered by Desire-eXe V1.0 | 
                    <a href="/bot/info" style="color: #4CAF50; text-decoration: none;">Bot Info</a> | 
                    <a href="/session" style="color: #2196F3; text-decoration: none;">Session</a> |
                    <a href="/api" style="color: #ff9800; text-decoration: none;">API Docs</a>
                </p>
                <div class="platform-badge">${platform}</div>
            </div>
        </div>
        
        <script>
            // Auto-refresh status every 30 seconds if not connected
            if (!${isConnected}) {
                setTimeout(() => location.reload(), 30000);
            }
            
            // Add smooth animations
            document.addEventListener('DOMContentLoaded', function() {
                const cards = document.querySelectorAll('.card');
                const stats = document.querySelectorAll('.stat-card');
                
                cards.forEach((card, index) => {
                    card.style.animationDelay = (index * 0.1) + 's';
                    card.style.animation = 'fadeInUp 0.6s ease forwards';
                });
                
                stats.forEach((stat, index) => {
                    stat.style.animationDelay = (index * 0.05) + 's';
                    stat.style.animation = 'fadeInUp 0.4s ease forwards';
                });
            });
        </script>
        <style>
            @keyframes fadeInUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            .card, .stat-card {
                opacity: 0;
            }
        </style>
    </body>
    </html>
  `);
});

// ✅ Enhanced Pairing Code Interface
app.get('/pairing', (req, res) => {
  global.lastActivity = new Date();
  const pairingStatus = getPairingStatus();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Pairing Code - Desire-eXe V1.0</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 20px;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                color: white;
            }
            .container {
                background: rgba(255,255,255,0.1);
                padding: 40px;
                border-radius: 20px;
                backdrop-filter: blur(10px);
                max-width: 500px;
                width: 100%;
                text-align: center;
                border: 1px solid rgba(255,255,255,0.2);
            }
            h1 {
                font-size: 2.2em;
                margin-bottom: 10px;
                background: linear-gradient(45deg, #fff, #e0e0e0);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .subtitle {
                color: #ccc;
                margin-bottom: 30px;
            }
            input, button {
                width: 100%;
                padding: 15px;
                margin: 10px 0;
                border: 2px solid rgba(255,255,255,0.2);
                border-radius: 10px;
                background: rgba(255,255,255,0.1);
                color: white;
                font-size: 1em;
                transition: all 0.3s ease;
            }
            input::placeholder { 
                color: #ccc; 
            }
            input:focus {
                outline: none;
                border-color: #007bff;
                background: rgba(255,255,255,0.15);
            }
            button {
                background: linear-gradient(45deg, #007bff, #0056b3);
                border: none;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.3s ease;
            }
            button:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            }
            button:disabled {
                background: #6c757d;
                cursor: not-allowed;
                transform: none;
            }
            .pairing-code {
                font-size: 2.5em;
                font-weight: bold;
                color: #4CAF50;
                margin: 20px 0;
                padding: 20px;
                background: rgba(255,255,255,0.1);
                border-radius: 10px;
                border: 2px dashed #4CAF50;
                font-family: 'Courier New', monospace;
            }
            .instructions {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 15px;
                margin: 20px 0;
                text-align: left;
                border-left: 4px solid #2196F3;
            }
            .timer {
                color: #ff9800;
                font-weight: bold;
                margin: 10px 0;
                font-size: 1.1em;
            }
            .error-message {
                color: #ff6b6b;
                background: rgba(255,107,107,0.1);
                padding: 15px;
                border-radius: 10px;
                margin: 15px 0;
                border: 1px solid #ff6b6b;
            }
            .success-message {
                color: #4CAF50;
                background: rgba(76,175,80,0.1);
                padding: 15px;
                border-radius: 10px;
                margin: 15px 0;
                border: 1px solid #4CAF50;
            }
            .loading {
                display: inline-block;
                width: 20px;
                height: 20px;
                border: 3px solid rgba(255,255,255,.3);
                border-radius: 50%;
                border-top-color: #fff;
                animation: spin 1s ease-in-out infinite;
                margin-right: 10px;
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            .nav-buttons {
                margin-top: 25px;
                display: flex;
                gap: 10px;
                justify-content: center;
                flex-wrap: wrap;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔢 Pairing Code</h1>
            <p class="subtitle">Authenticate with your phone number</p>
            
            ${pairingStatus.hasPairingCode ? `
                <div class="pairing-code">${pairingStatus.code}</div>
                <p class="success-message">✅ Active pairing code for: ${pairingStatus.phoneNumber}</p>
                <div class="timer">⏰ Code expires in 2 minutes</div>
            ` : `
                <p>Enter your WhatsApp phone number to get a pairing code</p>
                <input type="tel" id="phoneNumber" placeholder="Phone number (e.g., 2347017747337)" pattern="[0-9]{10,15}">
                <button onclick="getPairingCode()" id="pairingBtn">
                    Get Pairing Code
                </button>
            `}
            
            <div id="pairingResult"></div>
            
            <div class="instructions">
                <h3>📋 Step-by-Step Instructions:</h3>
                <ol>
                    <li>${pairingStatus.hasPairingCode ? 'You have an active pairing code' : 'Enter your phone number (with country code, no +)'}</li>
                    <li>${pairingStatus.hasPairingCode ? 'Use the code shown above' : 'Click "Get Pairing Code"'}</li>
                    <li>Open WhatsApp → Settings → Linked Devices</li>
                    <li>Tap "Link a Device" → "Link with phone number"</li>
                    <li>${pairingStatus.hasPairingCode ? `Enter phone number: ${pairingStatus.phoneNumber}` : 'Enter your phone number'}</li>
                    <li>Enter the 6-digit pairing code</li>
                    <li>Wait for connection confirmation</li>
                </ol>
                <p><strong>💡 Tip:</strong> Make sure your phone has internet connection</p>
            </div>
            
            <div class="nav-buttons">
                <a href="/" class="btn" style="background: #6c757d; padding: 10px 20px; border-radius: 5px; text-decoration: none; color: white;">← Back to Home</a>
                ${pairingStatus.hasPairingCode ? `
                <button onclick="clearPairingCode()" style="background: #dc3545; padding: 10px 20px; border: none; border-radius: 5px; color: white; cursor: pointer;">Clear Code</button>
                ` : ''}
                <a href="/qr" class="btn" style="background: #28a745; padding: 10px 20px; border-radius: 5px; text-decoration: none; color: white;">📱 Use QR Code Instead</a>
            </div>
        </div>
        
        <script>
            async function getPairingCode() {
                const phoneInput = document.getElementById('phoneNumber');
                const pairingBtn = document.getElementById('pairingBtn');
                const phoneNumber = phoneInput.value.trim();
                const resultDiv = document.getElementById('pairingResult');
                
                if (!phoneNumber) {
                    resultDiv.innerHTML = '<div class="error-message">Please enter a phone number</div>';
                    return;
                }
                
                if (!/^[0-9]{10,15}$/.test(phoneNumber)) {
                    resultDiv.innerHTML = '<div class="error-message">Please enter a valid phone number (10-15 digits, country code included)</div>';
                    return;
                }
                
                // Show loading state
                pairingBtn.innerHTML = '<span class="loading"></span> Requesting code from WhatsApp...';
                pairingBtn.disabled = true;
                resultDiv.innerHTML = '<div class="success-message">🔄 Requesting pairing code from WhatsApp servers...</div>';
                
                try {
                    const response = await fetch('/api/pairing-code', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phoneNumber })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        resultDiv.innerHTML = '<div class="success-message">✅ Pairing code generated successfully! Redirecting...</div>';
                        // Reload to show the new pairing code
                        setTimeout(() => location.reload(), 2000);
                    } else {
                        resultDiv.innerHTML = \`<div class="error-message">❌ \${data.error}</div>\`;
                        pairingBtn.innerHTML = 'Get Pairing Code';
                        pairingBtn.disabled = false;
                    }
                } catch (error) {
                    resultDiv.innerHTML = \`<div class="error-message">❌ Network error: \${error.message}</div>\`;
                    pairingBtn.innerHTML = 'Get Pairing Code';
                    pairingBtn.disabled = false;
                }
            }
            
            async function clearPairingCode() {
                try {
                    const response = await fetch('/api/clear-pairing', {
                        method: 'POST'
                    });
                    location.reload();
                } catch (error) {
                    alert('Error clearing pairing code: ' + error.message);
                }
            }
            
            // Auto-refresh if there's an active pairing code
            ${pairingStatus.hasPairingCode ? `
            setTimeout(() => {
                location.reload();
            }, 30000);
            ` : `
            // Auto-focus on input
            document.getElementById('phoneNumber').focus();
            
            // Enter key support
            document.getElementById('phoneNumber').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    getPairingCode();
                }
            });
            `}
        </script>
    </body>
    </html>
  `);
});

// ✅ QR Code Page
app.get('/qr', (req, res) => {
  global.lastActivity = new Date();
  res.send(getQRPage());
});

// ✅ API endpoint for pairing codes with rate limiting
app.post('/api/pairing-code', async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({ 
      success: false, 
      error: 'Too many requests. Please wait a minute before trying again.' 
    });
  }
  
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.json({ success: false, error: 'Phone number is required' });
  }
  
  if (!/^[0-9]{10,15}$/.test(phoneNumber)) {
    return res.json({ success: false, error: 'Please enter a valid phone number (10-15 digits)' });
  }
  
  try {
    const code = await requestPairingCode(phoneNumber);
    
    res.json({ 
      success: true, 
      code: code,
      message: 'Pairing code generated successfully'
    });
  } catch (error) {
    console.error('❌ Pairing request error:', error);
    res.json({ success: false, error: error.message });
  }
});

// ✅ API endpoint to clear pairing code
app.post('/api/clear-pairing', async (req, res) => {
  try {
    clearPairingCode();
    res.json({ success: true, message: 'Pairing code cleared' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ✅ Enhanced Health Check Endpoint
app.get('/health', (req, res) => {
  global.lastActivity = new Date();
  const sessionInfo = getSessionInfo();
  const { qrCode, qrCodeImage, isConnected, reconnectCount, uptime } = getQRCode();
  
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB'
    },
    bot: {
      status: global.botStatus,
      connected: isConnected,
      reconnects: reconnectCount,
      uptime: uptime,
      connectionTime: global.connectionTime
    },
    session: sessionInfo,
    platform: {
      name: process.env.PLATFORM || 'unknown',
      region: process.env.KOYEB_REGION || 'unknown',
      node: process.version
    },
    authentication: {
      qrCode: !!qrCode,
      pairingCode: !!getPairingStatus().hasPairingCode
    }
  };
  
  // Mark as unhealthy if too many reconnects
  if (reconnectCount > 10) {
    health.status = 'degraded';
    health.message = 'High reconnection rate detected';
  }
  
  if (!isConnected && global.botStatus === 'reconnecting') {
    health.status = 'reconnecting';
  }
  
  if (global.botStatus === 'failed') {
    health.status = 'unhealthy';
  }
  
  res.json(health);
});

// ✅ Enhanced Status Endpoint
app.get('/status', (req, res) => {
  global.lastActivity = new Date();
  const sessionInfo = getSessionInfo();
  const { qrCode, qrCodeImage, isConnected, reconnectCount, uptime } = getQRCode();
  const pairingStatus = getPairingStatus();
  
  const status = {
    status: 'online',
    timestamp: new Date().toISOString(),
    platform: {
      name: process.env.PLATFORM || 'Koyeb Cloud',
      region: process.env.KOYEB_REGION || 'global',
      nodeVersion: process.version,
      uptime: process.uptime()
    },
    bot: {
      status: global.botStatus,
      connected: isConnected,
      connectionTime: global.connectionTime,
      lastActivity: global.lastActivity,
      reconnects: reconnectCount,
      uptime: uptime
    },
    session: sessionInfo,
    authentication: {
      qrCode: {
        available: !!qrCode,
        connected: isConnected
      },
      pairingCode: {
        available: pairingStatus.hasPairingCode,
        phoneNumber: pairingStatus.phoneNumber
      }
    },
    system: {
      memory: process.memoryUsage(),
      platform: process.env.PLATFORM || 'unknown'
    }
  };
  
  res.json(status);
});

// ✅ Bot Info Endpoint
app.get('/bot/info', (req, res) => {
  global.lastActivity = new Date();
  const sessionInfo = getSessionInfo();
  
  const info = {
    name: 'Desire-eXe V1.0',
    version: '1.0.0',
    description: 'Advanced WhatsApp Bot with AI Capabilities',
    developer: 'Desire',
    platform: process.env.PLATFORM || 'Koyeb Cloud',
    status: global.botStatus,
    session: sessionInfo,
    features: [
      'Dual Authentication (QR + Pairing Code)',
      'AI-Powered Responses',
      'Group Management Tools',
      'Media Download & Processing',
      'Security & Anti-Spam Protection',
      'Multi-Device Support',
      'Auto-Reconnect & Recovery',
      'Web Dashboard',
      'RESTful API'
    ],
    endpoints: {
      home: '/',
      qr: '/qr',
      pairing: '/pairing',
      status: '/status',
      health: '/health',
      session: '/session',
      botInfo: '/bot/info',
      api: '/api'
    },
    timestamp: new Date().toISOString()
  };
  
  res.json(info);
});

// ✅ Session Info Endpoint
app.get('/session', (req, res) => {
  global.lastActivity = new Date();
  res.json(getSessionInfo());
});

// ✅ API Documentation Endpoint
app.get('/api', (req, res) => {
  global.lastActivity = new Date();
  
  const apiDocs = {
    name: 'Desire-eXe Bot API',
    version: '1.0.0',
    description: 'RESTful API for WhatsApp Bot Management',
    baseURL: process.env.KOYEB_APP_DOMAIN ? `https://${process.env.KOYEB_APP_DOMAIN}` : `http://localhost:${port}`,
    endpoints: {
      'GET /': 'Landing page with bot status',
      'GET /qr': 'QR code authentication page',
      'GET /pairing': 'Pairing code authentication page',
      'GET /status': 'Bot status information (JSON)',
      'GET /health': 'Health check endpoint (JSON)',
      'GET /session': 'Session information (JSON)',
      'GET /bot/info': 'Bot information (JSON)',
      'GET /ping': 'Simple ping endpoint for uptime monitoring',
      'POST /api/pairing-code': 'Request pairing code (JSON body: {phoneNumber})',
      'POST /api/clear-pairing': 'Clear current pairing code'
    },
    authentication: {
      qr: 'Visit /qr and scan with WhatsApp',
      pairing: 'Visit /pairing and enter phone number'
    },
    rateLimiting: '60 requests per minute per IP',
    timestamp: new Date().toISOString()
  };
  
  res.json(apiDocs);
});

// ✅ Essential Ping Endpoint for UptimeRobot
app.get('/ping', (req, res) => {
  global.lastActivity = new Date();
  const { isConnected, reconnectCount, uptime } = getQRCode();
  
  res.json({ 
    status: 'pong',
    bot: 'Desire-eXe V1.0',
    platform: process.env.PLATFORM || 'Koyeb',
    botStatus: global.botStatus,
    connected: isConnected,
    reconnects: reconnectCount,
    uptime: process.uptime(),
    botUptime: uptime,
    time: new Date().toISOString()
  });
});

// ✅ Enhanced initialization with better error handling
async function initializeApp() {
  try {
    configureForPlatform();
    
    console.log('🚀 Starting Desire-eXe V1.0...');
    console.log('📦 Platform:', process.env.PLATFORM || 'Koyeb Cloud');
    console.log('🌐 Environment:', process.env.NODE_ENV || 'development');
    console.log('🛠️ Node Version:', process.version);
    
    // Start WhatsApp bot first
    const sock = await startBot();
    global.whatsappBot = sock;
    global.lastActivity = new Date();
    
    console.log('✅ WhatsApp bot initialization complete');
    
    // Start Express server
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Express server running on port ${port}`);
      
      const baseUrl = process.env.KOYEB_APP_DOMAIN 
        ? `https://${process.env.KOYEB_APP_DOMAIN}`
        : `http://localhost:${port}`;
      
      console.log('🔗 Available Endpoints:');
      console.log(`   🏠 Home: ${baseUrl}/`);
      console.log(`   📱 QR Code: ${baseUrl}/qr`);
      console.log(`   🔢 Pairing: ${baseUrl}/pairing`);
      console.log(`   📊 Status: ${baseUrl}/status`);
      console.log(`   🩺 Health: ${baseUrl}/health`);
      console.log(`   🤖 Bot Info: ${baseUrl}/bot/info`);
      console.log(`   🔄 Session: ${baseUrl}/session`);
      console.log(`   📚 API Docs: ${baseUrl}/api`);
      console.log(`   ❤️ Ping: ${baseUrl}/ping (for UptimeRobot)`);
      
      console.log('\n💡 Setup UptimeRobot with:', `${baseUrl}/ping`);
    });

    // Enhanced graceful shutdown
    const gracefulShutdown = (signal) => {
      console.log(`\n👋 Received ${signal}, shutting down gracefully...`);
      global.botStatus = 'shutting_down';
      
      server.close(() => {
        console.log('✅ Express server closed');
        console.log('👋 Desire-eXe V1.0 stopped gracefully');
        process.exit(0);
      });
      
      // Force close after 10 seconds
      setTimeout(() => {
        console.log('⚠️ Forcing shutdown...');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (err) {
    console.error('❌ Failed to start bot:', err);
    global.botStatus = 'failed';
    
    // Auto-restart with backoff
    const restartDelay = 10000;
    console.log(`🔄 Auto-restarting in ${restartDelay/1000} seconds...`);
    setTimeout(initializeApp, restartDelay);
  }
}

// Enhanced error handling
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error.message);
  global.botStatus = 'error';
  global.lastActivity = new Date();
  // Don't exit - let the auto-restart handle it
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection:', reason);
  global.botStatus = 'error';
  global.lastActivity = new Date();
  // Don't exit - let the auto-restart handle it
});

// Enhanced keep-alive with activity tracking
setInterval(() => {
  global.lastActivity = new Date();
  
  if (global.whatsappBot && global.botStatus === 'connected') {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    console.log(`❤️ Keep-alive | Status: ${global.botStatus} | Uptime: ${hours}h ${minutes}m | Reconnects: ${getQRCode().reconnectCount}`);
  }
}, 60000); // Every minute

// Memory cleanup (optional, for long-running processes)
setInterval(() => {
  if (global.gc) {
    global.gc();
  }
  
  // Clear old rate limit data
  const now = Date.now();
  for (let [ip, requests] of apiRequests) {
    const recentRequests = requests.filter(time => now - time < 60000);
    if (recentRequests.length === 0) {
      apiRequests.delete(ip);
    } else {
      apiRequests.set(ip, recentRequests);
    }
  }
}, 300000); // Every 5 minutes

// Start the application
initializeApp();

console.log('🔄 app.js loaded with enhanced features and pairing code support');
