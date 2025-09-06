#!/bin/bash
set -e

# Build the Docker image
echo "🏗️  Building Docker image..."
docker build -t portfolio-site .

# Run the Docker container
echo "🚀 Starting container on http://localhost:8080"
docker run --rm -p 8080:80 portfolio-site

# Note: Use Ctrl+C to stop the container
