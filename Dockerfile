FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN npm config set fetch-retries 5 && npm config set fetch-retry-maxtimeout 120000

COPY package*.json ./
RUN npm install

COPY . .

RUN cd frontend && npm install --include=dev && npm run build

RUN mkdir -p /app/data/uploads

EXPOSE 3000

CMD ["node", "server.js"]
