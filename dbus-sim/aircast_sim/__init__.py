"""aircast D-Bus simulator (Phase 1).

Phase 1 boots a private D-Bus system bus, loads python-dbusmock's
``networkmanager`` and ``modemmanager`` templates onto it, applies a
built-in scenario, and blocks until SIGTERM. See ``../README.md`` and the
monorepo design doc at ``/docs/simulators.md`` for the full architecture.
"""

__version__ = "0.1.0"
