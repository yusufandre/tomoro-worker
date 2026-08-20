# Gunakan image resmi Puppeteer yang sudah terinstal Node.js, Chromium, dan seluruh library Linux yang dibutuhkan
FROM ghcr.io/puppeteer/puppeteer:22.12.0

# Set folder kerja di dalam container
WORKDIR /usr/src/app

# Salin file package.json dan package-lock.json terlebih dahulu untuk efisiensi cache build
COPY package*.json ./

# Install dependensi (hanya standard puppeteer)
RUN npm ci

# Salin seluruh file proyek (server.js, index.html, scraper.html) ke dalam container
COPY . .

# Environment variable untuk memberi tahu Puppeteer agar menggunakan Chromium bawaan container
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Port default untuk Render adalah 10000
EXPOSE 10000

# Perintah untuk menjalankan server Node.js lokal kita
CMD ["node", "server.js"]
