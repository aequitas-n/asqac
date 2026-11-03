#pragma once
// Copy to secrets.h. Never commit that file.
const char* WIFI_SSID = "HOSPITAL_RESEARCH_WIFI";
const char* WIFI_PASSWORD = "REPLACE_ME";
const char* DEVICE_UID = "CAP0001-ESP32-001";
const char* DEVICE_TOKEN = "REPLACE_WITH_GENERATED_PER_DEVICE_TOKEN";
const char* TELEMETRY_URL = "https://PROJECT_REF.supabase.co/functions/v1/telemetry";
// Paste the trusted PEM ROOT CA for the certificate chain served by your actual
// function hostname. Verify it independently. Never use setInsecure().
const char* TLS_ROOT_CA = R"PEM(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_YOUR_ENDPOINT_TRUSTED_ROOT_CA_PEM
-----END CERTIFICATE-----
)PEM";
