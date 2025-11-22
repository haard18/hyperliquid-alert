#!/bin/bash

# Docker Dual Model Manager
# Easy management of both Model-1 and Model-2 in Docker

set -e

COMPOSE_FILE="docker-compose.dual-model.yml"

function show_help() {
    cat << EOF
Docker Dual Model Manager - Run Model-1 & Model-2 Together

Usage: ./docker-dual.sh [command]

Commands:
    start       Start both models (Model-1 + Model-2)
    stop        Stop both models
    restart     Restart both models
    logs        View logs (all containers)
    logs-m1     View Model-1 logs only
    logs-m2     View Model-2 logs only
    status      Show container status
    build       Rebuild and start
    down        Stop and remove containers
    clean       Stop, remove containers, and delete volumes
    test-m2     Run Model-2 test cycle
    backtest    Run Model-2 backtest
    redis       Open Redis CLI
    shell-m1    Open shell in Model-1 container
    shell-m2    Open shell in Model-2 container
    stats       Show resource usage

Examples:
    ./docker-dual.sh start          # Start both models
    ./docker-dual.sh logs           # View all logs
    ./docker-dual.sh logs-m2        # View Model-2 logs only
    ./docker-dual.sh test-m2        # Test Model-2

EOF
}

function check_env() {
    if [ ! -f .env ]; then
        echo "⚠️  Warning: .env file not found!"
        echo "Create .env with:"
        echo "  TELEGRAM_BOT_TOKEN=your_token"
        echo "  TELEGRAM_CHAT_ID=your_chat_id"
        exit 1
    fi
}

case "${1:-}" in
    start)
        echo "🚀 Starting both models..."
        check_env
        docker-compose -f $COMPOSE_FILE up -d
        echo "✅ Started! View logs with: ./docker-dual.sh logs"
        ;;
    
    stop)
        echo "⏸️  Stopping both models..."
        docker-compose -f $COMPOSE_FILE stop
        echo "✅ Stopped!"
        ;;
    
    restart)
        echo "🔄 Restarting both models..."
        docker-compose -f $COMPOSE_FILE restart
        echo "✅ Restarted!"
        ;;
    
    logs)
        echo "📋 Showing logs (Ctrl+C to exit)..."
        docker-compose -f $COMPOSE_FILE logs -f
        ;;
    
    logs-m1)
        echo "📋 Model-1 logs (Ctrl+C to exit)..."
        docker-compose -f $COMPOSE_FILE logs -f model1-breakout
        ;;
    
    logs-m2)
        echo "📋 Model-2 logs (Ctrl+C to exit)..."
        docker-compose -f $COMPOSE_FILE logs -f model2-intraday
        ;;
    
    status)
        echo "📊 Container Status:"
        docker-compose -f $COMPOSE_FILE ps
        ;;
    
    build)
        echo "🔨 Building and starting..."
        check_env
        docker-compose -f $COMPOSE_FILE up -d --build
        echo "✅ Built and started!"
        ;;
    
    down)
        echo "🛑 Stopping and removing containers..."
        docker-compose -f $COMPOSE_FILE down
        echo "✅ Containers removed!"
        ;;
    
    clean)
        echo "🧹 Cleaning up (containers + volumes)..."
        read -p "This will delete all data. Continue? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker-compose -f $COMPOSE_FILE down -v
            echo "✅ Cleaned!"
        else
            echo "Cancelled."
        fi
        ;;
    
    test-m2)
        echo "🧪 Running Model-2 test cycle..."
        docker-compose -f $COMPOSE_FILE run --rm model2-intraday node dist/intradayMain.js test
        ;;
    
    backtest)
        echo "📊 Running Model-2 backtest..."
        docker-compose -f $COMPOSE_FILE run --rm model2-intraday node dist/intradayMain.js backtest
        ;;
    
    redis)
        echo "💾 Opening Redis CLI (type 'exit' to quit)..."
        docker exec -it hyperliquid-redis redis-cli
        ;;
    
    shell-m1)
        echo "🐚 Opening Model-1 shell..."
        docker exec -it hyperliquid-model1 sh
        ;;
    
    shell-m2)
        echo "🐚 Opening Model-2 shell..."
        docker exec -it hyperliquid-model2 sh
        ;;
    
    stats)
        echo "📈 Resource Usage:"
        docker stats --no-stream hyperliquid-redis hyperliquid-model1 hyperliquid-model2 2>/dev/null || \
            echo "⚠️  Some containers are not running"
        ;;
    
    help|--help|-h|"")
        show_help
        ;;
    
    *)
        echo "❌ Unknown command: $1"
        echo "Run './docker-dual.sh help' for usage"
        exit 1
        ;;
esac

