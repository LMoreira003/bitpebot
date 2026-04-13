FROM ghcr.io/puppeteer/puppeteer:latest

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Altera temporariamente para modo administrador para ele não dar erro de permissão (EACCES)
USER root

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3333

# Retorna para o usuário original exigido pela imagem do Google Puppeteer
USER pptruser

CMD [ "node", "server.js" ]
