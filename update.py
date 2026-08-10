import sys

with open('index.html', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace('3.16.33', '3.16.34')
c = c.replace('<span class="stat-label">Subnetworks</span>', '<span class="stat-label">Circuits</span>')

to_remove = '''        <div class="stat-pill">
          <span class="stat-label">Total Segments</span>
          <span class="stat-value" id="stat-total-segments">--</span>
        </div>'''
c = c.replace(to_remove, '')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(c)
