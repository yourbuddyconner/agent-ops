FROM ghcr.io/anomalyco/opencode:latest

# Set working directory for workspaces
WORKDIR /workspace

# Configure server to listen on all interfaces
ENV OPENCODE_SERVER_USERNAME=opencode

# Expose the server port
EXPOSE 4096

# Run in server mode (base image has opencode as entrypoint)
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
