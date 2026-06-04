"""happy-wifi: one connected WiFi device, one access point, no modems.

This is the v1 "everything is fine" baseline:

* ``wlan0`` is present, type WiFi, state ACTIVATED.
* One access point ``homeNet`` on 5 GHz, strength 87.
* ``org.freedesktop.NetworkManager.State`` == 70 (CONNECTED_GLOBAL).
* ``WirelessEnabled`` true, ``Connectivity`` full (4).
* ModemManager1 is up but exposes zero managed objects — the "no SIM, no
  cellular" case.

Later phases extend this scenario with IP4Config, Settings.Connection,
ActiveConnection.Connection, etc.; for Phase 1 the goal is just to make
the agent's startup reads succeed.

API signatures match python-dbusmock's networkmanager template; see
https://github.com/martinpitt/python-dbusmock/blob/main/dbusmock/templates/networkmanager.py
"""

from __future__ import annotations

import dbus

# --- NetworkManager constants (mirrored from dbusmock template) ----------
# Device states (NM_DEVICE_STATE_*)
NM_DEVICE_STATE_ACTIVATED = 100

# Active-connection states (NM_ACTIVE_CONNECTION_STATE_*)
NM_ACTIVE_CONNECTION_STATE_ACTIVATED = 2

# Top-level NM.State (NM_STATE_*)
NM_STATE_CONNECTED_GLOBAL = 70

# AP 802.11 mode (NM_802_11_MODE_INFRA = 2 per nm-dbus-types; the dbusmock
# template doesn't validate, but we use the canonical value).
NM_802_11_MODE_INFRA = 2

# AP security flags (NM_802_11_AP_SEC_KEY_MGMT_PSK = 0x100). The design
# doc specified 0x400 but that's NM_802_11_AP_SEC_GROUP_TKIP. WPA-PSK is
# 0x100 per <NetworkManager.h>. We use 0x100 as the documented intent
# ("WPA-PSK") matters more than the literal hex value in the spec.
NM_802_11_AP_SEC_KEY_MGMT_PSK = 0x100

# NM root connectivity enum: 4 = NM_CONNECTIVITY_FULL.
NM_CONNECTIVITY_FULL = 4

NM_MANAGER_PATH = "/org/freedesktop/NetworkManager"
NM_MANAGER_IFACE = "org.freedesktop.NetworkManager"


def apply(nm_mock, _mm_mock) -> None:
    """Apply the happy-wifi scenario to a freshly spawned NM+MM bus.

    Args:
        nm_mock: dbus proxy to the NetworkManager mock-control object,
            as returned by ``DBusTestCase.spawn_server_template("networkmanager", ...)``.
        _mm_mock: same for modemmanager. Unused in this scenario — happy-wifi
            is the "no cellular" baseline, and the MM template's default
            state (no Modem objects exported) is exactly what we want.
    """

    # AddWiFiDevice returns the device object path. The template encodes
    # state into the Device.State property.
    wifi_dev = nm_mock.AddWiFiDevice(
        "Mock_WiFi1",  # mock object name suffix
        "wlan0",       # Interface property
        NM_DEVICE_STATE_ACTIVATED,
    )

    # AddAccessPoint signature (template):
    #   (dev_path, ap_name, ssid, hw_address, mode, frequency, rate,
    #    strength, security)
    ap_path = nm_mock.AddAccessPoint(
        wifi_dev,
        "Mock_AP0",                       # mock object name suffix
        "homeNet",                        # Ssid (template converts to ay)
        "00:11:22:33:44:55",              # HwAddress
        NM_802_11_MODE_INFRA,             # Mode
        dbus.UInt32(5180),                # Frequency MHz
        dbus.UInt32(54000),               # MaxBitrate
        dbus.Byte(87),                    # Strength (0-100)
        NM_802_11_AP_SEC_KEY_MGMT_PSK,    # WpaFlags / RsnFlags surrogate
    )

    # AddWiFiConnection(dev_path, connection_name, ssid_name, key_mgmt).
    # The template's _key_mgmt arg is currently unused but we pass the
    # canonical value anyway for forward compatibility.
    con_path = nm_mock.AddWiFiConnection(
        wifi_dev,
        "Mock_Con0",
        "homeNet",
        "wpa-psk",
    )

    # AddActiveConnection(devices, connection_device, specific_object,
    #                     name, state).
    nm_mock.AddActiveConnection(
        [wifi_dev],
        con_path,
        ap_path,
        "Mock_Active0",
        NM_ACTIVE_CONNECTION_STATE_ACTIVATED,
    )

    # Top-level NM properties. SetGlobalConnectionState updates State and
    # emits StateChanged; we then patch the other root props directly via
    # the SetProperty helper exposed on the mock-control interface.
    nm_mock.SetGlobalConnectionState(dbus.UInt32(NM_STATE_CONNECTED_GLOBAL))
    nm_mock.SetProperty(
        NM_MANAGER_PATH,
        NM_MANAGER_IFACE,
        "WirelessEnabled",
        dbus.Boolean(True),
    )
    nm_mock.SetProperty(
        NM_MANAGER_PATH,
        NM_MANAGER_IFACE,
        "NetworkingEnabled",
        dbus.Boolean(True),
    )
    nm_mock.SetProperty(
        NM_MANAGER_PATH,
        NM_MANAGER_IFACE,
        "Connectivity",
        dbus.UInt32(NM_CONNECTIVITY_FULL),
    )
