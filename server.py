from flask import Flask, send_from_directory
import os

app = Flask(__name__)

@app.route('/')
def index():
    return send_from_directory('.', 'live_trades_dashboard.html')

@app.route('/multi_ticker_dashboard.html')
def dashboard():
    return send_from_directory('.', 'multi_ticker_dashboard.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8096, debug=True)