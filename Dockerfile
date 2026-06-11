FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN cd frontend && npm install --include=dev && npm run build

RUN mkdir -p /app/data/uploads

EXPOSE 3000

CMD ["node", "server.js"]
