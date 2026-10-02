{{/*
Naming and shared configuration helpers.
*/}}

{{- define "opencred.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "opencred.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "opencred.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "opencred.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: opencred
{{- end -}}

{{- define "opencred.selectorLabels" -}}
app.kubernetes.io/name: {{ include "opencred.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "opencred.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "opencred.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "opencred.secretName" -}}
{{- default (printf "%s-secrets" (include "opencred.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{/*
Database URL.

Prefers the explicitly configured external database. When the bundled subchart
is enabled, the service name follows the Bitnami convention.
*/}}
{{- define "opencred.databaseUrl" -}}
{{- if .Values.externalDatabase.url -}}
{{- .Values.externalDatabase.url -}}
{{- else if .Values.postgresql.enabled -}}
{{- printf "postgresql://%s:%s@%s-postgresql:5432/%s?schema=public"
      .Values.postgresql.auth.username
      .Values.postgresql.auth.password
      .Release.Name
      .Values.postgresql.auth.database -}}
{{- else -}}
{{- fail "Set externalDatabase.url or enable the bundled postgresql subchart" -}}
{{- end -}}
{{- end -}}

{{- define "opencred.valkeyUrl" -}}
{{- if .Values.externalValkey.url -}}
{{- .Values.externalValkey.url -}}
{{- else if .Values.valkey.enabled -}}
{{- printf "redis://%s-valkey-master:6379" .Release.Name -}}
{{- else -}}
{{- fail "Set externalValkey.url or enable the bundled valkey subchart" -}}
{{- end -}}
{{- end -}}

{{/*
The environment shared by the API and the workers.

Defined once so the two can never drift apart — a worker signing with a
different PUBLIC_URL than the API serves from would produce credentials whose
DIDs do not resolve.
*/}}
{{- define "opencred.commonEnv" -}}
- name: NODE_ENV
  value: production
- name: OPENCRED_EDITION
  value: {{ .Values.opencred.edition | quote }}
- name: PUBLIC_URL
  value: {{ .Values.opencred.publicUrl | quote }}
- name: API_URL
  value: {{ .Values.opencred.apiUrl | quote }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "opencred.secretName" . }}
      key: database-url
- name: VALKEY_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "opencred.secretName" . }}
      key: valkey-url
- name: JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "opencred.secretName" . }}
      key: jwt-secret
- name: ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "opencred.secretName" . }}
      key: encryption-key
- name: STORAGE_DRIVER
  value: {{ .Values.storage.driver | quote }}
{{- if eq .Values.storage.driver "s3" }}
- name: S3_ENDPOINT
  value: {{ .Values.storage.s3.endpoint | quote }}
- name: S3_REGION
  value: {{ .Values.storage.s3.region | quote }}
- name: S3_BUCKET
  value: {{ .Values.storage.s3.bucket | quote }}
- name: S3_FORCE_PATH_STYLE
  value: {{ .Values.storage.s3.forcePathStyle | quote }}
- name: S3_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: {{ default (include "opencred.secretName" .) .Values.storage.s3.existingSecret }}
      key: s3-access-key-id
- name: S3_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ default (include "opencred.secretName" .) .Values.storage.s3.existingSecret }}
      key: s3-secret-access-key
{{- else }}
- name: STORAGE_LOCAL_PATH
  value: /app/var/storage
{{- end }}
- name: MAIL_TRANSPORT
  value: {{ .Values.mail.transport | quote }}
- name: MAIL_HOST
  value: {{ .Values.mail.host | quote }}
- name: MAIL_PORT
  value: {{ .Values.mail.port | quote }}
- name: MAIL_SECURE
  value: {{ .Values.mail.secure | quote }}
- name: MAIL_FROM
  value: {{ .Values.mail.from | quote }}
{{- if .Values.mail.user }}
- name: MAIL_USER
  value: {{ .Values.mail.user | quote }}
- name: MAIL_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ default (include "opencred.secretName" .) .Values.mail.existingSecret }}
      key: mail-password
{{- end }}
- name: TELEMETRY_ENABLED
  value: {{ .Values.telemetry.enabled | quote }}
{{- if .Values.telemetry.endpoint }}
- name: TELEMETRY_ENDPOINT
  value: {{ .Values.telemetry.endpoint | quote }}
{{- end }}
{{- end -}}
