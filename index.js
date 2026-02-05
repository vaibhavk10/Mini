/**
 * WhatsApp MD Bot - Main Entry Point
 */

// CRITICAL: Initialize temp system BEFORE any libraries that use temp directories
// This must happen before Baileys, ffmpeg, or any other library loads
const { initializeTempSystem } = require('./utils/tempManager');
const { startCleanup } = require('./utils/cleanup');

// Initialize temp directory and set environment variables
initializeTempSystem();
// Start cleanup system (runs at startup and every 10 minutes)
startCleanup();

// Now safe to load libraries that might use temp directories
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const handler = require('./handler');
const fs = require('fs');
const path = require('path');

// Simple in-memory store (without makeInMemoryStore)
const store = {
  messages: {},
  bind: (ev) => {
    // Store messages from both notify and append events
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (msg.key && msg.key.id) {
          const jid = msg.key.remoteJid;
          if (!store.messages[jid]) store.messages[jid] = {};
          store.messages[jid][msg.key.id] = msg;
        }
      }
    });
  },
  loadMessage: async (jid, id) => {
    return store.messages[jid]?.[id] || null;
  }
};

// Message processing tracker for deduplication
const processedMessages = new Set();

// Main connection function
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(`./${config.sessionName}`);
  
  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    auth: state,
    getMessage: async (key) => {
      const msg = await store.loadMessage(key.remoteJid, key.id);
      return msg?.message || undefined;
    }
  });
  
  // Suppress Signal protocol and session logs by intercepting console
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  console.log = (...args) => {
    const message = args.map(a => typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (!message.includes('Closing session') && 
        !message.includes('SessionEntry') && 
        !message.includes('Closing open session') && 
        !message.includes('prekey bundle') &&
        !message.includes('_chains') &&
        !message.includes('registrationId') &&
        !message.includes('currentRatchet') &&
        !message.includes('chainKey') &&
        !message.includes('ratchet') &&
        !message.includes('signal protocol') &&
        !message.includes('ephemeralKeyPair') &&
        !message.includes('indexInfo') &&
        !message.includes('pendingPreKey')) {
      originalConsoleLog.apply(console, args);
    }
  };
  
  console.error = (...args) => {
    const message = args.map(a => typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (!message.includes('Closing session') && 
        !message.includes('SessionEntry') && 
        !message.includes('signal protocol')) {
      originalConsoleError.apply(console, args);
    }
  };
  
  console.warn = (...args) => {
    const message = args.map(a => typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (!message.includes('Closing session') && 
        !message.includes('SessionEntry')) {
      originalConsoleWarn.apply(console, args);
    }
  };
  
  // Bind store to socket
  store.bind(sock.ev);
  
  // Connection update handler
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('\n\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
      
      // Suppress verbose error output for common stream errors (515, etc.)
      if (statusCode === 515 || statusCode === 503 || statusCode === 408) {
        console.log(`⚠️ Connection closed (${statusCode}). Reconnecting...`);
      } else {
        console.log('Connection closed due to:', errorMessage, '\nReconnecting:', shouldReconnect);
      }
      
      if (shouldReconnect) {
        setTimeout(() => startBot(), 3000);
      }
    } else if (connection === 'open') {
      console.log('\n✅ Bot connected successfully!');
      console.log(`📱 Bot Number: ${sock.user.id.split(':')[0]}`);
      console.log(`🤖 Bot Name: ${config.botName}`);
      console.log(`⚡ Prefix: ${config.prefix}`);
      const ownerNames = Array.isArray(config.ownerName) ? config.ownerName.join(',') : config.ownerName;
      console.log(`👑 Owner: ${ownerNames}\n`);
      console.log('Bot is ready to receive messages!\n');
      
      // Set bot status
      if (config.autoBio) {
        await sock.updateProfileStatus(`${config.botName} | Active 24/7`);
      }
      
      // Initialize anti-call feature
      handler.initializeAntiCall(sock);
    }
  });
  
  // Credentials update handler
  sock.ev.on('creds.update', saveCreds);
  
  // System JID filter - checks if JID is from broadcast/status/newsletter
  const isSystemJid = (jid) => {
    if (!jid) return true;
    return jid.includes('@broadcast') || 
           jid.includes('status.broadcast') || 
           jid.includes('@newsletter') ||
           jid.includes('@newsletter.');
  };
  
  // Messages handler - Process only new messages
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // Only process "notify" type (new messages), skip "append" (old messages from history)
    if (type !== 'notify') return;
    
    // Process messages in the array
    for (const msg of messages) {
      // Skip if message is invalid or missing key
      if (!msg.message || !msg.key?.id) continue;
      
      // Skip messages from bot itself to prevent feedback loops
      // Note: Owner commands work fine because owner messages have fromMe=false
      // Only messages sent BY the bot itself have fromMe=true
      // if (msg.key.fromMe) continue;
      
      const from = msg.key.remoteJid;
      
      // Skip if from is null/undefined
      if (!from) {
        continue;
      }
      
      // System message filter - ignore broadcast/status/newsletter messages
      if (isSystemJid(from)) {
        continue; // Silently ignore system messages
      }
      
      // Deduplication: Skip if message has already been processed
      const msgId = msg.key.id;
      if (processedMessages.has(msgId)) continue;
      
      // Timestamp validation: Only process messages within last 5 minutes
      const MESSAGE_AGE_LIMIT = 5 * 60 * 1000; // 5 minutes in milliseconds
      if (msg.messageTimestamp) {
        const messageAge = Date.now() - (msg.messageTimestamp * 1000);
        if (messageAge > MESSAGE_AGE_LIMIT) {
          // Message is too old, skip processing
          continue;
        }
      }
      
      // Mark message as processed
      processedMessages.add(msgId);
      
      // Store message FIRST (before processing)
      // from already defined above in DM block check
      if (msg.key && msg.key.id) {
        if (!store.messages[from]) store.messages[from] = {};
        store.messages[from][msg.key.id] = msg;
      }
      
      // Process command IMMEDIATELY (don't block on other operations)
      handler.handleMessage(sock, msg).catch(err => {
        if (!err.message?.includes('rate-overlimit') && 
            !err.message?.includes('not-authorized')) {
          console.error('Error handling message:', err.message);
        }
      });
      
      // Do other operations in background (non-blocking)
      setImmediate(async () => {
        // Auto-read messages (only for groups - DMs already blocked above)
        // from already defined above in DM block check
        if (config.autoRead && from.endsWith('@g.us')) {
          try {
            await sock.readMessages([msg.key]);
          } catch (e) {
            // Silently handle
          }
        }
        
        // Check for antilink (only for groups)
        // from already defined above in DM block check, and we know it's a group
        if (from.endsWith('@g.us')) {
          try {
            const groupMetadata = await handler.getGroupMetadata(sock, msg.key.remoteJid);
            if (groupMetadata) {
              await handler.handleAntilink(sock, msg, groupMetadata);
            }
          } catch (error) {
            // Silently handle
          }
        }
      });
    }
  });
  
  // Message receipt updates (silently handled, no logging)
  sock.ev.on('message-receipt.update', () => {
    // Silently handle receipt updates
  });
  
  // Message updates (silently handled, no logging)
  sock.ev.on('messages.update', () => {
    // Silently handle message updates
  });
  
  // Group participant updates (join/leave)
  sock.ev.on('group-participants.update', async (update) => {
    await handler.handleGroupUpdate(sock, update);
  });
  
  // Handle errors - suppress common stream errors
  sock.ev.on('error', (error) => {
    const statusCode = error?.output?.statusCode;
    // Suppress verbose output for common stream errors
    if (statusCode === 515 || statusCode === 503 || statusCode === 408) {
      // These are usually temporary connection issues, handled by reconnection
      return;
    }
    console.error('Socket error:', error.message || error);
  });
  
  return sock;
}

