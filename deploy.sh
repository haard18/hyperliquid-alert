#!/bin/bash

# Production Deployment Script
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Config
IMAGE_NAME="hardy18/breakout-watcher"
COMPOSE_FILE="docker-compose.prod.yml"

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_requirements() {
    echo_info "Checking requirements..."

    if ! command -v docker &> /dev/null; then
        echo_error "Docker is not installed"
        exit 1
    fi

    if docker buildx version &> /dev/null; then
        echo_info "✓ Docker buildx detected"
        USE_BUILDX=true
    else
        echo_warn "Docker buildx NOT found — falling back to standard build"
        USE_BUILDX=false
    fi

    if [ ! -f .env ]; then
        echo_error ".env file not found"
        echo_info "Create .env with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID"
        exit 1
    fi

    echo_info "✓ Requirements check passed"
}

build_and_push() {
    local TAG=${1:-latest}

    echo_info "Building Docker image for linux/amd64..."
    echo_info "Image: ${IMAGE_NAME}:${TAG}"

    echo_info "Building TypeScript..."
    npm run build

    if [ "$USE_BUILDX" = true ]; then
        echo_info "Using buildx to build multi-platform image..."
        docker buildx build \
            --platform linux/amd64 \
            --tag ${IMAGE_NAME}:${TAG} \
            --push \
            --progress=plain \
            .
    else
        echo_warn "Using standard docker build (NOT multi-platform)..."
        docker build --platform linux/amd64 -t ${IMAGE_NAME}:${TAG} .
        docker push ${IMAGE_NAME}:${TAG}
    fi

    echo_info "✓ Image built and pushed successfully"
}

deploy() {
    echo_info "Deploying to production..."
    echo_info "Pulling latest image..."

    docker pull ${IMAGE_NAME}:latest

    echo_info "Stopping existing containers..."
    docker compose -f ${COMPOSE_FILE} down || true

    echo_info "Starting containers..."
    docker compose -f ${COMPOSE_FILE} up -d

    echo_info "Waiting 10s for health checks..."
    sleep 10

    docker compose -f ${COMPOSE_FILE} ps

    echo_info "✓ Deployment complete"
}

show_logs() {
    echo_info "Showing logs..."
    docker compose -f ${COMPOSE_FILE} logs -f
}

show_status() {
    echo_info "Container Status:"
    docker compose -f ${COMPOSE_FILE} ps

    echo_info "Resource Usage:"
    docker stats --no-stream hyperliquid-redis hyperliquid-model1 hyperliquid-model2 2>/dev/null || \
        echo_warn "Some containers not running"
}

rollback() {
    local TAG=$1
    if [ -z "$TAG" ]; then
        echo_error "Usage: $0 rollback <tag>"
        exit 1
    fi

    echo_info "Rolling back to ${IMAGE_NAME}:${TAG}..."
    sed -i.bak "s|image: ${IMAGE_NAME}:latest|image: ${IMAGE_NAME}:${TAG}|g" ${COMPOSE_FILE}

    docker compose -f ${COMPOSE_FILE} down
    docker compose -f ${COMPOSE_FILE} up -d

    mv ${COMPOSE_FILE}.bak ${COMPOSE_FILE}
    echo_info "✓ Rollback complete"
}

cleanup() {
    echo_info "Cleaning up old images..."
    docker image prune -af
    echo_info "✓ Cleanup complete"
}

show_help() {
    cat << EOF
Production Deployment Script

Usage: $0 [command] [options]

Commands:
  build [tag]    Build + push Docker image (default: latest)
  deploy         Pull + restart containers on VM
  full           Build + push + deploy
  logs           Show logs
  status         Show container status
  rollback <tag> Roll back to a tag
  cleanup        Remove unused images
  help           Show help
EOF
}

case "${1:-help}" in
    build)   check_requirements; build_and_push "${2:-latest}" ;;
    deploy)  check_requirements; deploy ;;
    full)    check_requirements; build_and_push "${2:-latest}"; deploy; show_status ;;
    logs)    show_logs ;;
    status)  show_status ;;
    rollback) check_requirements; rollback "$2" ;;
    cleanup) cleanup ;;
    help|--help|-h) show_help ;;
    *) echo_error "Unknown command: $1"; exit 1 ;;
esac
