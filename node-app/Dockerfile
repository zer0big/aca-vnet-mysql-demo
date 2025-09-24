FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN apt-get update && apt-get install -y curl

EXPOSE 80
CMD [ "node", "server.js" ]

