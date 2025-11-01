// Imports
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const MessageHandler = require('../controllers/Message');
const { restoreActivePresence } = require('../presenceSystem');
const delay = ms => new Promise(res => setTimeout(res, ms));

// File paths - consistent for Koyeb
const AUTH_DIR = './auth_info';
const AUTH_BACKUP_DIR = './auth_info_backup';
const CONTACT_FILE = './Desire_contact.json';
const CONFIG_FILE = './config.json';
const BUG_LOG = './buglog.json';
const PERFORMANCE_LOG = './performance.json';

let contactList = [];
let botStartTime = null;
let isConnected = false;
let qrCode = null;
let qrCodeImage = null;
let pairingCode = null;
let pairingPhoneNumber = null;
let currentSock = null;
let reconnectCount = 0;
const MAX_RECONNECTS = 50;
const BASE_RECONNECT_DELAY = 5000;

// 🔧 FIX: Add missing unwrapMessage function
function unwrapMessage(message) {
  if (message?.ephemeralMessage?.message) {
    return unwrapMessage(message.ephemeralMessage.message);
  }
  if (message?.viewOnceMessage?.message) {
    return unwrapMessage(message.viewOnceMessage.message);
  }
  return message;
}

// Enhanced configuration loader
function loadConfig() {
  const defaultConfig = {
    AUTO_BLOCK_UNKNOWN: false,
    OWNER_JID: process.env.OWNER_JID || '2347017747337@s.whatsapp.net',
    MAX_MEDIA_SIZE: 15000000, // 15MB
    RECONNECT_DELAY: 10000,
    MAX_RECONNECT_ATTEMPTS: 5,
    ENABLE_PAIRING_CODE: true,
    ENABLE_BACKUP: true,
    BACKUP_INTERVAL: 3600000 // 1 hour
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE));
      
      // Validate critical config values
      if (fileConfig.OWNER_JID && !isValidJid(fileConfig.OWNER_JID)) {
        console.warn('⚠️ Invalid OWNER_JID in config, using default');
        delete fileConfig.OWNER_JID;
      }
      
      return { ...defaultConfig, ...fileConfig };
    }
  } catch (e) {
    console.error('❌ Failed to load config:', e);
  }
  
  return defaultConfig;
}

function isValidJid(jid) {
  return typeof jid === 'string' && (
    jid.endsWith('@s.whatsapp.net') || 
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast')
  );
}

// Load contacts
function loadContactsFromFile() {
  if (fs.existsSync(CONTACT_FILE)) {
    try {
      const raw = fs.readFileSync(CONTACT_FILE);
      contactList = JSON.parse(raw) || [];
      console.log(`📁 Loaded ${contactList.length} saved contacts.`);
    } catch (e) {
      console.error('❌ Failed to parse contact file:', e);
      contactList = [];
    }
  }
}

// Save contacts
function saveContactsToFile() {
  try {
    fs.writeFileSync(CONTACT_FILE, JSON.stringify(contactList, null, 2));
  } catch (e) {
    console.error('❌ Failed to save contacts:', e);
  }
}

// Backup auth state
function backupAuthState() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      if (fs.existsSync(AUTH_BACKUP_DIR)) {
        fs.rmSync(AUTH_BACKUP_DIR, { recursive: true });
      }
      fs.cpSync(AUTH_DIR, AUTH_BACKUP_DIR, { recursive: true });
      console.log('✅ Auth state backed up successfully');
    }
  } catch (error) {
    console.error('❌ Failed to backup auth state:', error);
  }
}

