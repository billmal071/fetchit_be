#!/bin/bash

# Server Setup Script for FetchIt Backend
# Run this script on your Ubuntu server for initial setup
# Usage: bash server-setup.sh

set -euo pipefail

echo "=== FetchIt Backend Server Setup ==="

# ── System packages ──────────────────────────────────────────────────────────
echo "[1/7] Updating system packages..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx ufw certbot python3-certbot-nginx

# ── Firewall ─────────────────────────────────────────────────────────────────
echo "[2/7] Configuring ufw firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status verbose

# ── Node.js via nvm ──────────────────────────────────────────────────────────
echo "[3/7] Installing Node.js 20 via nvm..."
if [ ! -d "$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install 20
nvm use 20
nvm alias default 20

# Make node/npm available system-wide for PM2
NODE_PATH=$(nvm which current)
sudo ln -sf "$NODE_PATH" /usr/local/bin/node
sudo ln -sf "$(dirname "$NODE_PATH")/npm" /usr/local/bin/npm

# ── pnpm ─────────────────────────────────────────────────────────────────────
echo "[4/7] Installing pnpm..."
npm install -g pnpm

# ── PM2 ──────────────────────────────────────────────────────────────────────
echo "[5/7] Installing PM2..."
npm install -g pm2

# Set up PM2 to start on boot
pm2 startup systemd -u "$USER" --hp "$HOME"
sudo env PATH="$PATH:$(dirname "$NODE_PATH")" \
  pm2 startup systemd -u "$USER" --hp "$HOME"

# ── Application directory ─────────────────────────────────────────────────────
APP_DIR="${APP_PATH:-$HOME/fetchit/be}"
echo "[6/7] Creating application directory at $APP_DIR..."
mkdir -p "$APP_DIR/logs"

# ── Nginx ─────────────────────────────────────────────────────────────────────
echo "[7/7] Configuring Nginx..."
echo "  → Copy scripts/nginx.conf to /etc/nginx/sites-available/fetchit"
echo "  → Replace 'your-domain.com' with your actual domain"
echo "  → Run: sudo ln -s /etc/nginx/sites-available/fetchit /etc/nginx/sites-enabled/"
echo "  → Run: sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "  → Then obtain SSL certificate:"
echo "     sudo certbot --nginx -d your-domain.com"
echo "     (Certbot will auto-update nginx.conf for SSL)"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy your application files to $APP_DIR"
echo "  2. Create $APP_DIR/.env (see .env.example)"
echo "  3. Configure and enable Nginx (see above)"
echo "  4. Run: cd $APP_DIR && pnpm install --prod && pnpm db:migrate:deploy"
echo "  5. Run: pm2 start ecosystem.config.js --env production && pm2 save"
echo ""
