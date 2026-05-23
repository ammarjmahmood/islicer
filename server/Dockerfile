FROM node:20-slim

# Install CuraEngine
RUN apt-get update && \
    apt-get install -y curaengine && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p uploads gcode

EXPOSE 8005

CMD ["node", "index.js"]
