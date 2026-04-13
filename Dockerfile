FROM ghcr.io/puppeteer/puppeteer:latest

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Altera temporariamente para modo administrador para ele não dar erro de permissão (EACCES)
USER root

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Dá a posse de todos os arquivos do bot para o usuário do Puppeteer.
# Isso permite que ele possa criar a pasta /session do Zap e editar o botbitpe.db
RUN chown -R pptruser:pptruser /usr/src/app

EXPOSE 3333

# Retorna para o usuário original exigido pela imagem do Google Puppeteer
USER pptruser

CMD [ "node", "server.js" ]
