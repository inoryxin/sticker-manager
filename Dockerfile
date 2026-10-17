FROM node:20-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
ENV PORT=3000 \
    DATA_DIR=/data \
    STICKERS_DIR=/data/stickers
EXPOSE 3000
VOLUME [ "/data" ]
CMD [ "node", "server.js" ]
