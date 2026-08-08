import urllib.request
import re
import json
import time

# List of all Indiana airports the app uses
AIRPORTS = [
    'KVPZ', 'KGYY', 'KSBN', 'KPPO', 'KMGC', 'KRZL', 'KMCX', 'KOXI', 'KRWN',
    'KRCR', 'KASW', 'KGSH', 'KEKM', 'KANQ', 'KGWB', 'KSMD', 'KFWA', 'KHHG',
    'KIWH', 'KGGP', 'KLAF', 'KFKR'
]

def fetch_airnav_price(icao):
    url = f"https://www.airnav.com/airport/{icao}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
    try:
        html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
        
        prices = []
        # Find FBO fuel tables
        tables = re.findall(r'<table[^>]*>([\s\S]*?)</table>', html, re.IGNORECASE)
        for t in tables:
            if 'Jet A' in t or '100LL' in t:
                rows = re.findall(r'<tr[^>]*>([\s\S]*?)</tr>', t, re.IGNORECASE)
                for r in rows:
                    if 'FS' in r or 'SS' in r:
                        # Extract all td elements
                        tds = re.findall(r'<td[^>]*>([\s\S]*?)</td>', r, re.IGNORECASE)
                        # In AirNav's fuel table, row layout is:
                        # [0] Type (FS/SS), [1] empty, [2] 100LL price, [3] empty, [4] JetA price
                        if len(tds) >= 5:
                            jet_a_td = tds[4].strip()
                            # Check if JetA cell contains a valid price
                            price_match = re.search(r'\$([0-9]+\.[0-9]{2})', jet_a_td)
                            if price_match:
                                val = float(price_match.group(1))
                                if 2.0 < val < 25.0:
                                    prices.append(val)
                                
        if prices:
            return min(prices)
            
        # Fallback if no table parsed properly
        alt = re.findall(r'Jet\s*A[\s\S]{1,50}?\$([0-9]+\.[0-9]{2})', html, re.IGNORECASE)
        if alt:
            return min([float(p) for p in alt if 2.0 < float(p) < 25.0])
            
    except Exception as e:
        print(f"Failed to fetch {icao}: {e}")
    return None

def main():
    prices = {}
    for icao in AIRPORTS:
        price = fetch_airnav_price(icao)
        if price:
            prices[icao] = price
            print(f"{icao}: {price}")
        else:
            print(f"{icao}: Failed to find price")
        time.sleep(1) # Be nice to AirNav servers
        
    with open('fuel_prices.json', 'w') as f:
        json.dump({
            "timestamp": int(time.time() * 1000),
            "prices": prices
        }, f, indent=2)

if __name__ == "__main__":
    main()
