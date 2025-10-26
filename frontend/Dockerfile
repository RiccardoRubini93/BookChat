FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Start development server
# When using a host bind-mount for /app during development the image-built node_modules
# can be hidden; run `npm install` at container start to ensure dependencies (including
# runtime-added ones like xlsx) are present inside the container.
CMD ["sh", "-lc", "npm install --no-audit --no-fund && npm run dev -- --host 0.0.0.0"]
