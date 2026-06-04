"""Phase 1 smoke test for aircast_sim.

Runs *inside* the simulator container via ``docker exec ... python3 -m
unittest``. The container's ``aircast_sim`` process is already running
on PID 1, so the system bus is up and the happy-wifi scenario has been
applied.

The test verifies the exact D-Bus reads aircast-agent performs on
startup. If a dbusmock template API mismatch breaks the scenario,
these assertions are how we find out.
"""

from __future__ import annotations

import os
import unittest

import dbus

NM = "org.freedesktop.NetworkManager"
NM_PATH = "/org/freedesktop/NetworkManager"
NM_DEVICE = "org.freedesktop.NetworkManager.Device"
NM_DEVICE_WIRELESS = "org.freedesktop.NetworkManager.Device.Wireless"
NM_AP = "org.freedesktop.NetworkManager.AccessPoint"
MM = "org.freedesktop.ModemManager1"

PROPS = "org.freedesktop.DBus.Properties"

NM_STATE_CONNECTED_GLOBAL = 70
NM_DEVICE_TYPE_WIFI = 2


def _connect_bus() -> dbus.SystemBus:
    """Resolve the system bus.

    ``docker exec`` doesn't inherit ``DBUS_SYSTEM_BUS_ADDRESS`` from the
    sim process, and the env block of the entry-point Python process
    captured by ``/proc/<pid>/environ`` reflects exec(2) time only — it
    doesn't update when ``start_system_bus`` mutates ``os.environ``.
    The dbusmock template subprocesses *do* inherit the mutated env via
    fork, so we scan ``/proc/<pid>/environ`` for them and pick whichever
    bus address shows up first.
    """
    if not os.environ.get("DBUS_SYSTEM_BUS_ADDRESS"):
        for pid_dir in sorted(os.listdir("/proc")):
            if not pid_dir.isdigit():
                continue
            try:
                with open(f"/proc/{pid_dir}/environ", "rb") as f:
                    blob = f.read()
            except (FileNotFoundError, PermissionError):
                continue
            for entry in blob.split(b"\x00"):
                if entry.startswith(b"DBUS_SYSTEM_BUS_ADDRESS="):
                    os.environ["DBUS_SYSTEM_BUS_ADDRESS"] = entry.split(b"=", 1)[1].decode()
                    break
            if "DBUS_SYSTEM_BUS_ADDRESS" in os.environ:
                break
    if not os.environ.get("DBUS_SYSTEM_BUS_ADDRESS"):
        raise RuntimeError(
            "could not locate DBUS_SYSTEM_BUS_ADDRESS in any /proc/*/environ; "
            "is aircast_sim running in this container?"
        )
    return dbus.SystemBus()


class HappyWifiSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bus = _connect_bus()
        cls.nm = cls.bus.get_object(NM, NM_PATH)
        cls.nm_props = dbus.Interface(cls.nm, dbus_interface=PROPS)
        cls.nm_iface = dbus.Interface(cls.nm, dbus_interface=NM)

    # 1. NM.State == 70 (CONNECTED_GLOBAL)
    def test_nm_state_is_connected_global(self):
        state = self.nm_props.Get(NM, "State")
        self.assertEqual(int(state), NM_STATE_CONNECTED_GLOBAL)

    # 2. GetDevices returns at least one device
    def test_get_devices_returns_at_least_one(self):
        devices = self.nm_iface.GetDevices()
        self.assertGreaterEqual(len(devices), 1)

    # 3. First device is WiFi (DeviceType == 2)
    def test_first_device_is_wifi(self):
        devices = self.nm_iface.GetDevices()
        dev = self.bus.get_object(NM, devices[0])
        dev_props = dbus.Interface(dev, dbus_interface=PROPS)
        dtype = dev_props.Get(NM_DEVICE, "DeviceType")
        self.assertEqual(int(dtype), NM_DEVICE_TYPE_WIFI)

    # 4. AccessPoints on first device returns at least one AP
    def test_first_device_has_access_points(self):
        devices = self.nm_iface.GetDevices()
        dev = self.bus.get_object(NM, devices[0])
        dev_props = dbus.Interface(dev, dbus_interface=PROPS)
        aps = dev_props.Get(NM_DEVICE_WIRELESS, "AccessPoints")
        self.assertGreaterEqual(len(aps), 1)

    # 5. First AP has SSID="homeNet" and Strength=87
    def test_first_ap_ssid_and_strength(self):
        devices = self.nm_iface.GetDevices()
        dev = self.bus.get_object(NM, devices[0])
        dev_props = dbus.Interface(dev, dbus_interface=PROPS)
        aps = dev_props.Get(NM_DEVICE_WIRELESS, "AccessPoints")
        ap = self.bus.get_object(NM, aps[0])
        ap_props = dbus.Interface(ap, dbus_interface=PROPS)
        ssid_bytes = ap_props.Get(NM_AP, "Ssid")
        # Ssid is type 'ay' (array of bytes). dbus-python returns it as
        # dbus.Array of dbus.Byte; convert to plain bytes then decode.
        ssid = bytes(int(b) for b in ssid_bytes).decode("utf-8")
        self.assertEqual(ssid, "homeNet")
        strength = ap_props.Get(NM_AP, "Strength")
        self.assertEqual(int(strength), 87)

    # 6. ModemManager1 well-known name is owned (zero modems is fine)
    def test_modemmanager_service_present(self):
        names = self.bus.list_names()
        self.assertIn(MM, names)


if __name__ == "__main__":
    unittest.main()