// Start the bot
console.log('🚀 Starting WhatsApp MD Bot...\n');
console.log(`📦 Bot Name: ${config.botName}`);
console.log(`⚡ Prefix: ${config.prefix}`);
const ownerNames = Array.isArray(config.ownerName) ? config.ownerName.join(',') : config.ownerName;
console.log(`👑 Owner: ${ownerNames}\n`);

startBot().catch(err => {
  console.error('Error starting bot:', err);
  process.exit(1);
});

// Handle process termination
process.on('uncaughtException', (err) => {
  // Handle ENOSPC errors gracefully without crashing
  if (err.code === 'ENOSPC' || err.errno === -28 || err.message?.includes('no space left on device')) {
    console.error('⚠️ ENOSPC Error: No space left on device. Attempting cleanup...');
    const { cleanupOldFiles } = require('./utils/cleanup');
    cleanupOldFiles();
    console.warn('⚠️ Cleanup completed. Bot will continue but may experience issues until space is freed.');
    return; // Don't crash, just log and continue
  }
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  // Handle ENOSPC errors gracefully
  if (err.code === 'ENOSPC' || err.errno === -28 || err.message?.includes('no space left on device')) {
    console.warn('⚠️ ENOSPC Error in promise: No space left on device. Attempting cleanup...');
    const { cleanupOldFiles } = require('./utils/cleanup');
    cleanupOldFiles();
    console.warn('⚠️ Cleanup completed. Bot will continue but may experience issues until space is freed.');
    return; // Don't crash, just log and continue
  }
  
  // Don't spam console with rate limit errors
  if (err.message && err.message.includes('rate-overlimit')) {
    console.warn('⚠️ Rate limit reached. Please slow down your requests.');
    return;
  }
  console.error('Unhandled Rejection:', err);
});

// Export store for use in commands
module.exports = { store };
