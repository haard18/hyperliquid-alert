#!/bin/bash

# Hyperliquid Breakout Detector - Docker Quick Start Script

set -e

echo "🐳 Hyperliquid Breakout Detector - Docker Setup"
echo "================================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first:"
    echo "   https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✓ Docker is installed"
echo "✓ Docker Compose is installed"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.docker template..."
    cp .env.docker .env
    echo "✓ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env file and add your Telegram credentials:"
    echo "   - TELEGRAM_BOT_TOKEN"
    echo "   - TELEGRAM_CHAT_ID"
    echo ""
    echo "   See TELEGRAM_SETUP.md for instructions on getting these values."
    echo ""
    read -p "Press Enter when you've updated .env file..."
else
    echo "✓ .env file already exists"
fi

echo ""
echo "🔨 Building Docker images..."
docker-compose build

echo ""
echo "🚀 Starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

echo ""
echo "📊 Checking service status..."
docker-compose ps

echo ""
echo "✅ Setup complete!"
echo ""
echo "📖 Useful commands:"
echo "   View logs:           docker-compose logs -f"
echo "   Stop services:       docker-compose down"
echo "   Restart services:    docker-compose restart"
echo "   View status:         docker-compose ps"
echo ""
echo "📚 For more information, see DOCKER.md"
echo ""
echo "🎉 Your breakout detector is now running!"
