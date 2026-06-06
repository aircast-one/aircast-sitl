{{- define "aircast-dbus-sim.container" -}}
- name: dbus-sim
  image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
  imagePullPolicy: {{ .Values.image.pullPolicy }}
  env:
    - name: AIRCAST_SIM_SCENARIO
      value: {{ .Values.scenario | quote }}
  volumeMounts:
    - name: {{ .Values.volumeName }}
      mountPath: /run/dbus
  resources:
    {{- toYaml .Values.resources | nindent 4 }}
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    runAsNonRoot: true
    allowPrivilegeEscalation: false
    capabilities:
      drop: ["ALL"]
    readOnlyRootFilesystem: false  # dbus-daemon needs to bind a socket
  startupProbe:
    exec:
      command: ["test", "-S", "/run/dbus/system_bus_socket"]
    periodSeconds: 1
    failureThreshold: 30
  livenessProbe:
    exec:
      command: ["test", "-S", "/run/dbus/system_bus_socket"]
    periodSeconds: 10
{{- end -}}
