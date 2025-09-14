
# WhatsApp SMM Bot

A WhatsApp bot for Social Media Marketing (SMM) services with integrated payment processing.

## 🚀 Features

- WhatsApp connection using pairing code (no QR scan needed)
- Session persistence
- Admin API endpoints for bot control
- Integration with SMM services
- Secure payment processing

## 📋 Prerequisites

- Node.js v16 or higher
- MongoDB v4.4 or higher
- npm or yarn

## 🛠️ Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/whats-smm.git
   cd whats-smm
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment file and configure:
   ```bash
   cp src/.env.example .env
   ```

4. Update the `.env` file with your credentials:
   - Set `ADMIN_TOKEN` for API security
   - Configure MongoDB connection string
   - Add API keys for SMM and payment services

## 🏃‍♂️ Running the Bot

1. Start the server:
   ```bash
   npm run dev   # Development with hot reload
   # or
   npm start     # Production
   ```

2. The server will start on the configured port (default: 3000)

## 📱 WhatsApp Pairing Process

1. Request pairing status:
   ```bash
   curl -H "x-admin-token: your_admin_token" http://localhost:3000/admin/pairing
   ```

2. Get pairing code:
   ```bash
   curl -X POST \\
        -H "Content-Type: application/json" \\
        -H "x-admin-token: your_admin_token" \\
        -d '{"phoneNumber": "255123456789"}' \\
        http://localhost:3000/admin/pairing/confirm
   ```

3. Enter the received code in your WhatsApp mobile app:
   - Open WhatsApp
   - Go to Settings > Linked Devices
   - Click "Link Device"
   - Enter the pairing code

4. Test sending a message:
   ```bash
   curl -X POST \\
        -H "Content-Type: application/json" \\
        -H "x-admin-token: your_admin_token" \\
        -d '{"to": "255123456789", "message": "🎉 Hello from WhatsApp SMM Bot!"}' \\
        http://localhost:3000/admin/send
   ```

## 🔍 Troubleshooting

### WhatsApp Connection Issues

1. Check the logs for connection errors:
   ```bash
   tail -f logs/whatsapp.log
   ```

2. Verify session files:
   ```bash
   ls -l wa-sessions/
   ```

3. Common issues:
   - Invalid phone number format (must include country code)
   - Expired or invalid pairing code
   - Network connectivity problems
   - Rate limiting from WhatsApp

### Security Checklist

- [x] Admin token validation
- [x] Secure session storage
- [x] Environment variable protection
- [x] Input validation
- [x] Rate limiting setup (TODO)
- [x] Error logging
- [x] Sanitized error responses

## 📄 License

MIT

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
