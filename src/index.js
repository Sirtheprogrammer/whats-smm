require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const whatsappBot = require('./bot/whatsapp');
const adminRoutes = require('./routes/admin');
const adminUiRoutes = require('./routes/admin.ui');
const dashboardRoutes = require('./routes/dashboard.ui');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Routes
app.use('/admin', adminRoutes);
app.use('/admin/ui', adminUiRoutes);
app.use('/admin', dashboardRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Initialize MongoDB connection
async function initMongoDB(retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`📦 Connecting to MongoDB (attempt ${attempt}/${retries})...`);
            
            await mongoose.connect(process.env.MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000, // 5 second timeout
                heartbeatFrequencyMS: 2000 // Check server every 2 seconds
            });
            
            console.log('📦 MongoDB connected successfully');
            
            // Add connection error handler
            mongoose.connection.on('error', (error) => {
                console.error('❌ MongoDB connection error:', error);
            });

            mongoose.connection.on('disconnected', () => {
                console.warn('⚠️ MongoDB disconnected. Attempting to reconnect...');
            });

            mongoose.connection.on('reconnected', () => {
                console.log('📦 MongoDB reconnected');
            });
            
            return true;
        } catch (error) {
            console.error(`❌ MongoDB connection attempt ${attempt}/${retries} failed:`, error);
            
            if (attempt === retries) {
                console.error('❌ All MongoDB connection attempts failed. Exiting...');
                process.exit(1);
            }
            
            // Wait for 2 seconds before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Initialize WhatsApp bot
async function initWhatsAppBot() {
    try {
        await whatsappBot.init();
        console.log('📱 WhatsApp bot initialized');
        
        // Message handler for basic commands
        whatsappBot.onMessage(async ({ from, text }) => {
            console.log(`📨 Message from ${from}: ${text}`);
            
            if (text.toLowerCase() === 'ping') {
                await whatsappBot.sendMessage(from, '🏓 Pong!');
            } else if (text.toLowerCase() === 'status') {
                const status = whatsappBot.getConnectionStatus();
                await whatsappBot.sendMessage(from, `📊 Bot Status:\n- Connected: ${status.isConnected ? '✅' : '❌'}\n- State: ${status.status}`);
            }
        });

        // Log QR code updates
        whatsappBot.onQRCode(qr => {
            console.log('📱 New QR code generated for WhatsApp connection');
        });

        // Log status updates
        whatsappBot.onStatusUpdate(status => {
            console.log(`📊 WhatsApp connection status: ${status.status}`);
        });

    } catch (error) {
        console.error('❌ WhatsApp bot initialization error:', error);
        process.exit(1);
    }
}

// Start server
async function startServer() {
    await initMongoDB();
    await initWhatsAppBot();
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
}

startServer().catch(console.error);
