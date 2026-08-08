import http.server
import socketserver
import json
import os

PORT = 8080
DIRECTORY = r"C:\Users\chadm\.gemini\antigravity\scratch\transmission-map"
GEOJSON_FILE = os.path.join(DIRECTORY, "osmtransmission.json")

KEY = "IND_GRID_2026_SECURE"

def encrypt_str(plain_str, key=KEY):
    import base64
    key_bytes = key.encode('utf-8')
    plain_bytes = plain_str.encode('utf-8')
    enc_bytes = bytes([b ^ key_bytes[i % len(key_bytes)] for i, b in enumerate(plain_bytes)])
    return base64.b64encode(enc_bytes).decode('ascii')

class DatabaseHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        if self.path == "/api/save":
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                payload = json.loads(post_data.decode('utf-8'))
                features = payload.get('features', [])
                
                doc = {
                    "type": "FeatureCollection",
                    "features": features
                }
                
                raw_json = json.dumps(doc, separators=(',', ':'))
                enc_data = encrypt_str(raw_json)
                enc_doc = {
                    "encrypted": True,
                    "version": "1.0",
                    "data": enc_data
                }
                
                with open(GEOJSON_FILE, "w", encoding="utf-8") as f:
                    json.dump(enc_doc, f)
                    
                print(f"[API SAVE] Successfully persisted {len(features)} features (encrypted) permanently to osmtransmission.json")
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = json.dumps({"status": "success", "message": "Dataset saved permanently to database on disk."})
                self.wfile.write(response.encode('utf-8'))
            except Exception as e:
                print("[API SAVE ERROR]:", e)
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = json.dumps({"status": "error", "message": str(e)})
                self.wfile.write(response.encode('utf-8'))
        elif self.path == "/api/fetch-fuel":
            try:
                import sys, subprocess
                script_path = os.path.join(DIRECTORY, "scripts", "scrape_airnav.py")
                print(f"[API FUEL] Running live AirNav scraper script: {script_path}")
                res = subprocess.run([sys.executable, script_path], capture_output=True, text=True)
                
                if res.returncode == 0:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    response = json.dumps({"status": "success", "message": "Live fuel prices scraped and saved."})
                    self.wfile.write(response.encode('utf-8'))
                else:
                    raise Exception(res.stderr or "Scraper exited with error")
            except Exception as e:
                print("[API FUEL ERROR]:", e)
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = json.dumps({"status": "error", "message": str(e)})
                self.wfile.write(response.encode('utf-8'))
        else:
            self.send_error(404, "Endpoint not found")

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), DatabaseHTTPHandler) as httpd:
        print(f"Serving Indiana Grid Map with Database Save API on http://localhost:{PORT}")
        httpd.serve_forever()
