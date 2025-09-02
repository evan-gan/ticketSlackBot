# Use official Node.js LTS image as base
FROM node:20-alpine

# Set working directory
WORKDIR /

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Set environment variables (optional)
ENV NODE_ENV=production

# Start the bot 
CMD [ "npm", "start" ]