// Save bug log
function logBugIncident(jid, type, detail) {
  const logEntry = {
    time: new Date().toISOString(),
    jid,
    type,
    detail
  };

  let logs = [];
  if (fs.existsSync(BUG_LOG)) {
    try {
      logs = JSON.parse(fs.readFileSync(BUG_LOG));
    } catch (e) {
      console.error('❌ Failed to parse bug log:', e);
    }
  }

  logs.push(logEntry);
  try {
    fs.writeFileSync(BUG_LOG, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error('❌ Failed to save bug log:', e);
  }
}

// Performance logging
function logPerformance(metric, value) {
  try {
    let logs = {};
    if (fs.existsSync(PERFORMANCE_LOG)) {
      logs = JSON.parse(fs.readFileSync(PERFORMANCE_LOG));
    }
    
    if (!logs[metric]) logs[metric] = [];
    logs[metric].push({
      timestamp: new Date().toISOString(),
      value: value
    });
    
    // Keep only last 100 entries per metric
    if (logs[metric].length > 100) {
      logs[metric] = logs[metric].slice(-100);
    }
    
    fs.writeFileSync(PERFORMANCE_LOG, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error('❌ Failed to save performance log:', e);
  }
}

// Enhanced bug detection
function isDangerousText(msg) {
  const text = msg?.conversation || msg?.extendedTextMessage?.text || '';
  
  if (!text || text.trim().length === 0) return false;
  
  // Remove emojis for better pattern detection
  const textWithoutEmojis = text
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '')
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{2300}-\u{23FF}]/gu, '')
    .replace(/[\u{2B50}-\u{2BFF}]/gu, '')
    .replace(/[\u{FE0F}\u{200D}]/gu, '');
  
  if (textWithoutEmojis.trim().length === 0) {
    return false;
  }
  
  const dangerousPatterns = [
    /[\u200B-\u200C\u200E-\u200F\u202A-\u202E\u2060]/,
    /(.+)\1{50,}/,
    /.{4000,}/,
    /[\uFFF9-\uFFFF]/,
  ];
  
  return dangerousPatterns.some(p => p.test(textWithoutEmojis));
}

function isSuspiciousMedia(msg, maxBytes) {
  const media = msg?.stickerMessage || msg?.imageMessage || msg?.videoMessage || msg?.audioMessage || msg?.documentMessage;
  const size = media?.fileLength || 0;
  return size > maxBytes;
}

// Rate limiting for pairing codes
const pairingAttempts = new Map();
const MAX_PAIRING_ATTEMPTS = 3;
const ATTEMPT_WINDOW = 60000; // 1 minute

function canRequestPairing(phoneNumber) {
  const now = Date.now();
  const attempts = pairingAttempts.get(phoneNumber) || [];
  
  // Clean old attempts
  const recentAttempts = attempts.filter(time => now - time < ATTEMPT_WINDOW);
  pairingAttempts.set(phoneNumber, recentAttempts);
  
  return recentAttempts.length < MAX_PAIRING_ATTEMPTS;
}

function recordPairingAttempt(phoneNumber) {
  const attempts = pairingAttempts.get(phoneNumber) || [];
  attempts.push(Date.now());
  pairingAttempts.set(phoneNumber, attempts);
}

// Get participant action text
function getParticipantActionText(participants, action) {
  const actionTexts = {
    'promote': 'promoted',
    'demote': 'demoted'
  };
  
  const actionText = actionTexts[action] || action;
  const participantNames = participants.map(p => `@${p.split('@')[0]}`).join(', ');
  
  return `${participantNames} ${actionText}`;
}

// Detect group status mention messages
function isGroupStatusMentionMessage(message) {
  return message?.groupStatusMentionMessage?.message?.protocolMessage !== undefined;
}

// Extract info from group status mention
function extractMentionInfo(message) {
  const mentionMsg = message.groupStatusMentionMessage;
  return {
    type: 'group_mention',
    protocolMessage: mentionMsg.message?.protocolMessage,
    timestamp: mentionMsg.messageTimestamp,
    key: mentionMsg.message?.key
  };
}

// Check if JID is a newsletter/channel
function isNewsletterJid(jid) {
  return jid && (jid.endsWith('@newsletter') || jid.includes('@newsletter') || jid.includes('broadcast'));
}

