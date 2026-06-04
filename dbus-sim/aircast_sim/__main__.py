"""aircast_sim entry point.

Spawns a private D-Bus system bus, loads the NetworkManager and
ModemManager1 dbusmock templates, applies the requested scenario, and
blocks until SIGTERM/SIGINT.

Phase 1 (this module) is intentionally tiny — no HTTP control plane, no
YAML loader, no transitions. Scenarios are Python modules under
``aircast_sim.scenarios.builtins`` exposing a single ``apply(nm, mm)``
function. Only ``happy_wifi`` exists today; later phases (see
``/docs/simulators.md``) introduce a YAML loader.
"""

from __future__ import annotations

import argparse
import importlib
import json
import logging
import os
import signal
import subprocess
import sys
import threading
from typing import Optional

import dbusmock

LOG = logging.getLogger("aircast_sim")

# Block forever in main() until a signal handler trips this event. We don't
# use signal.pause() because we want a clean way to share the event with
# the cleanup path.
_shutdown_event = threading.Event()


def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="aircast_sim",
        description="aircast D-Bus simulator (Phase 1 skeleton).",
    )
    parser.add_argument(
        "--scenario",
        default="happy_wifi",
        help="Built-in scenario module name (under aircast_sim.scenarios.builtins). "
        "Default: happy_wifi.",
    )
    return parser.parse_args(argv)


def _install_signal_handlers() -> None:
    def _handle(signum, _frame):
        LOG.info("received signal %s, shutting down", signum)
        _shutdown_event.set()

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)


def _start_bus() -> str:
    """Start the private system bus and return its address.

    ``DBusTestCase.start_system_bus`` is a classmethod that spawns a
    dbus-daemon under the calling process's lifetime. It exports the bus
    address via the ``DBUS_SYSTEM_BUS_ADDRESS`` env var so any client
    spawned later in this process (including the templates we're about
    to load) picks it up automatically.
    """
    dbusmock.DBusTestCase.start_system_bus()
    addr = os.environ.get("DBUS_SYSTEM_BUS_ADDRESS")
    if not addr:
        raise RuntimeError(
            "start_system_bus did not set DBUS_SYSTEM_BUS_ADDRESS; "
            "dbusmock version mismatch?"
        )
    return addr


def _spawn_template(name: str) -> tuple[subprocess.Popen, object]:
    """Spawn a python-dbusmock template against the running system bus.

    Returns the (process, mock_proxy) tuple. The proxy is a ``dbus.proxies``
    object pointing at the template's MAIN_OBJ and supporting the helper
    methods exposed under the ``org.freedesktop.DBus.Mock`` interface
    (e.g. ``AddWiFiDevice``, ``SetGlobalConnectionState``).

    Template stdout is sent to /dev/null. The dbusmock templates log every
    method call to stdout; if we PIPE it the buffer fills (~64 KB) and the
    template blocks on its next write, deadlocking our scenario apply.
    Capturing it would only matter if we wanted to replay the wire trace
    for tests; for Phase 1 it's noise.
    """
    proc, proxy = dbusmock.DBusTestCase.spawn_server_template(
        name,
        {},  # template parameters — defaults are fine for Phase 1
        stdout=subprocess.DEVNULL,
    )
    return proc, proxy


def _emit_ready(scenario: str, bus_address: str) -> None:
    """Single-line JSON readiness signal on stdout.

    Picked up by the smoke test runner / ``make run`` poll loop /
    eventual K8s readiness probe. Stdout only — keep stderr for logs.
    """
    line = json.dumps(
        {
            "service": "aircast_sim",
            "phase": 1,
            "scenario": scenario,
            "bus_address": bus_address,
            "ready": True,
        },
        sort_keys=True,
    )
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )
    args = _parse_args(argv)

    _install_signal_handlers()

    bus_address = _start_bus()
    LOG.info("system bus up at %s", bus_address)

    nm_proc: Optional[subprocess.Popen] = None
    mm_proc: Optional[subprocess.Popen] = None
    try:
        nm_proc, nm_mock = _spawn_template("networkmanager")
        LOG.info("loaded networkmanager template (pid=%s)", nm_proc.pid)

        mm_proc, mm_mock = _spawn_template("modemmanager")
        LOG.info("loaded modemmanager template (pid=%s)", mm_proc.pid)

        module_name = f"aircast_sim.scenarios.builtins.{args.scenario}"
        try:
            scenario_mod = importlib.import_module(module_name)
        except ImportError as exc:
            LOG.error("scenario %r not found: %s", args.scenario, exc)
            return 2

        LOG.info("applying scenario %s", args.scenario)
        scenario_mod.apply(nm_mock, mm_mock)
        LOG.info("scenario applied")

        _emit_ready(args.scenario, bus_address)

        # Block until SIGTERM/SIGINT.
        _shutdown_event.wait()
        return 0
    finally:
        for proc, label in ((mm_proc, "modemmanager"), (nm_proc, "networkmanager")):
            if proc is None:
                continue
            LOG.info("terminating %s template (pid=%s)", label, proc.pid)
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                LOG.warning("%s did not exit cleanly, killing", label)
                proc.kill()
                proc.wait(timeout=5)
            except Exception as exc:  # noqa: BLE001 — cleanup, log and move on
                LOG.warning("error terminating %s: %s", label, exc)


if __name__ == "__main__":
    raise SystemExit(main())
