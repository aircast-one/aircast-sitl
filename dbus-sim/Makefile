# aircast D-Bus simulator — Phase 1 Makefile.
#
# Targets:
#   make build   — build the sim image
#   make run     — start the sim container detached, wait for readiness
#   make stop    — stop the running sim container
#   make logs    — follow container logs
#   make test    — full smoke test: build → run → exec tests → stop

IMAGE ?= ghcr.io/aircast-one/aircast-sim
TAG   ?= dev
NAME  ?= aircast-sim

.PHONY: build run stop logs test

build:
	docker build -t $(IMAGE):$(TAG) .

run:
	docker run --rm --name $(NAME) -d $(IMAGE):$(TAG)
	@echo "waiting for sim to become ready..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do \
		if docker logs $(NAME) 2>&1 | grep -q '"ready": true'; then \
			echo "sim is ready"; \
			docker ps --filter "name=$(NAME)" --format '{{.ID}}'; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "sim did not report ready within 15s"; \
	docker logs $(NAME); \
	docker stop $(NAME) >/dev/null 2>&1 || true; \
	exit 1

stop:
	docker stop $(NAME) || true

logs:
	docker logs -f $(NAME)

# Full smoke loop. We build, start, then run the test inside the
# container — that way the test process shares a kernel namespace with
# the bus socket and PID 1 (no socket bind-mounting required at this
# phase). If the test fails we still stop the container before exiting.
test: build
	@$(MAKE) --no-print-directory run
	@set +e; \
	docker exec $(NAME) python3 -m unittest discover -v /opt/tests; \
	rc=$$?; \
	echo "--- sim logs ---"; \
	docker logs $(NAME); \
	echo "--- end sim logs ---"; \
	$(MAKE) --no-print-directory stop; \
	exit $$rc