// Get uptime string
function getUptimeString() {
  if (!botStartTime) return 'Just started';
  
  const uptime = Date.now() - botStartTime;
  const seconds = Math.floor(uptime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Connection health monitoring
async function checkConnectionHealth(sock) {
  try {
    await sock.sendPresenceUpdate('available');
    return true;
  } catch (error) {
    console.error('❌ Connection health check failed:', error);
    return false;
  }
}

// Send connection notification to owner
async function sendConnectionNotification(sock, config) {
  if (!config.OWNER_JID) {
    console.log('⚠️ No OWNER_JID configured - skipping connection notification');
    return;
  }
  
  try {
    const timestamp = new Date().toLocaleString();
    const uptime = getUptimeString();
    
    const connectionMessage = `🤖 *Desire eXe Bot Connected!*
    
✅ *Status:* Online and Ready
🕒 *Connected At:* ${timestamp}
⏱️ *Uptime:* ${uptime}
🔗 *Session:* ${sock.authState.creds.registered ? 'Authenticated' : 'Not Registered'}
📱 *Platform:* ${sock.user?.platform || 'Unknown'}
🔄 *Reconnects:* ${reconnectCount}

The bot is now operational and listening for messages.`;

    await sock.sendMessage(config.OWNER_JID, {
      text: connectionMessage
    });
    
    console.log(`✅ Connection notification sent to owner: ${config.OWNER_JID}`);
  } catch (error) {
    console.error('❌ Failed to send connection notification:', error);
  }
}

// Generate QR Code as image
async function generateQRImage(qr) {
  try {
    const qrImage = await qrcode.toDataURL(qr);
    return qrImage;
  } catch (error) {
    console.error('❌ Failed to generate QR image:', error);
    return null;
  }
}

// Request pairing code from WhatsApp
async function requestPairingCode(phoneNumber) {
  if (!currentSock) {
    throw new Error('WhatsApp connection not initialized');
  }

  // Validate phone number format
  const formattedNumber = phoneNumber.replace(/\D/g, '');
  if (!formattedNumber.match(/^\d{10,15}$/)) {
    throw new Error('Invalid phone number format. Use 10-15 digits with country code');
  }

  // Check rate limiting
  if (!canRequestPairing(formattedNumber)) {
    throw new Error('Too many pairing attempts. Please wait before trying again.');
  }

  recordPairingAttempt(formattedNumber);

  try {
    console.log(`📱 Requesting pairing code for: ${formattedNumber}`);
    const code = await currentSock.requestPairingCode(formattedNumber);
    
    console.log(`✅ Pairing code received: ${code}`);
    pairingPhoneNumber = formattedNumber;
    pairingCode = code;

    // Auto-clear pairing code after 2 minutes
    setTimeout(() => {
      if (pairingCode === code) {
        console.log('⏰ Pairing code expired');
        pairingCode = null;
        pairingPhoneNumber = null;
      }
    }, 120000);

    return code;
  } catch (error) {
    console.error('❌ Failed to get pairing code:', error);
    
    // Provide more user-friendly error messages
    if (error.message.includes('rate limit')) {
      throw new Error('Too many attempts. Please wait before requesting another code.');
    } else if (error.message.includes('invalid')) {
      throw new Error('Invalid phone number. Please check the format.');
    } else {
      throw new Error(`Failed to get pairing code: ${error.message}`);
    }
  }
}

// Clear pairing code
function clearPairingCode() {
  pairingCode = null;
  pairingPhoneNumber = null;
  console.log('🧹 Pairing code cleared');
}

// Cleanup socket listeners
function cleanupSocket(sock) {
  if (sock) {
    try {
      sock.ev.removeAllListeners('connection.update');
      sock.ev.removeAllListeners('messages.upsert');
      sock.ev.removeAllListeners('group-participants.update');
      sock.ev.removeAllListeners('creds.update');
    } catch (error) {
      console.error('❌ Error cleaning up socket:', error);
    }
  }
  currentSock = null;
}

// Enhanced QR Code HTML page
function getQRPage() {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Desire eXe Bot - QR Code</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
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
            color: #333;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 2.2em;
            font-weight: 700;
        }
        .subtitle {
            color: #7f8c8d;
            margin-bottom: 30px;
            font-size: 1.1em;
        }
        .status {
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            font-weight: bold;
            font-size: 1.1em;
        }
        .qr-pending {
            background: #fff3cd;
            color: #856404;
            border: 2px solid #ffeaa7;
        }
        .connected {
            background: #d1ecf1;
            color: #0c5460;
            border: 2px solid #bee5eb;
        }
        .qr-image {
            max-width: 280px;
            margin: 25px auto;
            border: 3px solid #ddd;
            border-radius: 15px;
            padding: 15px;
            background: white;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        .instructions {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 12px;
            margin: 25px 0;
            text-align: left;
            border-left: 4px solid #3498db;
        }
        .instructions h3 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 1.2em;
        }
        .instructions ol {
            margin: 10px 0;
            padding-left: 25px;
        }
        .instructions li {
            margin-bottom: 12px;
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
        }
        .btn:hover {
            background: #0056b3;
            transform: translateY(-2px);
        }
        .btn-secondary {
            background: #95a5a6;
        }
        .btn-secondary:hover {
            background: #7f8c8d;
        }
        .nav-buttons {
            margin-top: 30px;
            display: flex;
            justify-content: center;
            flex-wrap: wrap;
            gap: 10px;
        }
        .uptime {
            margin-top: 25px;
            font-size: 0.9em;
            color: #7f8c8d;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .highlight {
            background: #fff3cd;
            padding: 3px 6px;
            border-radius: 4px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 Desire-eXe V1.0</h1>
        <p class="subtitle">QR Code Authentication</p>
        
        <div class="status ${qrCode ? 'qr-pending' : 'connected'}">
            ${qrCode ? '📱 QR Code Ready - Scan to Connect' : '✅ Bot Connected - No QR Needed'}
        </div>
        
        ${qrCode ? `
        <div class="qr-image">
            <img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 100%;">
        </div>
        
        <div class="instructions">
            <h3>📲 How to Connect with QR Code:</h3>
            <ol>
                <li>Open <span class="highlight">WhatsApp</span> on your phone</li>
                <li>Tap <span class="highlight">Settings</span> → <span class="highlight">Linked Devices</span></li>
                <li>Tap <span class="highlight">Link a Device</span></li>
                <li>Scan the QR code above with your phone</li>
                <li>Wait for connection confirmation</li>
            </ol>
        </div>
        
        <p><strong>⏰ QR Code will expire in 2 minutes</strong></p>
        ` : `
        <div style="font-size: 48px; margin: 20px 0;">✅</div>
        <h2>Bot is Connected!</h2>
        <p>The WhatsApp bot is successfully connected and running.</p>
        `}
        
        <div class="nav-buttons">
            <a href="/" class="btn btn-secondary">🏠 Home</a>
            <a href="/pairing" class="btn">🔢 Pairing Code</a>
            <a href="/status" class="btn btn-secondary">📊 Status</a>
            <a href="/health" class="btn btn-secondary">🛠️ Health</a>
        </div>
        
        <div class="uptime">
            ⏱️ Bot Uptime: ${getUptimeString()}
        </div>
    </div>
    
    <script>
        // Auto-refresh every 30 seconds if QR code is pending
        ${qrCode ? `
        setTimeout(() => {
            location.reload();
        }, 30000);
        ` : ''}
    </script>
</body>
</html>
  `;
}

// Main bot with enhanced features
async function startBot() {
  const config = loadConfig();
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let sock;

    // Set bot start time
    botStartTime = Date.now();

    // Backup auth state if enabled
    if (config.ENABLE_BACKUP) {
      backupAuthState();
    }

    try {
      sock = makeWASocket({
        auth: state,
        logger: P({ level: 'warn' }),
        
        // Enhanced connection options
        browser: ["Ubuntu", "Chrome", "120.0.0.0"],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 1000,
        maxRetries: 5,
        
        // Pairing code support
        generateHighQualityLinkPreview: false,
        patchMessageBeforeSending: (message) => {
          const requiresPatch = !!(
            message.buttonsMessage ||
            message.templateMessage ||
            message.listMessage
          );
          return requiresPatch;
        },
        
        emitOwnEvents: true,
        shouldIgnoreJid: jid => {
          return typeof jid === 'string' && (
            jid.endsWith('@bot') || 
            isNewsletterJid(jid)
          );
        },
        markOnlineOnConnect: true,
        syncFullHistory: false,
        linkPreviewImageThumbnailWidth: 200,
        getMessage: async (key) => {
          console.warn('⚠️ getMessage called for unknown message:', key.id);
          return null;
        }
      });

      // Store the socket globally for pairing code requests
      currentSock = sock;

    } catch (err) {
      console.error('❌ Failed to initialize socket:', err);
      throw err;
    }

    sock.ev.on('creds.update', saveCreds);

    // Enhanced connection update handler
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Handle QR Code
      if (qr) {
        console.log('📱 QR Code received - generating web QR...');
        qrCode = qr;
        qrCodeImage = await generateQRImage(qr);
        global.botStatus = 'qr_pending';
        isConnected = false;
        clearPairingCode(); // Clear any existing pairing code when QR is generated
        
        console.log('🌐 QR Code available at web interface');
        
        // Auto-clear QR after 2 minutes
        setTimeout(() => {
          if (!isConnected && qrCode === qr) {
            console.log('⏰ QR Code expired');
            qrCode = null;
            qrCodeImage = null;
          }
        }, 120000);
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message;
        
        console.log('🔌 Connection closed, code:', code, 'Error:', errorMessage);
        isConnected = false;
        qrCode = null;
        qrCodeImage = null;
        clearPairingCode();
        
        cleanupSocket(sock);
        
        // Enhanced reconnection logic with exponential backoff
        if (code === 428 || errorMessage?.includes('Connection Terminated')) {
          console.log('🔄 WhatsApp terminated connection - auto-reconnecting...');
          global.botStatus = 'reconnecting';
        }
        else if (code !== DisconnectReason.loggedOut) {
          console.log('⚠️ Connection closed - reconnecting...');
          global.botStatus = 'reconnecting';
        } else {
          console.log('🔒 Bot logged out - authentication required');
          global.botStatus = 'needs_auth';
          return;
        }
        
        // Exponential backoff with max limit
        const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectCount), 300000); // Max 5 minutes
        reconnectCount++;
        
        console.log(`🔄 Auto-reconnecting in ${delay/1000}s (attempt ${reconnectCount}/${MAX_RECONNECTS})`);
        
        if (reconnectCount >= MAX_RECONNECTS) {
          console.error('🚨 Max reconnection attempts reached. Restarting count.');
          reconnectCount = 0;
        }
        
        setTimeout(startBot, delay);
      }

      if (connection === 'open') {
        console.log('✅ Desire-eXe V1.0 Is Online!');
        isConnected = true;
        qrCode = null;
        qrCodeImage = null;
        clearPairingCode();
        reconnectCount = 0; // Reset reconnection counter
        global.botStatus = 'connected';
        global.connectionTime = new Date().toISOString();
        
        try {
          await sock.sendPresenceUpdate('available');
          await restoreActivePresence(sock);
        } catch (error) {
          console.log('⚠️ Presence update failed (normal during connection):', error.message);
        }
        
        // Log performance
        logPerformance('connection_success', {
          timestamp: new Date().toISOString(),
          reconnectCount: reconnectCount
        });
        
        await sendConnectionNotification(sock, config);
      }

      if (connection === 'connecting') {
        console.log('🔄 Connecting to WhatsApp...');
        isConnected = false;
        global.botStatus = 'connecting';
      }
    });

    loadContactsFromFile();

    // Remove old listeners
    sock.ev.removeAllListeners('messages.upsert');
    sock.ev.removeAllListeners('group-participants.update');

    // Enhanced message handler
    sock.ev.on('messages.upsert', async ({ messages }) => {
      if (!isConnected) return;
      
      await delay(100);
      let msg;

      try {
        msg = messages[0];
        const jid = msg.key.remoteJid;
        
        if (isNewsletterJid(jid)) {
          console.log('📰 Ignoring newsletter/channel message from:', jid);
          return;
        }
        
        if (!msg.message || jid === 'status@broadcast' || jid.endsWith('@bot')) return;

        // 🔧 FIX: Use the unwrapMessage function that's now defined
        msg.message = unwrapMessage(msg.message);

        if (isGroupStatusMentionMessage(msg.message)) {
          console.log('🔔 Group mention detected:', jid);
          
          const configFile = './src/antimention.json';
          if (fs.existsSync(configFile)) {
            const config = JSON.parse(fs.readFileSync(configFile));
            
            if (config[jid]?.enabled) {
              const mentionInfo = extractMentionInfo(msg.message);
              const mentionUser = msg.key.participant || msg.key.remoteJid;
              
              try {
                await sock.sendMessage(jid, {
                  delete: msg.key
                });
                console.log(`🗑️ Deleted mention message from ${mentionUser} in ${jid}`);
              } catch (deleteError) {
                console.error('❌ Failed to delete mention message:', deleteError);
              }
              
              await sock.sendMessage(jid, {
                text: `⚠️ *Mention Warning!*\n\n@${mentionUser.split('@')[0]} Please avoid mentioning everyone in the group.\n\n🚫 Mass mentions are not allowed and will be deleted automatically.`,
                mentions: [mentionUser]
              });

              logBugIncident(jid, 'group_mention', `User ${mentionUser} mentioned everyone - MESSAGE DELETED`);
              return;
            }
          }
        }

        if (!jid.endsWith('@g.us') && !jid.endsWith('@broadcast') && !isNewsletterJid(jid)) {
          if (isDangerousText(msg.message)) {
            console.warn(`🚨 Bug-like TEXT from ${jid}`);
            await sock.sendMessage(jid, { text: '⚠️' });
            await sock.updateBlockStatus(jid, 'block');
            logBugIncident(jid, 'text', JSON.stringify(msg.message).slice(0, 500));
            if (config.OWNER_JID) {
              await sock.sendMessage(config.OWNER_JID, {
                text: `🚨 Bug alert\nFrom: ${jid}\nType: Text\nAction: Blocked`
              });
            }
            return;
          }
        }

        if (jid && !jid.endsWith('@g.us') && !isNewsletterJid(jid)) {
          const known = contactList.find(c => c.jid === jid);
          if (!known) {
            if (config.AUTO_BLOCK_UNKNOWN) {
              console.log(`🚫 Unknown contact blocked: ${jid}`);
              await sock.updateBlockStatus(jid, 'block');
              return;
            }
            const name = msg.pushName || 'Unknown';
            contactList.push({ jid, name, firstSeen: new Date().toISOString() });
            saveContactsToFile();
            console.log(`➕ Saved: ${name} (${jid})`);
          }
        }

        console.log('📩 Message received from:', jid);
        await MessageHandler(sock, messages, contactList);
      } catch (err) {
        console.error('❌ Message handler error:', err);
        // 🔧 FIX: Add proper error handling for message acknowledgment
        if (msg && msg.key && msg.key.id) {
          try {
            await sock.sendMessageAck(msg.key);
          } catch (ackError) {
            console.error('❌ Failed to send message ack:', ackError);
          }
        }
      }
    });

    // Enhanced group participants update handler
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
      if (!isConnected) return;
      
      if (isNewsletterJid(id)) {
        console.log('📰 Ignoring newsletter/channel participant update:', id);
        return;
      }
      
      console.log(`👥 Group update in ${id}: ${action} - ${participants.join(', ')}`);
      
      const now = new Date();
      const date = now.toLocaleDateString('en-GB').replace(/\//g, '-');
      const time = now.toLocaleTimeString('en-US', { hour12: false });
      
      if (action === 'promote' || action === 'demote') {
        try {
          const configFile = action === 'promote' ? './src/promote.json' : './src/demote.json';
          
          if (fs.existsSync(configFile)) {
            const configData = JSON.parse(fs.readFileSync(configFile));
            
            if (configData[id]?.enabled) {
              const customMessage = configData[id]?.message || 
                (action === 'promote' ? "👑 @user has been promoted to admin!" : "🔻 @user has been demoted from admin!");
              
              for (const user of participants) {
                const userMessage = customMessage.replace(/@user/g, `@${user.split('@')[0]}`);
                const messageText = `${userMessage}\n🕒 ${time}, ${date}`;
                
                await sock.sendMessage(id, {
                  text: messageText,
                  mentions: [user]
                });
              }
              
              console.log(`✅ ${action} notification sent for ${participants.join(', ')} in ${id}`);
            }
          } else {
            const actionText = action === 'promote' ? '👑 Promoted to Admin' : '🔻 Demoted from Admin';
            const messageText = `*${actionText}*\n👤 User: ${getParticipantActionText(participants, action)}\n🕒 Time: ${time}, ${date}`;
            
            await sock.sendMessage(id, {
              text: messageText,
              mentions: participants
            });
          }
          
        } catch (error) {
          console.error(`❌ Error sending ${action} notification:`, error);
        }
        return;
      }

      // Welcome new members
      if (action === 'add') {
        const welcomeFile = './src/welcome.json';
        if (!fs.existsSync(welcomeFile)) return;
        
        let welcomeData = {};
        try {
          welcomeData = JSON.parse(fs.readFileSync(welcomeFile));
        } catch (e) {
          console.error('❌ Failed to load welcome data:', e);
          return;
        }
        
        if (!welcomeData[id]?.enabled) return;

        for (const user of participants) {
          try {
            const userJid = typeof user === 'string' ? user : user.id || user.jid;
            
            if (!userJid) {
              console.log('⚠️ Could not extract JID from:', user);
              continue;
            }

            let pfpUrl;
            try {
              pfpUrl = await sock.profilePictureUrl(userJid, 'image');
            } catch {
              pfpUrl = 'https://i.imgur.com/1s6Qz8v.png';
            }

            const userDisplay = userJid.split('@')[0];
            const welcomeText = (welcomeData[id]?.message || '👋 Welcome @user!')
              .replace(/@user/g, `@${userDisplay}`);

            try {
              await sock.sendMessage(id, {
                ...(pfpUrl && { image: { url: pfpUrl } }),
                caption: welcomeText,
                mentions: [userJid]
              });
            } catch (e) {
              await sock.sendMessage(id, {
                text: welcomeText,
                mentions: [userJid]
              });
            }
          } catch (error) {
            console.error('❌ Error processing welcome for user:', user, error);
          }
        }
      }
      
      // Goodbye for removed members
      if (action === 'remove') {
        const settingsFile = './src/group_settings.json';
        if (!fs.existsSync(settingsFile)) return;

        let settings = {};
        try {
          settings = JSON.parse(fs.readFileSync(settingsFile));
        } catch (e) {
          console.error('❌ Failed to load group settings:', e);
          return;
        }
        
        if (!settings[id]?.goodbyeEnabled) return;

        for (const user of participants) {
          try {
            const userJid = typeof user === 'string' ? user : user.id || user.jid;
            if (!userJid) continue;

            const userDisplay = userJid.split('@')[0];
            const goodbyeText = `👋 Goodbye @${userDisplay}!\n⌚ Left at: ${time}, ${date}\nToo Bad We Won't Miss You! 💔`;

            let pfpUrl;
            try {
              pfpUrl = await sock.profilePictureUrl(userJid, 'image');
            } catch {
              pfpUrl = 'https://i.imgur.com/1s6Qz8v.png';
            }

            try {
              await sock.sendMessage(id, {
                ...(pfpUrl && { image: { url: pfpUrl } }),
                caption: goodbyeText,
                mentions: [userJid]
              });
            } catch (e) {
              await sock.sendMessage(id, {
                text: goodbyeText,
                mentions: [userJid]
              });
            }
          } catch (error) {
            console.error('❌ Error processing goodbye for user:', user, error);
          }
        }
      }
    });

    // Periodic health checks
    setInterval(async () => {
      if (isConnected && sock) {
        const isHealthy = await checkConnectionHealth(sock);
        if (!isHealthy) {
          console.log('🩺 Connection unhealthy, attempting reconnect...');
          isConnected = false;
          startBot();
        }
      }
    }, 30000); // Check every 30 seconds

    // Periodic backup if enabled
    if (config.ENABLE_BACKUP) {
      setInterval(backupAuthState, config.BACKUP_INTERVAL);
    }

    return sock;
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
    
    // Enhanced error recovery with exponential backoff
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectCount), 300000);
    reconnectCount++;
    
    console.log(`🔄 Auto-restarting in ${delay/1000}s (attempt ${reconnectCount}/${MAX_RECONNECTS})`);
    
    if (reconnectCount >= MAX_RECONNECTS) {
      console.error('🚨 Max restart attempts reached. Restarting count.');
      reconnectCount = 0;
    }
    
    setTimeout(startBot, delay);
    return null;
  }
}

// Export functions for use in app.js
module.exports = { 
  startBot, 
  getQRPage, 
  getQRCode: () => ({ 
    qrCode, 
    qrCodeImage, 
    isConnected, 
    pairingCode, 
    pairingPhoneNumber,
    reconnectCount,
    uptime: getUptimeString()
  }),
  requestPairingCode,
  clearPairingCode,
  getUptimeString
};
