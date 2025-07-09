.PHONY: build build-arm64 build-amd64 build-multi run stop logs help push-multi

# Image configuration
IMAGE_NAME := ghcr.io/pavliha/aircast-sitl
TAG := latest
FULL_IMAGE := $(IMAGE_NAME):$(TAG)

# Container configuration
CONTAINER_NAME := aircast-sitl

# Port configuration (matching your original docker run command)
TCP_PORTS := 5760-5765:5760-5765
UDP_PORTS := 14550-14555:14550-14555/udp
FG_PORT := 9005:9005

help:
	@echo "Aircast SITL Makefile"
	@echo ""
	@echo "Available commands:"
	@echo "  make build        - Build for current platform"
	@echo "  make build-arm64  - Build for ARM64 (Apple Silicon, Raspberry Pi)"
	@echo "  make build-amd64  - Build for AMD64 (Intel/AMD x86_64)"
	@echo "  make build-multi  - Build for both ARM64 and AMD64"
	@echo "  make run          - Run SITL container"
	@echo "  make stop         - Stop running SITL container"
	@echo "  make logs         - Show SITL container logs"
	@echo "  make push-multi   - Push multi-arch image to registry"

build:
	@echo "Building Aircast SITL image for current platform..."
	docker build -t $(FULL_IMAGE) .
	@echo "✅ Build complete: $(FULL_IMAGE)"

build-arm64:
	@echo "Building Aircast SITL image for ARM64..."
	docker build --platform linux/arm64 -t $(IMAGE_NAME):arm64 .
	@echo "✅ ARM64 build complete: $(IMAGE_NAME):arm64"

build-amd64:
	@echo "Building Aircast SITL image for AMD64..."
	docker build --platform linux/amd64 -t $(IMAGE_NAME):amd64 .
	@echo "✅ AMD64 build complete: $(IMAGE_NAME):amd64"

build-multi:
	@echo "Setting up Docker buildx for multi-arch builds..."
	docker buildx create --name aircast-builder --use || docker buildx use aircast-builder
	@echo "Building Aircast SITL image for ARM64 and AMD64..."
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t $(FULL_IMAGE) \
		--load \
		.
	@echo "✅ Multi-arch build complete: $(FULL_IMAGE)"

run:
	@echo "Starting Aircast SITL..."
	@echo "MAVLink connections:"
	@echo "  TCP: localhost:5760-5765"
	@echo "  UDP: localhost:14550-14555"
	@echo ""
	@echo "Press Ctrl+C to stop..."
	docker run --rm -it \
		--name $(CONTAINER_NAME) \
		-p $(TCP_PORTS) \
		-p $(UDP_PORTS) \
		-p $(FG_PORT) \
		$(FULL_IMAGE)

stop:
	@echo "Stopping SITL container..."
	docker stop $(CONTAINER_NAME) || true

logs:
	@echo "Showing SITL logs..."
	docker logs -f $(CONTAINER_NAME)

push-multi:
	@echo "Setting up Docker buildx for multi-arch builds..."
	docker buildx create --name aircast-builder --use || docker buildx use aircast-builder
	@echo "Building and pushing multi-arch image to GitHub Container Registry..."
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t $(FULL_IMAGE) \
		--push \
		.
	@echo "✅ Multi-arch image pushed: $(FULL_IMAGE)"

# Architecture-specific push commands
push-arm64:
	@echo "Pushing ARM64 image to GitHub Container Registry..."
	docker push $(IMAGE_NAME):arm64
	@echo "✅ ARM64 image pushed: $(IMAGE_NAME):arm64"

push-amd64:
	@echo "Pushing AMD64 image to GitHub Container Registry..."
	docker push $(IMAGE_NAME):amd64
	@echo "✅ AMD64 image pushed: $(IMAGE_NAME):amd64"
