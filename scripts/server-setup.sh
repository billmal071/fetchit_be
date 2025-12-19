#!/bin/bash

# Server Setup Script for FetchIt Backend
# Run this script on your Ubuntu server for initial setup

set -e

echo "=== FetchIt Backend Server Setup ==="

# Update system packages
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install essential packages
echo "Installing essential packages..."
sudo apt install -y curl git build-essential

# Install Node.js 20.x via NodeSource
echo "Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm globally
echo "Installing pnpm..."
npm install -g pnpm

# Install PM2 globally
echo "Installing PM2..."
npm install -g pm2

# Setup PM2 to start on boot
echo "Setting up PM2 startup..."
pm2 startup systemd -u $USER --hp $HOME
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

# Create application directory
APP_DIR="${APP_PATH:-$HOME/fetchit/be}"
echo "Creating application directory at $APP_DIR..."
mkdir -p $APP_DIR

# Create logs directory
echo "Creating logs directory..."
mkdir -p $APP_DIR/logs

echo ""
echo "=== Setup Complete ==="
echo ""
