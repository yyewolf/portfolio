#!/bin/bash
set -e

echo "🔍 Start    # Time the container startup
    start_time=$(date +%s.%N)
    
    # Run the container and capture any startup errors
    if ! docker run -d --name $name -p 0:80 $image; then
        echo "❌ Failed to start container $name"
        return 1
    fi
    
    # For debugging, show container info
    echo "🔍 Container $name started with ID: $(docker ps -q -f name=$name)" time benchmark..."

# Check if bc is installed
if ! command -v bc &> /dev/null; then
    echo "Error: bc command not found. Please install it with 'apt-get install bc' or equivalent."
    exit 1
fi

# Build the Nginx image
echo "🏗️  Building Nginx image..."
docker build -t portfolio-nginx -f Dockerfile . || {
    echo "❌ Failed to build Nginx image"
    exit 1
}

# Function to measure boot time
measure_boot_time() {
    local image=$1
    local name=$2
    
    echo "⏱️  Testing $name boot time..."
    
    # Remove container if it exists
    docker rm -f $name 2>/dev/null || true
    
    # Time the container startup
    start_time=$(date +%s.%N)
    
    # Run the container and capture any startup errors
    if ! docker run -d --name $name -p 0:80 $image; then
        echo "❌ Failed to start container"
        return 1
    fi
    
    # Wait for container to be ready (up to 10 seconds)
    attempt=0
    max_attempts=100
    
    while [ $attempt -lt $max_attempts ]; do
        container_status=$(docker inspect --format='{{.State.Status}}' $name 2>/dev/null || echo "not_found")
        
        if [ "$container_status" == "running" ]; then
            # Try to access the web server
            port=$(docker port $name | grep '80/tcp' | cut -d ':' -f 2 || echo "")
            if [ -n "$port" ] && curl -s --max-time 1 http://localhost:$port/ > /dev/null; then
                break
            fi
        elif [ "$container_status" == "exited" ] || [ "$container_status" == "dead" ]; then
            echo "❌ Container failed to start or crashed"
            echo "--- Container Logs ---"
            docker logs $name
            echo "---------------------"
            docker rm -f $name 2>/dev/null || true
            return 1
        fi
        
        sleep 0.1
        attempt=$((attempt+1))
    done
    
    if [ $attempt -eq $max_attempts ]; then
        echo "⚠️ Container didn't become ready within timeout"
        echo "--- Container Logs ---"
        docker logs $name
        echo "---------------------"
        docker rm -f $name 2>/dev/null || true
        return 1
    fi
    
    end_time=$(date +%s.%N)
    boot_time=$(echo "$end_time - $start_time" | bc)
    
    # Get first request time
    request_start=$(date +%s.%N)
    port=$(docker port $name | grep '80/tcp' | cut -d ':' -f 2)
    curl -s http://localhost:$port/ > /dev/null
    request_end=$(date +%s.%N)
    request_time=$(echo "$request_end - $request_start" | bc)
    
    echo "🕒 $name boot time: $boot_time seconds"
    echo "🕒 $name first request: $request_time seconds"
    
    # Cleanup
    docker rm -f $name 2>/dev/null || true
}

# Run benchmarks
echo "🧪 Running benchmark for Nginx..."

measure_boot_time "portfolio-nginx" "nginx-test"

echo "✅ Benchmark complete!"
echo "� Nginx boot time measured successfully"
