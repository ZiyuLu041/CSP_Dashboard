#!/usr/bin/env python3
"""
Test client for CSP Native WebSocket endpoints
"""

import websocket
import json
import threading
import time

def test_native_websocket(url, table_name):
    """Test a specific native WebSocket endpoint"""
    print(f"🧪 Testing Native CSP WebSocket: {table_name}")
    print(f"🔗 URL: {url}")

    messages_received = []

    def on_message(ws, message):
        try:
            data = json.loads(message)
            messages_received.append(data)

            print(f"📨 Raw message: {message[:200]}...")

            # Check message type and format
            if data.get('messageType') == 'table_update':
                table = data.get('table')
                data_rows = data.get('data', [])
                print(f"📊 Table update: {table}, Rows: {len(data_rows)}")

                if data_rows:
                    print(f"   Sample row: {data_rows[0]}")
            else:
                print(f"❓ Unknown message type: {data.get('messageType')}")

        except json.JSONDecodeError:
            print(f"❌ Invalid JSON: {message[:100]}...")
        except Exception as e:
            print(f"❌ Error processing message: {e}")

        # Stop after receiving 3 messages
        if len(messages_received) >= 3:
            print(f"✅ Received {len(messages_received)} messages, stopping...")
            ws.close()

    def on_error(ws, error):
        print(f"❌ WebSocket error: {error}")

    def on_close(ws, close_status_code, close_msg):
        print("🔌 WebSocket connection closed")

    def on_open(ws):
        print(f"🚀 Connected to Native CSP WebSocket: {table_name}! Waiting for data...")

    print(f"🔗 Connecting to: {url}")

    ws = websocket.WebSocketApp(
        url,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
        on_open=on_open
    )

    # Run for max 10 seconds
    def run_ws():
        ws.run_forever(ping_timeout=10)

    ws_thread = threading.Thread(target=run_ws)
    ws_thread.daemon = True
    ws_thread.start()

    time.sleep(10)

    print(f"\n📈 Summary: Received {len(messages_received)} messages from {table_name}")
    if messages_received:
        print(f"✅ Native CSP WebSocket {table_name} is working!")
        print(f"💰 Sample message: {messages_received[0]}")
        return True
    else:
        print(f"❌ No data received from {table_name}")
        return False

def main():
    print("🧪 Testing Native CSP WebSocket Endpoints")
    print("=" * 50)

    # Test trades endpoint
    print("\n" + "="*20 + " Testing Trades " + "="*20)
    trades_success = test_native_websocket(
        'ws://localhost:7678/subscribe/trades',
        'trades'
    )

    time.sleep(2)

    # Test statistics endpoint
    print("\n" + "="*20 + " Testing Statistics " + "="*20)
    stats_success = test_native_websocket(
        'ws://localhost:7678/subscribe/statistics',
        'statistics'
    )

    # Summary
    print("\n" + "="*60)
    print("📊 NATIVE CSP WEBSOCKET TEST RESULTS")
    print("="*60)

    results = {
        'Trades': trades_success,
        'Statistics': stats_success
    }

    working_count = 0
    for name, success in results.items():
        status = "✅ WORKING" if success else "❌ FAILED"
        print(f"{status} {name} WebSocket")
        if success:
            working_count += 1

    print(f"\n🎯 {working_count}/2 native endpoints are working")

    if working_count == 2:
        print("🎉 ALL NATIVE ENDPOINTS WORKING! Dashboard should work perfectly!")
    elif working_count == 1:
        print("⚠️  One endpoint working. Check the other one.")
    else:
        print("🔧 Both endpoints failed. Check CSP native pipeline:")
        print("   - python csp_native_websocket.py")

if __name__ == "__main__":
    main()