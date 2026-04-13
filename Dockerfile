FROM node:20-slim

# Altera para root garantido para poder instalar coisas no linux
USER root

# Instala o Chromium nativo do Linux "na unha" (não tem como o caminho dele sumir depois)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Forçamos o código do Zap a olhar para o lugar exato onde acabamos de instalar o Chromium!
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Solução matadora para qualquer EACCES: dar permissão irrestrita pra pasta do bot
RUN chmod -R 777 /usr/src/app

EXPOSE 3333

CMD [ "node", "server.js" ]
