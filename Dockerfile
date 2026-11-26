FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY shared ./shared
COPY public ./public
ENV NODE_ENV=production
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
