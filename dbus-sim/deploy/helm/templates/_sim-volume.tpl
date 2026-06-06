{{- define "aircast-dbus-sim.volume" -}}
- name: {{ .Values.volumeName }}
  emptyDir:
    medium: Memory
    sizeLimit: 4Mi
{{- end -}}
