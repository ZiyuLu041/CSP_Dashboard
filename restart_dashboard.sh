#!/bin/bash

# Kill existing processes on port 8096
echo "Stopping existing processes..."
PIDS=$(sudo lsof -t -i :8096 2>/dev/null)
if [ ! -z "$PIDS" ]; then
    kill $PIDS
    echo "Killed processes: $PIDS"
    sleep 2
else
    echo "No processes running on port 8096"
fi

# Verify port is free
echo "Checking if port 8096 is free..."
if sudo lsof -i :8096 > /dev/null 2>&1; then
    echo "Port 8096 still occupied, waiting..."
    sleep 3
fi

# Start gunicorn for external access
echo "Starting gunicorn for dashboard..."
cd /home/ziyulu1997/live_stream_visualization
nohup uv run gunicorn -b 0.0.0.0:8096 --timeout 120 --workers 2 --worker-class sync server:app > dashboard_nohup.out 2>&1 &

# Wait a moment and check if it started
sleep 2
if sudo lsof -i :8096 > /dev/null 2>&1; then
    echo "✅ Dashboard started successfully on port 8096"
    NEW_PID=$(sudo lsof -t -i :8096)
    echo "New process PID: $NEW_PID"
    echo "🌐 Access externally at: http://YOUR_SERVER_IP:8096/"
else
    echo "❌ Failed to start dashboard"
fi