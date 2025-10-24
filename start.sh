#!/bin/bash

# BookChat Quick Start Script

echo "🚀 Starting BookChat Application..."
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "Please copy .env.example to .env and add your OpenAI API key:"
    echo "  cp .env.example .env"
    echo "  # Then edit .env and add your OPENAI_API_KEY"
    exit 1
fi

# Check if OPENAI_API_KEY is set
if grep -q "your_openai_api_key_here" .env; then
    echo "⚠️  Warning: Please set your OpenAI API key in .env file"
    echo "  Edit .env and replace 'your_openai_api_key_here' with your actual API key"
    exit 1
fi

echo "✅ Configuration looks good!"
echo ""
echo "Building and starting Docker containers..."
echo ""

# Build and start containers
docker-compose up --build

# Note: Press Ctrl+C to stop the containers
