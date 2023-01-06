FROM node:10.22.0

COPY package.json yarn.lock /usr/src/wallet/

WORKDIR /usr/src/wallet

RUN yarn install

COPY . /usr/src/wallet/

# Run app as node user
USER node

# Expose port
EXPOSE 3000
# Start the app
CMD ["npm", "start"]
