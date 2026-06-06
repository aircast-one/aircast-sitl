{{- define "aircast-dbus-sim.consumerEnv" -}}
- name: DBUS_SYSTEM_BUS_ADDRESS
  value: unix:path=/run/dbus/system_bus_socket
{{- end -}}

{{- define "aircast-dbus-sim.consumerVolumeMount" -}}
- name: {{ .Values.volumeName }}
  mountPath: /run/dbus
{{- end -}}
